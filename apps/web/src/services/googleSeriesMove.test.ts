import { afterEach, describe, expect, it, vi } from 'vitest';
import { createItem, createOccurrence, createWorkspace } from '@utm/core';
import { itemEditorSource } from '../features/items/editor/itemEditorSource';
import { normalizeItemForSave } from '../features/items/editor/itemEditorModel';
import { withQuickEntryCalendar } from '../features/items/quickEntry';
import { isCalendarOnlySeriesMove } from './recurrenceItemEdit';
import { saveItemInWorkspace } from './itemSaveCommand';
import { prepareGoogleSave, saveGoogleItem } from './googleItemSave';

const now = new Date('2030-09-08T00:00:00Z');
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function fixture() {
  const workspace = createWorkspace('Stable calendar move', now);
  const series = createItem('Work', 'event', now); series.id = 'work'; series.role = 'series_template';
  series.schedule = { timezone: 'UTC', startAt: '2030-09-02T09:00:00Z', endAt: '2030-09-02T17:00:00Z', estimatedDuration: 'PT8H' };
  series.recurrence = { rrule: 'FREQ=WEEKLY;COUNT=4', timezone: 'UTC', anchor: 'schedule', closeAt: 'next_activation', autoRenew: true, activationOffset: 'P7D', exdates: [], rdates: [] };
  series.external = { provider: 'google_calendar', calendarId: 'source', eventId: 'master', connectionId: 'connection', sourceUrl: '', readOnly: false, syncedAt: now.toISOString(), transparency: 'opaque', etag: 'v1' };
  const first = createOccurrence(series, new Date('2030-09-02T09:00:00Z'), 0);
  const selected = createOccurrence(series, new Date('2030-09-09T09:00:00Z'), 1);
  const task = createItem('Related'); task.relations = [{ id: 'r', type: 'scheduled_within', targetId: series.id }];
  workspace.items = { [series.id]: series, [first.id]: first, [selected.id]: selected, [task.id]: task };
  workspace.calendarPreferences.dayView.statistics = { showTime: true, reservedItemIds: [series.id] };
  return { workspace, series, first, selected, task };
}

