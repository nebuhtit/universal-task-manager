import { expect, it } from 'vitest';
import { createItem, createWorkspace } from '@utm/core';
import { dayBounds, itemInterval } from './timelineLayout';
import { planUndatedTasks } from './timelinePlanning';
import { timelineData } from './timelineData';

const now = new Date('2026-09-22T12:00:00Z');
const day = dayBounds('2026-09-22', 'UTC');
const hour = (h: number) => day.start + h * 3600000;
function task(id: string, duration = 'PT1H') {
  return { ...createItem(id, 'task', now), id, schedule: { timezone: 'UTC', estimatedDuration: duration } };
}
const sleep = [{ start: hour(0), end: hour(8) }, { start: hour(22), end: hour(24) }];
it('packs tasks after sleep around events and TT, unions busy time, without mutations', () => {
  const tasks = [task('a', 'PT2H'), task('b'), task('c')];
  const meeting = task('meeting');
  const events = [
    { item: meeting, start: hour(9), end: hour(10), point: false, invalid: false, travel: true },
    { item: meeting, start: hour(10), end: hour(11), point: false, invalid: false },
    { item: task('overlap'), start: hour(10), end: hour(12), point: false, invalid: false },
  ];
  const before = JSON.stringify({ tasks, events, sleep });
  const result = planUndatedTasks(tasks, events, sleep, day);
  expect(result.proposals.map(v => [v.item.id, v.start, v.end])).toEqual([
    ['a', hour(12), hour(14)], ['b', hour(8), hour(9)], ['c', hour(14), hour(15)],
  ]);
  expect(result.calendarFreeMs).toBe(11 * 3600000);
  expect(result.remainingMs).toBe(7 * 3600000);
  expect(JSON.stringify({ tasks, events, sleep })).toBe(before);
});
it('reports shortage and separately handles fragmented free time', () => {
  const result = planUndatedTasks([task('a', 'PT20H')], [], sleep, day);
  expect(result.remainingMs).toBe(-6 * 3600000);
  expect(result.unplaced.map(v => v.id)).toEqual(['a']);
  const event = { item: task('event'), start: hour(12), end: hour(18), point: false, invalid: false };
  const fragmented = planUndatedTasks([task('long', 'PT5H')], [event], sleep, day);
  expect(fragmented.remainingMs).toBe(3 * 3600000);
  expect(fragmented.proposals).toHaveLength(0);
  expect(fragmented.unplaced).toHaveLength(1);
});
it('excludes notes, closed tasks, dates, all-day and recurrence templates', () => {
  const base = task('skip');
  const items = [
    { ...base, isNote: true }, { ...base, state: 'done' as const }, { ...base, canBeCompleted: false },
    { ...base, role: 'series_template' as const }, { ...base, schedule: { ...base.schedule, allDay: true } },
    ...['startAt', 'endAt', 'dueAt', 'availableFrom'].map(key => ({ ...base, schedule: { ...base.schedule, [key]: now.toISOString() } })),
    task('zero', 'PT0S'),
  ];
  expect(planUndatedTasks(items, [], [], day).taskDurationMs).toBe(0);
});
it.each([['2026-03-29', 23], ['2026-10-25', 25]])('uses real elapsed hours on DST day %s', (key, length) => {
  const bounds = dayBounds(String(key), 'Europe/Berlin');
  const result = planUndatedTasks([task('a')], [], [], bounds);
  expect(result.calendarFreeMs).toBe(Number(length) * 3600000);
  expect(result.proposals[0]?.start).toBe(bounds.start);
  expect(result.remainingMs).toBe((Number(length) - 1) * 3600000);
});
it('keeps proposals identical in full/hidden sleep and preserves due placement and source data', () => {
  const w = createWorkspace('Test', now); w.calendarPreferences.timezone = 'UTC';
  w.calendarPreferences.dayView.filter.source = 'true';
  const sleeper = task('sleep'); sleeper.schedule = { ...sleeper.schedule, ...{ startAt: new Date(hour(0)).toISOString(), endAt: new Date(hour(8)).toISOString() } };
  const due = { ...task('due'), schedule: { ...task('due').schedule, dueAt: new Date(hour(17)).toISOString() } };
  const todo = task('todo');
  w.items = { sleep: sleeper, due, todo };
  w.calendarPreferences.timeline = { mode: 'timeline', hideSleep: false, sleepItemId: 'sleep' };
  const before = JSON.stringify(w);
  const full = timelineData(w, '2026-09-22', now);
  expect(full.planning.proposals[0]).toMatchObject({ start: hour(8), end: hour(9), tentative: true });
  expect(full.events.find(v => v.item.id === 'due')).toMatchObject(itemInterval(due)!);
  expect(full.undated).toHaveLength(0);
  expect(JSON.stringify(w)).toBe(before);
  w.calendarPreferences.timeline.hideSleep = true;
  const hidden = timelineData(w, '2026-09-22', now);
  expect(hidden.planning).toEqual(full.planning);
  w.calendarPreferences.dayView.filter.source = 'title == "due"';
  expect(timelineData(w, '2026-09-22', now).planning.taskDurationMs).toBe(0);
});
