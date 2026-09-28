import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildRecurrenceRule, createItem, createOccurrence, createWorkspace } from '@utm/core';
import { applyItemDeletion, deleteGoogleItem, restrictRecurrence } from './itemDeleteCommand';
import { googleJson } from './googleCalendar';
vi.mock('./googleCalendar', () => ({ googleJson: vi.fn() }));
afterEach(() => vi.resetAllMocks());
function fixture() {
  const workspace = createWorkspace(); const series = createItem('Delete test');
  series.role = 'series_template'; series.schedule = { startAt: '2030-09-02T10:00:00Z', endAt: '2030-09-02T11:00:00Z', timezone: 'UTC' };
  series.recurrence = { rrule: 'FREQ=WEEKLY;COUNT=4', timezone: 'UTC', anchor: 'schedule', closeAt: 'next_activation', autoRenew: true, activationOffset: 'PT0M', rdates: [], exdates: [] };
  const cycles = buildRecurrenceRule(series).all().map((date, n) => createOccurrence(series, date, n));
  workspace.items = Object.fromEntries([series, ...cycles].map(item => [item.id, item]));
  const intent = { itemId: series.id, accountEmail: 'test', scope: { occurrenceId: cycles[1]!.id, scope: 'this_and_future' as const } };
  return { workspace, series, cycles, intent };
}
describe('scoped deletion', () => {
  it('keeps past cycles and stops future projection', () => {
    const { workspace, series, cycles, intent } = fixture();
    applyItemDeletion(workspace, intent, new Date().toISOString());
    expect(cycles[0]!.deletedAt).toBeUndefined();
    expect(cycles.slice(1).every(item => item.deletedAt)).toBe(true);
    expect(series.deletedAt).toBeUndefined(); expect(buildRecurrenceRule(series).all()).toHaveLength(1);
  });
  it('excludes only the selected cycle', () => {
    const { workspace, series, cycles, intent } = fixture();
    applyItemDeletion(workspace, { ...intent, scope: { ...intent.scope, scope: 'this_occurrence' } }, new Date().toISOString());
    expect(cycles[1]!.deletedAt).toBeTruthy(); expect(cycles[2]!.deletedAt).toBeUndefined();
    expect(buildRecurrenceRule(series).all()).toHaveLength(3);
  });
  it('materializes a projected cycle only inside its deletion transaction', () => {
    const { workspace, series, cycles, intent } = fixture();
    const selected = cycles[1]!;
    delete workspace.items[selected.id];
    applyItemDeletion(workspace, { ...intent, scope: { occurrenceId: selected.id, recurrenceId: selected.occurrence!.recurrenceId, scope: 'this_occurrence' } }, new Date().toISOString());
    expect(workspace.items[selected.id]?.deletedAt).toBeTruthy();
    expect(series.recurrence?.exdates).toContain(selected.occurrence!.recurrenceId);
  });
  it('deletes the entire series only when future scope starts at its first cycle', () => {
    const { workspace, series, cycles, intent } = fixture();
    applyItemDeletion(workspace, { ...intent, scope: { ...intent.scope, occurrenceId: cycles[0]!.id } }, new Date().toISOString());
    expect(series.deletedAt).toBeTruthy(); expect(cycles.every(item => item.deletedAt)).toBe(true);
  });
  it('does not extend COUNT recurrence on retry after its end', () => {
    const { series } = fixture();
    restrictRecurrence(series, '2031-01-01T00:00:00Z', false);
    expect(series.recurrence!.rrule).toBe('FREQ=WEEKLY;COUNT=4');
  });
  it('patches only Google recurrence with a fresh etag; local data waits', async () => {
    const { workspace, series, cycles, intent } = fixture();
    series.external = { provider: 'google_calendar', calendarId: 'M', eventId: 'master', connectionId: 'c', readOnly: false, sourceUrl: '', syncedAt: '' };
    vi.mocked(googleJson).mockResolvedValueOnce({ id: 'master', etag: 'fresh', start: { dateTime: series.schedule!.startAt }, end: { dateTime: series.schedule!.endAt }, recurrence: ['RRULE:FREQ=WEEKLY;COUNT=4'] }).mockResolvedValueOnce({ id: 'master' });
    await deleteGoogleItem(workspace, intent, 'token');
    const call = vi.mocked(googleJson).mock.calls[1]!;
    expect(call[2]).toEqual({ recurrence: ['RRULE:FREQ=WEEKLY;UNTIL=20300909T095959Z'] });
    expect(call[3]).toEqual({ method: 'PATCH', etag: 'fresh' });
    expect(cycles.every(item => !item.deletedAt)).toBe(true);
  });
  it('retries already deleted remote events safely but does not swallow permission errors', async () => {
    const { workspace, series, intent } = fixture();
    series.external = { provider: 'google_calendar', calendarId: 'M', eventId: 'master', connectionId: 'c', readOnly: false, sourceUrl: '', syncedAt: '' };
    vi.mocked(googleJson).mockRejectedValueOnce({ status: 410 });
    await expect(deleteGoogleItem(workspace, intent, 'token')).resolves.toBeUndefined();
    vi.mocked(googleJson).mockRejectedValueOnce({ status: 403 });
    await expect(deleteGoogleItem(workspace, intent, 'token')).rejects.toEqual({ status: 403 });
  });
  it('cancels only the exact original-start instance, even if its actual time moved', async () => {
    const { workspace, series, cycles, intent } = fixture();
    series.external = { provider: 'google_calendar', calendarId: 'M', eventId: 'master', connectionId: 'c', readOnly: false, sourceUrl: '', syncedAt: '' };
    vi.mocked(googleJson).mockResolvedValueOnce({ id: 'master' }).mockResolvedValueOnce({ items: [
      { id: 'other', originalStartTime: { dateTime: cycles[0]!.occurrence!.recurrenceId } },
      { id: 'selected', etag: 'instance-etag', originalStartTime: { dateTime: cycles[1]!.occurrence!.recurrenceId }, start: { dateTime: '2030-09-10T17:00:00Z' } },
    ] }).mockResolvedValueOnce({ id: 'selected', status: 'cancelled' });
    await deleteGoogleItem(workspace, { ...intent, scope: { ...intent.scope, scope: 'this_occurrence' } }, 'token');
    const call = vi.mocked(googleJson).mock.calls[2]!;
    expect(call[0]).toMatch(/events\/selected$/);
    expect(call[2]).toEqual({ status: 'cancelled' });
    expect(call[3]).toEqual({ method: 'PATCH', etag: 'instance-etag' });
  });
});