describe('calendar-only series moves', () => {
  it('moves a selected future cycle repeatedly without splitting its source or changing dates and relationships', () => {
    const { workspace, series, first, selected, task } = fixture();
    const before = JSON.stringify({ first, selected, task, settings: workspace.calendarPreferences.dayView });
    for (const calendarId of ['destination', 'third-calendar', 'source']) {
      const baseline = structuredClone(itemEditorSource(workspace, workspace.items[selected.id]!));
      const changed = withQuickEntryCalendar(structuredClone(baseline), { id: calendarId, name: calendarId });
      const options = { calendarId, busy: true, baseline, moveWholeSeries: true };
      expect(isCalendarOnlySeriesMove(changed, options)).toBe(true);
      const normalized = normalizeItemForSave({ item: changed, workspace, tags: '', contexts: '', isTemplate: false, recurring: true,
        activeRange: false, repeatFrequency: 'WEEKLY', repeatIntervalDraft: '1', repeatDays: [], now });
      expect(isCalendarOnlySeriesMove(normalized, options)).toBe(true);
      const result = saveItemInWorkspace(workspace, normalized, { recurrenceEdit: { occurrenceId: selected.id, scope: 'this_and_future' }, google: options }, now);
      expect(result.googleCandidate.id).toBe(series.id);
      expect(result.googleCandidate.external?.eventId).toBe('master');
      expect(result.googleCandidate.schedule?.startAt).toBe(series.schedule?.startAt);
      expect(Object.values(workspace.items).filter(item => item.role === 'series_template')).toHaveLength(1);
      expect(workspace.items.work?.extensions?.['utm:googleSplit']).toBeUndefined();
      expect(JSON.stringify({ first: workspace.items[first.id], selected: workspace.items[selected.id], task: workspace.items[task.id], settings: workspace.calendarPreferences.dayView })).toBe(before);
      // Simulate the acknowledgement after the stable remote event moves.
      workspace.items.work!.external!.calendarId = calendarId;
    }
  });

  it('rejects a calendar-only intent with other edits before changing the workspace', () => {
    const { workspace, selected } = fixture();
    const baseline = structuredClone(itemEditorSource(workspace, selected));
    const edited = structuredClone(baseline); edited.reminders = [{ id: 'new', mode: 'absolute', at: now.toISOString(), repeatUntilAcknowledged: false }];
    const options = { calendarId: 'destination', busy: true, baseline, moveWholeSeries: true };
    const before = JSON.stringify(workspace);
    expect(isCalendarOnlySeriesMove(edited, options)).toBe(false);
    expect(() => saveItemInWorkspace(workspace, edited, { google: options }, now)).toThrow('Save other edits separately');
    expect(JSON.stringify(workspace)).toBe(before);
  });

  it('queues a bodyless move and never PATCHes dates or inserts an event', async () => {
    const { workspace, series } = fixture();
    const baseline = structuredClone(series);
    const event = { id: 'master', etag: 'v1', iCalUID: 'stable-uid', summary: 'Work', recurrence: ['RRULE:FREQ=WEEKLY;COUNT=4'],
      start: { dateTime: series.schedule!.startAt!, timeZone: 'UTC' }, end: { dateTime: series.schedule!.endAt!, timeZone: 'UTC' } };
    // A rolling local series can show a later cycle than the remote master.
    series.schedule!.startAt = '2030-09-16T09:00:00Z'; series.schedule!.endAt = '2030-09-16T17:00:00Z';
    const options = { calendarId: 'destination', busy: true, baseline, moveWholeSeries: true };
    const operation = await prepareGoogleSave({ workspaceId: workspace.workspaceId, accountEmail: 'owner', item: series, options });
    expect(operation).toMatchObject({ kind: 'move', eventId: 'master', calendarId: 'source', destination: 'destination' });
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, ...(init ? { init } : {}) });
      const result = url.includes('calendarList') ? { items: [{ id: 'owner', primary: true, accessRole: 'owner' }, { id: 'source', accessRole: 'owner' }, { id: 'destination', accessRole: 'writer' }] } : event;
      return new Response(JSON.stringify(result), { status: 200 });
    }));
    const apply = vi.fn(async () => {});
    await saveGoogleItem({ token: 'test', workspaceId: workspace.workspaceId, accountEmail: 'owner', item: series, options, persist: async () => {}, apply });
    const writes = requests.filter(request => request.init?.method && request.init.method !== 'GET');
    expect(writes).toHaveLength(1); expect(writes[0]?.url).toContain('/move?');
    expect(writes[0]?.init?.body).toBeUndefined();
    expect(apply).toHaveBeenCalledWith('destination', event, true);
  });

  it('retargets an uncertain queued move without creating another item or remote event', async () => {
    const { workspace, series } = fixture();
    const event = { id: 'master', etag: 'v1', iCalUID: 'stable-uid', summary: 'Work', recurrence: ['RRULE:FREQ=WEEKLY;COUNT=4'],
      start: { dateTime: series.schedule!.startAt!, timeZone: 'UTC' }, end: { dateTime: series.schedule!.endAt!, timeZone: 'UTC' } };
    const original = await prepareGoogleSave({ workspaceId: workspace.workspaceId, accountEmail: 'owner', item: series,
      options: { calendarId: 'destination', busy: true, baseline: series, moveWholeSeries: true } });
    series.extensions = { 'utm:googleSave': original };
    const baseline = structuredClone(series);
    const options = { calendarId: 'source', busy: true, baseline, moveWholeSeries: true };
    expect(isCalendarOnlySeriesMove(series, options)).toBe(true);
    saveItemInWorkspace(workspace, series, { google: options }, now);
    expect(Object.values(workspace.items).filter(item => item.role === 'series_template')).toHaveLength(1);
    const writes: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method && init.method !== 'GET') writes.push({ url, init });
      const data = url.includes('calendarList') ? { items: [{ id: 'owner', primary: true, accessRole: 'owner' }, { id: 'source', accessRole: 'owner' }, { id: 'destination', accessRole: 'writer' }] } : event;
      return new Response(JSON.stringify(data), { status: 200 });
    }));
    await saveGoogleItem({ token: 'test', workspaceId: workspace.workspaceId, accountEmail: 'owner', item: workspace.items.work!, options, persist: async () => {}, apply: async () => {} });
    expect(writes).toHaveLength(2);
    expect(writes.every(write => write.url.includes('/move?') && write.init.method === 'POST' && write.init.body === undefined)).toBe(true);
  });
});
