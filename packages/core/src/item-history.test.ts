import { describe, it, expect } from 'vitest';
import { createItem, createWorkspace, type SavedView } from './types.js';
import { actualTimeMs, addTimerActualTime, initializeItemHistory, recordCompletionTransition, syncActualDuration } from './item-history.js';
import { migrateItem, migrateView, validateItem } from './schema.js';
import { createOccurrence, reconcileRecurrences } from './recurrence.js';
import { calculateViewTimeMetrics } from './view-statistics.js';
import { calculateProjectMetrics, ensureProjectDefinition } from './organization.js';
import { applyGoogleCalendarSync } from './google-calendar.js';
import { workspaceForExport } from './export-privacy.js';

describe('item journals', () => {
  it('migrates legacy habit dates into valid, nonduplicated completion entries', () => {
    const item = createItem('Habit');
    item.habit = { target: 1, unit: 'times', streakMode: 'manual_only', completedDates: ['2026-09-20'] };
    initializeItemHistory(item); initializeItemHistory(item);
    expect(item.completionEntries).toHaveLength(1);
    expect(validateItem(item).valid).toBe(true);
  });
  it('migrates legacy totals and closures once, preserving unknown dates and deliberate deletion', () => {
    const item = createItem('Legacy'); item.schedule = { timezone: 'UTC', estimatedDuration: 'PT2H', actualDuration: 'PT30M' }; item.state = 'done'; item.closure = { at: '2026-09-20T12:00:00Z', actor: 'user', reason: 'manual' };
    const next = migrateItem(item).value;
    expect(next.actualTimeEntries).toHaveLength(1); expect(next.actualTimeEntries![0]!.at).toBeUndefined(); expect(next.completionEntries).toHaveLength(1);
    expect(migrateItem(next).value.actualTimeEntries).toHaveLength(1);
    next.actualTimeEntries = []; next.completionEntries = []; syncActualDuration(next);
    expect(migrateItem(next).value.completionEntries).toEqual([]); expect(next.schedule?.actualDuration).toBe('PT0S'); expect(next.schedule?.estimatedDuration).toBe('PT2H');
    expect(validateItem(next).valid).toBe(true);
  });
  it('adds measured sessions explicitly and once, including short stopwatch sessions', () => {
    const item = createItem('Work'); const session = { id: 's', mode: 'timer' as const, startedAt: '2026-09-20T12:00:00Z', endedAt: '2026-09-20T12:02:00Z', durationSeconds: 120, targetSeconds: 600 };
    addTimerActualTime(item, session); addTimerActualTime(item, session);
    addTimerActualTime(item, { ...session, id: 'short', mode: 'stopwatch', durationSeconds: 30 });
    expect(item.actualTimeEntries).toHaveLength(2); expect(actualTimeMs(item)).toBe(150000);
    expect(item.completionEntries).toHaveLength(2); expect(item.actualTimeEntries![0]!.completionId).toBe(item.completionEntries![0]!.id);
    item.actualTimeEntries![0]!.durationSeconds = 90; syncActualDuration(item); expect(item.schedule?.actualDuration).toBe('PT120S');
  });
  it('accepts a stopped timer awaiting an explicit completion save', () => {
    const item = createItem('Timed work');
    item.activeTimer = { id: 'pending-1', mode: 'stopwatch', startedAt: '2026-09-20T12:00:00Z', stoppedAt: '2026-09-20T12:00:02Z', durationSeconds: 2 };
    expect(validateItem(item).valid).toBe(true);
    const restored = migrateItem(JSON.parse(JSON.stringify(item))).value;
    expect(restored.activeTimer).toEqual(item.activeTimer);
  });
  it('treats existing actual time as one completion without duplicating a matching completion', () => {
    const item = createItem('Measured'); item.actualTimeEntries = [{ id: 'manual-time', at: '2026-09-21T09:00:00Z', durationSeconds: 60, comment: '', source: 'manual' }];
    initializeItemHistory(item); initializeItemHistory(item);
    expect(item.completionEntries).toHaveLength(1); expect(item.actualTimeEntries[0]!.completionId).toBe(item.completionEntries![0]!.id);
  });
  it('records completion, reopen, and a new completion without changing schedule through journal edits', () => {
    const item = createItem('Task'); item.state = 'done'; item.closure = { at: '2026-09-20T12:00:00Z', actor: 'user', reason: 'manual' };
    recordCompletionTransition(item, 'open', item.closure.at); item.state = 'open'; recordCompletionTransition(item, 'done', '2026-09-20T12:30:00Z');
    expect(item.completionEntries![0]!.revokedAt).toBe('2026-09-20T12:30:00Z');
    item.state = 'done'; item.closure.at = '2026-09-20T13:00:00Z'; recordCompletionTransition(item, 'open', item.closure.at);
    expect(item.completionEntries).toHaveLength(2); item.completionEntries![0]!.comment = 'Corrected'; expect(item.closure.at).toBe('2026-09-20T13:00:00Z');
  });
  it('starts new occurrences with no inherited actual time or timers', () => {
    const series = createItem('Daily'); series.role = 'series_template'; series.schedule = { timezone: 'UTC', startAt: '2026-09-20T12:00:00Z', actualDuration: 'PT1H' }; series.recurrence = { rrule: 'FREQ=DAILY', timezone: 'UTC', autoRenew: true, anchor: 'scheduled', closeAt: 'next_activation', exdates: [], rdates: [] };
    initializeItemHistory(series); const next = createOccurrence(series, new Date('2026-09-21T12:00:00Z'), 1);
    expect(next.actualTimeEntries).toBeUndefined(); expect(next.schedule?.actualDuration).toBeUndefined(); expect(next.timerHistory).toBeUndefined();
  });
  it('retains rolling-cycle logs while resetting the next cycle total', () => {
    const workspace = createWorkspace('Rolling'); const series = createItem('Daily'); series.role = 'series_template'; series.schedule = { timezone: 'UTC', startAt: '2026-09-20T12:00:00Z', estimatedDuration: 'PT1H' }; series.recurrence = { rrule: 'FREQ=DAILY', timezone: 'UTC', autoRenew: true, anchor: 'scheduled', closeAt: 'next_activation', exdates: [], rdates: [] };
    workspace.items[series.id] = series; reconcileRecurrences(workspace, new Date('2026-09-20T13:00:00Z'));
    const occurrence = Object.values(workspace.items).find((item) => item.role === 'occurrence')!;
    occurrence.actualTimeEntries = [{ id: 'measured', durationSeconds: 600, comment: 'Cycle one', source: 'manual', recurrenceId: occurrence.occurrence!.recurrenceId }]; syncActualDuration(occurrence);
    reconcileRecurrences(workspace, new Date('2026-09-21T13:00:00Z'));
    const next = Object.values(workspace.items).find((item) => item.role === 'occurrence')!;
    expect(next.actualTimeEntries?.some((entry) => entry.comment === 'Cycle one')).toBe(true); expect(actualTimeMs(next)).toBe(0);
  });
  it('keeps planned statistics separate, counts hidden completed once, and preserves backup journals', () => {
    const workspace = createWorkspace('Metrics'); ensureProjectDefinition(workspace, 'A'); ensureProjectDefinition(workspace, 'B');
    const done = createItem('Done'); done.state = 'done'; done.projects = ['A', 'B']; done.schedule = { timezone: 'UTC', estimatedDuration: 'PT10M', actualDuration: 'PT20M' }; initializeItemHistory(done);
    const open = createItem('Open'); open.projects = ['A']; open.schedule = { timezone: 'UTC', estimatedDuration: 'PT90M' }; workspace.items[done.id] = done; workspace.items[open.id] = open;
    const view: SavedView = { id: 'v', name: 'V', renderer: 'list', query: { source: 'state == "open"' }, sort: [], fields: [], statistics: { showTime: true, showActualTime: true, includeHiddenCompleted: true, reservedItemIds: [] } };
    const metrics = calculateViewTimeMetrics(workspace, view, [open, done, done]); expect(metrics.completionPercent).toBe(10); expect(metrics.remainingDurationMs).toBe(90 * 60000); expect(metrics.actualDurationMs).toBe(20 * 60000);
    expect(calculateProjectMetrics(workspace).A!.actualDurationMs).toBe(20 * 60000);
    view.statistics!.includeHiddenCompleted = false; expect(calculateViewTimeMetrics(workspace, view, [open]).actualDurationMs).toBe(0);
    expect(migrateView(view).value.statistics?.showActualTime).toBe(true); expect(workspaceForExport(workspace).items[done.id]?.actualTimeEntries).toEqual(done.actualTimeEntries);
  });
  it('preserves locally entered actual time when Google replaces event data', () => {
    const workspace = createWorkspace('Google'); const event = { id: 'event', etag: '1', start: { dateTime: '2026-09-20T12:00:00Z' }, end: { dateTime: '2026-09-20T13:00:00Z' } }; const batch = { events: [event], calendarId: 'primary', connectionId: 'g', syncedAt: '2026-09-20T12:00:00Z', fullSync: false };
    applyGoogleCalendarSync(workspace, batch); const item = Object.values(workspace.items)[0]!;
    item.actualTimeEntries = [{ id: 'local', source: 'manual', durationSeconds: 600, comment: 'Notes' }]; syncActualDuration(item);
    applyGoogleCalendarSync(workspace, { ...batch, events: [{ ...event, etag: '2', summary: 'Changed' }] });
    expect(workspace.items[item.id]?.actualTimeEntries).toEqual(item.actualTimeEntries); expect(workspace.items[item.id]?.schedule?.actualDuration).toBe('PT600S');
  });
  it('exports user-authored Google time journals without source content and restores them on sync', () => {
    const workspace = createWorkspace('Backup'); const key = 'a'.repeat(64);
    const entries = [{ id: 'local', source: 'manual' as const, durationSeconds: 600, comment: 'My work' }];
    workspace.calendarPreferences.localTimeJournals = { [key]: entries };
    const event = { id: 'private-id', localHistoryKey: key, summary: 'Private Google title', start: { dateTime: '2026-09-20T12:00:00Z' }, end: { dateTime: '2026-09-20T13:00:00Z' } }; const batch = { events: [event], calendarId: 'private@example.com', connectionId: 'g', syncedAt: '2026-09-20T12:00:00Z', fullSync: false };
    applyGoogleCalendarSync(workspace, batch);
    const backup = workspaceForExport(workspace); const json = JSON.stringify(backup);
    expect(json).toContain('My work'); expect(json).not.toContain('Private Google title'); expect(json).not.toContain('private@example.com'); expect(json).not.toContain('private-id');
    applyGoogleCalendarSync(backup, batch);
    expect(Object.values(backup.items)[0]?.actualTimeEntries).toEqual(entries);
  });
});
