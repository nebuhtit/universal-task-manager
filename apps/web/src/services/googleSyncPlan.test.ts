import { describe, it, expect } from 'vitest';
import { createWorkspace, createItem } from '@utm/core';
import { applyGoogleSyncPlan, calculateGoogleSyncPlan } from './googleSyncPlan';
import type { GoogleCalendarSyncResult } from './googleCalendar';
import * as Automerge from '@automerge/automerge';
import type { WorkspaceDocument } from '@utm/core';
import { googleSyncSnapshot } from './googleSyncWorker';
import { commitWorkspaceDocument } from './workspaceLifecycle';

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function fixture() {
  const workspace = createWorkspace('test');
  workspace.calendarPreferences.googleCalendar = { connectionId: 'c', calendars: [{ id: 'cal', name: 'cal', selected: true }], syncTokens: { cal: 'old' } };
  const result: GoogleCalendarSyncResult = { calendars: copy(workspace.calendarPreferences.googleCalendar.calendars), syncTokens: { cal: 'new' }, syncWindow: { timeMin: '2026-01-01T00:00:00Z', timeMax: '2027-01-01T00:00:00Z', refreshedAt: '2026-09-28T00:00:00Z' }, syncedAt: '2026-09-28T00:00:00Z', batches: [{ calendarId: 'cal', connectionId: 'c', syncedAt: '2026-09-28T00:00:00Z', fullSync: true, events: [{ id: 'e', summary: 'event', start: { dateTime: '2026-10-01T10:00:00Z' }, end: { dateTime: '2026-10-01T11:00:00Z' } }] }] };
  return { workspace, result };
}
describe('detached Google import plan', () => {
  it('applies a detached plan to a real Automerge draft', async () => {
    const { workspace, result } = fixture();
    const doc = Automerge.from(copy(workspace) as unknown as Record<string, unknown>) as unknown as Automerge.Doc<WorkspaceDocument>;
    const patches = calculateGoogleSyncPlan({ workspace: await googleSyncSnapshot(doc), result, recovered: [] });
    const next = commitWorkspaceDocument(doc, 'Sync Google Calendar', draft => applyGoogleSyncPlan(draft, patches));
    expect(next.calendarPreferences.googleCalendar?.syncTokens.cal).toBe('new');
    expect(Object.values(next.items).some(item => item.external?.eventId === 'e')).toBe(true);
  });
  it('applies events and cursor together, preserving local items', () => {
    const { workspace, result } = fixture();
    const item = createItem('local'); workspace.items[item.id] = item;
    const patches = calculateGoogleSyncPlan({ workspace: copy(workspace), result, recovered: [] });
    expect(workspace.calendarPreferences.googleCalendar?.syncTokens.cal).toBe('old');
    applyGoogleSyncPlan(workspace, patches);
    expect(workspace.items[item.id]).toEqual(item);
    expect(Object.values(workspace.items).some(item => item.external?.eventId === 'e')).toBe(true);
    expect(workspace.calendarPreferences.googleCalendar?.syncTokens.cal).toBe('new');
  });
  it('rejects a concurrent preference edit without applying any event or cursor', () => {
    const { workspace, result } = fixture();
    const patches = calculateGoogleSyncPlan({ workspace: copy(workspace), result, recovered: [] });
    workspace.calendarPreferences.googleCalendar!.calendars[0]!.selected = false;
    const before = copy(workspace);
    expect(() => applyGoogleSyncPlan(workspace, patches)).toThrow('Workspace changed');
    expect(workspace).toEqual(before);
  });
  it('accepts equal values with different object key order', () => {
    const { workspace, result } = fixture();
    const patches = calculateGoogleSyncPlan({ workspace: copy(workspace), result, recovered: [] });
    workspace.calendarPreferences = Object.fromEntries(Object.entries(workspace.calendarPreferences).reverse()) as typeof workspace.calendarPreferences;
    applyGoogleSyncPlan(workspace, patches);
    expect(workspace.calendarPreferences.googleCalendar?.syncTokens.cal).toBe('new');
  });
  it('applies after a recorded sync error in a history-bearing Automerge document', async () => {
    const { workspace, result } = fixture();
    let doc = Automerge.from(copy(workspace) as unknown as Record<string, unknown>) as unknown as Automerge.Doc<WorkspaceDocument>;
    doc = commitWorkspaceDocument(doc, 'Prior sync failed', draft => { draft.calendarPreferences.googleCalendar!.lastError = 'Could not apply Google refresh; local changes were retained.'; });
    const patches = calculateGoogleSyncPlan({ workspace: await googleSyncSnapshot(doc), result, recovered: [] });
    const next = commitWorkspaceDocument(doc, 'Sync Google Calendar', draft => applyGoogleSyncPlan(draft, patches));
    expect(next.calendarPreferences.googleCalendar?.lastError).toBeUndefined();
  });
});
