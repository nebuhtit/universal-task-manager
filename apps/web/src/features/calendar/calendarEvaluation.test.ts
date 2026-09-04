import { calculateViewTimeMetrics, createItem, createWorkspace, type CalendarDayViewPreferences } from '@utm/core';
import { describe, expect, it } from 'vitest';
import { evaluateCalendarRange } from './calendarEvaluation';

const now = new Date('2026-08-31T12:00:00.000Z');
const settings = (scheduleSources: CalendarDayViewPreferences['scheduleSources']): CalendarDayViewPreferences => ({
  filter: { source: 'state == "open"' },
  scheduleSources,
  fields: ['title'],
  sort: [
    { expression: 'schedule.startAt', direction: 'asc', nulls: 'first' },
    { expression: 'schedule.dueAt', direction: 'asc', nulls: 'first' },
  ],
  sortSource: 'schedule.startAt asc nulls first\nschedule.dueAt asc nulls first',
});

function rangeFor(sources: CalendarDayViewPreferences['scheduleSources']) {
  const workspace = createWorkspace('Calendar batch', now);
  workspace.calendarPreferences.timezone = 'UTC';
  const spanning = createItem('Spanning', 'task', now);
  spanning.id = 'spanning';
  spanning.schedule = {
    timezone: 'UTC',
    startAt: '2026-08-31T10:00:00.000Z',
    endAt: '2026-09-01T10:00:00.000Z',
    dueAt: '2026-09-02T10:00:00.000Z',
    estimatedDuration: 'PT2H',
  };
  const filtered = createItem('Completed', 'task', now);
  filtered.id = 'filtered';
  filtered.state = 'done';
  filtered.schedule = { timezone: 'UTC', dueAt: '2026-09-01T08:00:00.000Z', estimatedDuration: 'PT1H' };
  workspace.items = { spanning, filtered };
  return evaluateCalendarRange(workspace, '2026-08-31', '2026-09-04', settings(sources), now);
}

const idsByDay = (result: ReturnType<typeof rangeFor>) => Object.fromEntries(Object.entries(result.days).map(([key, day]) => [key, day.evaluation.items.map((item) => item.id)]));

describe('calendar range evaluation', () => {
  it('preserves each schedule source while distributing accepted items in one range evaluation', () => {
    expect(idsByDay(rangeFor(['event_open']))).toEqual({
      '2026-08-31': ['spanning'], '2026-09-01': [], '2026-09-02': [], '2026-09-03': [],
    });
    expect(idsByDay(rangeFor(['event']))).toEqual({
      '2026-08-31': ['spanning'], '2026-09-01': ['spanning'], '2026-09-02': [], '2026-09-03': [],
    });
    expect(idsByDay(rangeFor(['active']))).toEqual({
      '2026-08-31': ['spanning'], '2026-09-01': ['spanning'], '2026-09-02': ['spanning'], '2026-09-03': [],
    });
    expect(idsByDay(rangeFor(['due']))).toEqual({
      '2026-08-31': [], '2026-09-01': [], '2026-09-02': ['spanning'], '2026-09-03': [],
    });
  });

  it('keeps incremental day metrics identical to the established View calculation', () => {
    const result = rangeFor(['event_open', 'event', 'active', 'due']);
    for (const day of Object.values(result.days)) {
      expect(day.metrics).toEqual(calculateViewTimeMetrics(result.workspace, day.view, day.evaluation.items, now));
    }
    expect(result.projectedCount).toBe(2);
    expect(result.filteredCount).toBe(1);
  });

  it('returns stable empty buckets for an invalid user filter', () => {
    const workspace = createWorkspace('Invalid filter', now);
    workspace.calendarPreferences.timezone = 'Europe/Berlin';
    const broken = settings(['event_open']);
    broken.filter.source = 'state ==';
    const result = evaluateCalendarRange(workspace, '2026-10-24', '2026-10-27', broken, now);
    expect(Object.keys(result.days)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
    expect(Object.values(result.days).every((day) => day.evaluation.items.length === 0 && day.metrics.periodDurationMs === 86_400_000)).toBe(true);
  });

  it('keeps a hidden reserved item out of the day while still subtracting its time', () => {
    const workspace = createWorkspace('Calendar reserve', now);
    workspace.calendarPreferences.timezone = 'UTC';
    const sleep = createItem('Sleep', 'event', now);
    sleep.id = 'sleep';
    sleep.schedule = { timezone: 'UTC', startAt: '2026-08-31T10:00:00.000Z', endAt: '2026-08-31T12:00:00.000Z', estimatedDuration: 'PT2H' };
    workspace.items = { sleep };
    const preferences = settings(['event']);
    preferences.filter.source = 'id != "sleep"';
    preferences.statistics = { showTime: true, reservedItemIds: ['sleep'] };

    const result = evaluateCalendarRange(workspace, '2026-08-31', '2026-09-01', preferences, now);
    expect(result.days['2026-08-31']!.evaluation.items).toEqual([]);
    expect(result.days['2026-08-31']!.metrics.reservedDurationMs).toBe(2 * 60 * 60 * 1_000);
    expect(result.days['2026-08-31']!.metrics.freeDurationMs).toBe(22 * 60 * 60 * 1_000);
  });
});
