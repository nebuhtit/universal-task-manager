import { describe, expect, it } from 'vitest';
import { calculateViewTimeMetrics, createItem, createWorkspace, inferViewPeriod, migrateView, type SavedView } from './index.js';

const periodView = (source = 'state == "open" && scheduleInPeriod("today", "event", false, 7, "", "")'): SavedView => ({
  id: 'period', name: 'Today', query: { source }, renderer: 'list', sort: [], fields: ['title'],
  statistics: { showTime: true, reservedItemIds: [] },
});

describe('view time statistics', () => {
  it('infers finite visual and legacy periods but rejects ambiguous custom logic', () => {
    const now = new Date('2026-08-31T12:00:00.000Z');
    expect(inferViewPeriod(periodView(), now, { timeZone: 'UTC', weekStartsOn: 1 })).toMatchObject({ startDate: '2026-08-31', endDate: '2026-08-31', durationMs: 86_400_000 });
    expect(inferViewPeriod(periodView('eventThisWeek == true || dueThisWeekOrOverdue == true'), now, { timeZone: 'UTC', weekStartsOn: 1 })).toMatchObject({ startDate: '2026-08-31', endDate: '2026-09-06' });
    expect(inferViewPeriod(periodView('scheduleInPeriod("today", "due", false, 7, "", "") || scheduleInPeriod("tomorrow", "due", false, 7, "", "")'), now, { timeZone: 'UTC' })).toBeNull();
  });

  it('subtracts view work plus clipped recurring reservations without persisting occurrences', () => {
    const workspace = createWorkspace();
    workspace.calendarPreferences.timezone = 'UTC';
    const task = createItem('Focused work');
    task.schedule = { timezone: 'UTC', startAt: '2026-08-31T10:00:00.000Z', endAt: '2026-08-31T12:00:00.000Z', estimatedDuration: 'PT2H' };
    workspace.items[task.id] = task;

    const sleep = createItem('Sleep');
    sleep.role = 'series_template';
    sleep.schedule = { timezone: 'UTC', startAt: '2026-08-30T23:00:00.000Z', endAt: '2026-08-31T07:00:00.000Z', estimatedDuration: 'PT8H' };
    sleep.recurrence = { rrule: 'FREQ=DAILY', rdates: [], exdates: [], timezone: 'UTC', closeAt: 'never', anchor: 'schedule', autoRenew: false };
    workspace.items[sleep.id] = sleep;
    const view = periodView();
    view.statistics!.reservedItemIds = [sleep.id];

    const beforeIds = Object.keys(workspace.items);
    const metrics = calculateViewTimeMetrics(workspace, view, [task], new Date('2026-08-31T12:00:00.000Z'));
    expect(metrics).toMatchObject({ periodDurationMs: 24 * 60 * 60_000, reservedDurationMs: 8 * 60 * 60_000, freeDurationMs: 14 * 60 * 60_000 });
    expect(Object.keys(workspace.items)).toEqual(beforeIds);
  });

  it('does not subtract a selected item twice when it already matches the view', () => {
    const workspace = createWorkspace();
    workspace.calendarPreferences.timezone = 'UTC';
    const fixed = createItem('Appointment');
    fixed.schedule = { timezone: 'UTC', startAt: '2026-08-31T10:00:00.000Z', endAt: '2026-08-31T11:00:00.000Z' };
    workspace.items[fixed.id] = fixed;
    const view = periodView();
    view.statistics!.reservedItemIds = [fixed.id];
    expect(calculateViewTimeMetrics(workspace, view, [fixed], new Date('2026-08-31T12:00:00.000Z'))).toMatchObject({ reservedDurationMs: 0, freeDurationMs: 23 * 60 * 60_000 });
  });

  it('treats opaque external events as capacity reservations but not completable work', () => {
    const workspace = createWorkspace();
    workspace.calendarPreferences.timezone = 'UTC';
    const event = createItem('Google meeting', 'event');
    event.schedule = { timezone: 'UTC', startAt: '2026-08-31T10:00:00.000Z', endAt: '2026-08-31T11:00:00.000Z', estimatedDuration: 'PT1H' };
    event.external = { provider: 'google_calendar', connectionId: 'connection', calendarId: 'primary', eventId: 'event', sourceUrl: 'https://calendar.google.com/', readOnly: true, transparency: 'opaque', syncedAt: '2026-08-31T09:00:00.000Z' };
    workspace.items[event.id] = event;
    const metrics = calculateViewTimeMetrics(workspace, periodView(), [event], new Date('2026-08-31T12:00:00.000Z'));
    expect(metrics).toMatchObject({ totalItems: 0, completionPercent: 0, remainingDurationMs: 0, freeDurationMs: 23 * 60 * 60_000 });
  });

  it('keeps old views visible by default and quarantines malformed settings', () => {
    const base = { id: 'legacy', name: 'Legacy', query: { source: '' }, renderer: 'list', sort: [], fields: [] };
    expect(migrateView(base).value.statistics).toBeUndefined();
    const migrated = migrateView({ ...base, statistics: { showTime: 'yes', reservedItemIds: 4 } });
    expect(migrated.value.statistics).toBeUndefined();
    expect(migrated.value.extensions?.quarantine).toMatchObject({ statistics: { showTime: 'yes', reservedItemIds: 4 } });
  });
});
