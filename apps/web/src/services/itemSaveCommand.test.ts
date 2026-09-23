import * as Automerge from '@automerge/automerge';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyGoogleCalendarSync, createItem, createWorkspace, googleCalendarProjection, reconcileCalendarOrganization, type WorkspaceDocument } from '@utm/core';
import { createAutomergeDocument } from '@utm/sdk';
import { saveItemInWorkspace } from './itemSaveCommand';
import { commitWorkspaceDocument } from './workspaceLifecycle';
import { saveGoogleItem, type GoogleSaveOperation } from './googleItemSave';

afterEach(() => vi.unstubAllGlobals());
const fixture = () => {
  const workspace = createWorkspace('Synthetic regression');
  workspace.calendarPreferences.googleCalendar = { connectionId: 'connection', accountEmail: 'test@example.invalid', calendars: [{ id: 'calendar', name: 'Test', selected: true }], syncTokens: {} };
  const item = createItem('Synthetic active range');
  item.schedule = { timezone: 'UTC', startAt: '2030-09-20T12:00:00.000Z', endAt: '2030-09-20T12:45:00.000Z', dueAt: '2030-09-24T12:00:00.000Z', estimatedDuration: 'PT45M' };
  item.external = { provider: 'google_calendar', connectionId: 'connection', calendarId: 'calendar', eventId: 'remote-event', sourceUrl: '', syncedAt: '2030-09-20T12:00:00.000Z', readOnly: false, startAt: item.schedule.startAt!, endAt: item.schedule.endAt! };
  workspace.items[item.id] = item; reconcileCalendarOrganization(workspace);
  return { workspace, item };
};

describe('item save transaction and reload contract', () => {
  it('retries a deletion after lost response and reload without restoring fields', async () => {
    const { workspace, item } = fixture(); const edited = structuredClone(item); delete edited.schedule!.endAt;
    saveItemInWorkspace(workspace, edited, { deleteGoogleEvent: true }, new Date());
    let doc = createAutomergeDocument(workspace); let remoteExists = true; let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      if (remoteExists) { remoteExists = false; throw new TypeError('Response lost after deletion'); }
      return new Response(JSON.stringify({ error: { message: 'Gone' } }), { status: 410 });
    }));
    const send = () => saveGoogleItem({ token: 'test', workspaceId: doc.workspaceId, accountEmail: 'test@example.invalid', item: JSON.parse(JSON.stringify(doc.items[item.id])), options: { calendarId: 'calendar', busy: true, baseline: item },
      persist: async operation => { doc = commitWorkspaceDocument(doc, 'Persist intent', draft => { draft.items[item.id]!.extensions!['utm:googleSave'] = JSON.parse(JSON.stringify(operation)); }); },
      apply: async () => { doc = commitWorkspaceDocument(doc, 'Acknowledge remote deletion', draft => { delete draft.items[item.id]!.extensions!['utm:googleSave']; }); },
    });
    await expect(send()).rejects.toThrow('Response lost');
    doc = Automerge.load<WorkspaceDocument>(Automerge.save(doc));
    await send();
    expect(calls).toBe(2); expect(Object.keys(doc.items)).toEqual([item.id]);
    expect(doc.items[item.id]!.extensions!['utm:googleSave']).toBeUndefined();
    expect(googleCalendarProjection(doc.items[item.id]!).schedule?.endAt).toBeUndefined();
    expect(doc.items[item.id]!.schedule?.estimatedDuration).toBe('PT45M');
  });
  it('retains the pending deletion when Google authorization expires', async () => {
    const { workspace, item } = fixture(); const edited = structuredClone(item); delete edited.schedule!.endAt;
    saveItemInWorkspace(workspace, edited, { deleteGoogleEvent: true }, new Date());
    const pending = workspace.items[item.id]!;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Expired authorization' } }), { status: 401 })));
    const apply = vi.fn(async () => {});
    await expect(saveGoogleItem({ token: 'expired', workspaceId: workspace.workspaceId, accountEmail: 'test@example.invalid', item: pending, options: { calendarId: 'calendar', busy: true, baseline: item }, persist: async operation => { pending.extensions!['utm:googleSave'] = JSON.parse(JSON.stringify(operation)); }, apply })).rejects.toThrow();
    expect(apply).not.toHaveBeenCalled(); expect(pending.extensions!['utm:googleSave']).toMatchObject({ kind: 'delete' });
    expect(pending.schedule?.endAt).toBeUndefined();
  });
  it('detaches atomically, reopens without the end, and ignores repeated stale sync batches', () => {
    const { workspace, item } = fixture();
    const edited = structuredClone(item); delete edited.schedule!.endAt;
    let doc = createAutomergeDocument(workspace);
    doc = commitWorkspaceDocument(doc, 'Save confirmed detachment', draft => { saveItemInWorkspace(draft, edited, { deleteGoogleEvent: true }, new Date('2030-09-21T00:00:00Z')); });
    doc = Automerge.load<WorkspaceDocument>(Automerge.save(doc));
    for (let index = 0; index < 2; index++) {
      doc = commitWorkspaceDocument(doc, 'Repeated stale remote batch', draft => {
        applyGoogleCalendarSync(draft, { calendarId: 'calendar', connectionId: 'connection', syncedAt: '2030-09-21T00:00:00Z', fullSync: false, events: [{ id: 'remote-event', summary: 'Stale event', start: { dateTime: item.schedule!.startAt! }, end: { dateTime: item.schedule!.endAt! } }] });
      });
      doc = Automerge.load<WorkspaceDocument>(Automerge.save(doc));
      const reopened = googleCalendarProjection(doc.items[item.id]!);
      expect(reopened.schedule?.endAt).toBeUndefined(); expect(reopened.external).toBeUndefined();
      expect(reopened.schedule?.estimatedDuration).toBe('PT45M'); expect(reopened.tags).not.toContain('C.Test');
      expect(reopened.extensions?.['utm:googleSave']).toMatchObject({ kind: 'delete', eventId: 'remote-event' });
      expect(Object.keys(doc.items)).toEqual([item.id]);
    }
  });
  it('does not detach merely because a caller clears a field without confirmation', () => {
    const { workspace, item } = fixture(); const edited = structuredClone(item); delete edited.schedule!.endAt;
    saveItemInWorkspace(workspace, edited, undefined, new Date());
    expect(workspace.items[item.id]!.external?.eventId).toBe('remote-event');
    expect(workspace.items[item.id]!.extensions?.['utm:googleSave']).toBeUndefined();
  });
  it('makes no remote request if durable intent persistence fails', async () => {
    const { workspace, item } = fixture(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const op: GoogleSaveOperation = { kind: 'delete', calendarId: 'calendar', destination: 'calendar', eventId: 'remote-event', accountEmail: 'test@example.invalid', draft: { title: '', description: '', location: '', start: '', end: '', allDay: false, timeZone: 'UTC', busy: true } };
    item.extensions = { 'utm:googleSave': op };
    await expect(saveGoogleItem({ token: 'test', workspaceId: workspace.workspaceId, accountEmail: op.accountEmail, item, options: { calendarId: 'calendar', busy: true, baseline: item }, persist: async () => { throw new Error('IndexedDB write failed'); }, apply: async () => {} })).rejects.toThrow('IndexedDB write failed');
    expect(fetch).not.toHaveBeenCalled(); expect(item.extensions['utm:googleSave']).toEqual(op);
  });
});
