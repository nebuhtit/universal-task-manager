import { describe, expect, it } from 'vitest';
import { createItem, createOccurrence, createWorkspace, fromCanonicalJSON, toCanonicalJSON, validateWorkspace, type UniversalItem } from '@utm/core';
import { buildCalendarPlan, activeCalendarPins, calendarPlanMetricItems, calendarReorderIssue, createCalendarPlanCache, dueBoundary, naturallyOnDay, parallelPlacementIssue, planningEnabled, referenceKey, removeCalendarPin, resolveCalendarSource, sameTimeInterval, setCalendarPin, sourceReference, validateCalendarMove } from './calendarPlanning';
import { prepareTimelineData } from './timelineData';
import { calendarVisibleCapacity } from './calendarCapacity';
import { evaluateCalendarRange } from './calendarEvaluation';

const day = '2026-09-24', tomorrow = '2026-09-25', now = new Date(`${day}T08:00:00Z`);
const at = (hour: number) => `${day}T${String(hour).padStart(2, '0')}:00:00Z`;
function fixture() {
  const w = createWorkspace('Planning test', now);
  w.calendarPreferences.timezone = 'UTC'; w.calendarPreferences.dayView.filter.source = 'true';
  w.calendarPreferences.timeline = { mode: 'timeline', hideSleep: false, showUndated: true };
  const task = createItem('task', 'task', now); task.id = 'task'; task.schedule = { timezone: 'UTC', estimatedDuration: 'PT1H' };
  const event = createItem('event', 'event', now); event.id = 'event'; event.schedule = { timezone: 'UTC', startAt: at(10), endAt: at(11), travelDuration: 'PT30M', travelBackDuration: 'PT30M', estimatedDuration: 'PT1H' };
  w.items = { task, event };
  return { w, task, event };
}
const pin = (item: UniversalItem, day: string, mode: 'queue' | 'same_time' = 'queue') => ({ ...sourceReference(item), day, mode });
const ms = (hour: number) => Date.parse(at(hour));
describe('calendar references and manual placement', () => {
  it('clears a pinned parallel placement when changing its day or unpinning', () => {
    const { w, task } = fixture(), source = JSON.stringify(w.items);
    setCalendarPin(w, pin(task, day));
    w.calendarPreferences.planning!.parallel = { [day]: { task: at(9) } };
    setCalendarPin(w, pin(task, tomorrow));
    expect(w.calendarPreferences.planning!.parallel![day]!.task).toBeUndefined();
    w.calendarPreferences.planning!.parallel![tomorrow] = { task: `${tomorrow}T09:00:00Z` };
    removeCalendarPin(w, sourceReference(task));
    expect(w.calendarPreferences.planning!.parallel![tomorrow]!.task).toBeUndefined();
    expect(JSON.stringify(w.items)).toBe(source);
  });
  it('uses this weekly occurrence Due and isolates its parallel reference from next week', () => {
    const { w, task } = fixture();
    task.role = 'series_template';
    task.schedule = { timezone: 'UTC', startAt: '2026-09-07T00:00:00Z', dueAt: '2026-09-10T19:00:00Z', estimatedDuration: 'PT1H' };
    task.recurrence = { rrule: 'FREQ=WEEKLY', timezone: 'UTC', exdates: [], rdates: [], anchor: 'schedule', closeAt: 'due', autoRenew: true };
    const prepared = prepareTimelineData(w, day, now), occurrence = prepared.activeRange[0]!;
    expect(occurrence.schedule!.dueAt).toBe('2026-09-24T19:00:00.000Z');
    w.calendarPreferences.planning = { parallel: { [day]: { [occurrence.id]: at(10) } } };
    const plan = buildCalendarPlan(w, day, prepared, now);
    expect(plan.events.find(v => v.item.id === occurrence.id)!.end - ms(10)).toBe(15 * 60000);
    const next = prepareTimelineData(w, '2026-10-01', now);
    expect(next.activeRange[0]!.schedule!.dueAt).toBe('2026-10-01T19:00:00.000Z');
    expect(buildCalendarPlan(w, '2026-10-01', next, now).parallel.size).toBe(0);
    expect(task.schedule.dueAt).toBe('2026-09-10T19:00:00Z');
  });
  it('repairs both stale active-range positions without rewriting sources and is idempotent', () => {
    const { w, task, event } = fixture();
    task.schedule = { timezone: 'UTC', startAt: '2026-09-21T00:00:00Z', dueAt: at(19), estimatedDuration: 'PT45M' };
    const other = { ...task, id: 'other', schedule: { ...task.schedule, dueAt: at(18), estimatedDuration: 'PT30M' } };
    w.items.other = other; event.schedule!.startAt = at(19); event.schedule!.endAt = at(20);
    w.calendarPreferences.planning = { orders: { [day]: ['event', 'task', 'other'] } };
    const source = JSON.stringify(w.items), prepared = prepareTimelineData(w, day, now);
    const plan = buildCalendarPlan(w, day, prepared, now);
    expect(plan.repairedOrder).toEqual(['task', 'other', 'event']);
    expect(plan.unplaced).toEqual([]);
    expect(plan.proposals.every(v => v.end <= dueBoundary(v.item, 'UTC'))).toBe(true);
    w.calendarPreferences.planning.orders![day] = plan.repairedOrder!;
    expect(buildCalendarPlan(w, day, prepared, now).repairedOrder).toBeNull();
    expect(JSON.stringify(w.items)).toBe(source);
  });
  it('permits repairing one old Due conflict while another remains', () => {
    const { w, task } = fixture(); task.schedule!.dueAt = at(10);
    w.items.other = { ...task, id: 'other' };
    const prepared = prepareTimelineData(w, day, now);
    const before = buildCalendarPlan(w, day, prepared, now, [], ['event', 'task', 'other']);
    const after = buildCalendarPlan(w, day, prepared, now, [], ['task', 'event', 'other']);
    expect(calendarReorderIssue(before, after, 'task', now, 'UTC', false)).toBeNull();
    expect(after.orderConflicts.has('other')).toBe(true);
  });
  it('parallel references overlap reservations but preserve Due, sources and union statistics', () => {
    const { w, task, event } = fixture(); task.schedule!.dueAt = at(12);
    w.calendarPreferences.planning = { parallel: { [day]: { task: at(10) } } };
    const source = JSON.stringify(w.items), prepared = prepareTimelineData(w, day, now);
    const plan = buildCalendarPlan(w, day, prepared, now, [event]);
    expect(plan.parallel.has(task.id)).toBe(true);
    expect(plan.events.find(v => v.item.id === task.id)?.start).toBe(ms(10));
    expect(parallelPlacementIssue(task, day, ms(12), 3600000, now, 'UTC')).toBe('deadline');
    const evaluated = evaluateCalendarRange(w, day, tomorrow, w.calendarPreferences.dayView, now).days[day]!;
    const metricDay = { ...evaluated, evaluation: { ...evaluated.evaluation, items: calendarPlanMetricItems(plan, evaluated.evaluation.items) } };
    expect(calendarVisibleCapacity(w, metricDay, day, now, [task], true).freeMs).toBe(14 * 3600000);
    expect(validateWorkspace(w)).toEqual({ valid: true, errors: [] });
    expect(fromCanonicalJSON(toCanonicalJSON(w)).calendarPreferences.planning).toEqual(w.calendarPreferences.planning);
    expect(JSON.stringify(w.items)).toBe(source);
    expect(buildCalendarPlan(w, day, prepared, new Date(`${tomorrow}T00:00:00Z`)).parallel.size).toBe(0);
    delete w.calendarPreferences.planning.parallel![day]!.task;
    expect(buildCalendarPlan(w, day, prepared, now).parallel.size).toBe(0);
    task.state = 'done';
    w.calendarPreferences.planning.parallel![day]!.task = at(10);
    expect(buildCalendarPlan(w, day, prepareTimelineData(w, day, now), now).parallel.size).toBe(0);
  });
  it('places active-range daily shares after anchors and travel back in the saved order', () => {
    const { w, task, event } = fixture();
    task.schedule = { timezone: 'UTC', startAt: '2026-09-23T08:00:00Z', dueAt: '2026-09-25T18:00:00Z', estimatedDuration: 'PT1H' };
    const source = JSON.stringify(w.items), prepared = prepareTimelineData(w, day, now);
    const before = buildCalendarPlan(w, day, prepared, now);
    const after = buildCalendarPlan(w, day, prepared, now, [], ['event', 'task']);
    expect(after.activeRanges.has(task.id)).toBe(true);
    expect(after.proposals[0]!.start).toBe(ms(11) + 30 * 60_000);
    expect(after.proposals[0]!.end - after.proposals[0]!.start).toBe(20 * 60_000);
    expect(calendarReorderIssue(before, after, event.id, now, 'UTC', true)).toBeNull();
    expect(calendarPlanMetricItems(after, [task, event]).find(item => item.id === task.id)).toBe(task);
    expect(JSON.stringify(w.items)).toBe(source);
  });
  it('rejects moving an anchor above active-range work with an earlier future Due', () => {
    const { w, task, event } = fixture();
    task.schedule = { timezone: 'UTC', startAt: '2026-09-23T08:00:00Z', dueAt: at(10), estimatedDuration: 'PT1H' };
    const prepared = prepareTimelineData(w, day, now), before = buildCalendarPlan(w, day, prepared, now);
    const after = buildCalendarPlan(w, day, prepared, now, [], ['event', 'task']);
    expect(calendarReorderIssue(before, after, event.id, now, 'UTC', true)).toMatchObject({ item: { id: task.id }, reason: 'deadline' });
  });
  it('accepts an anchor moved to the top when capacity leaves a task visible but unplaced', () => {
    const { w, task, event } = fixture();
    event.schedule!.startAt = at(22); event.schedule!.endAt = '2026-09-24T23:15:00Z';
    const prepared = prepareTimelineData(w, day, now), before = buildCalendarPlan(w, day, prepared, now);
    const after = buildCalendarPlan(w, day, prepared, now, [], ['event', 'task']);
    expect(after.unplaced.map(item => item.id)).toContain(task.id);
    expect(calendarReorderIssue(before, after, event.id, now, 'UTC', true)).toBeNull();
    expect(after.items.map(item => item.id)).toEqual(['event', 'task']);
  });
  it('moves start-only items but leaves complete event intervals fixed on Timeline', () => {
    const { w, task, event } = fixture(); task.schedule!.startAt = at(9);
    const before = JSON.stringify(w.items);
    const plan = buildCalendarPlan(w, day, prepareTimelineData(w, day, now), now, [], ['event', 'task']);
    expect(plan.movable.has(task.id)).toBe(true);
    expect(plan.movable.has(event.id)).toBe(false);
    expect(plan.fixed.get(event.id)?.start).toBe(ms(10));
    expect(plan.proposals.find(value => value.item.id === task.id)?.start).toBe(ms(11) + 30 * 60_000);
    expect(validateCalendarMove(plan, event.id, now, 'UTC')).toBe('fixed');
    expect(validateCalendarMove(plan, event.id, now, 'UTC', true)).toBeNull();
    expect(JSON.stringify(w.items)).toBe(before);
  });
  it('reuses other days across minute ticks, invalidates today and midnight', () => {
    const { w } = fixture(), cache = createCalendarPlanCache(), prepared = prepareTimelineData(w, tomorrow, now), reserved: UniversalItem[] = [];
    const first = cache(w, tomorrow, prepared, now, reserved);
    expect(cache(w, tomorrow, prepared, new Date(+now + 60_000), reserved)).toBe(first);
    expect(cache(w, tomorrow, prepared, new Date(`${tomorrow}T00:00:00Z`), reserved)).not.toBe(first);
    const todayPrepared = prepareTimelineData(w, day, now), todayPlan = cache(w, day, todayPrepared, now, reserved);
    expect(cache(w, day, todayPrepared, new Date(+now + 60_000), reserved)).not.toBe(todayPlan);
  });
  it('defaults enabled, can disable without losing references or source data', () => {
    const { w, task } = fixture(), source = JSON.stringify(w.items);
    expect(planningEnabled(w)).toBe(true); setCalendarPin(w, pin(task, tomorrow));
    w.calendarPreferences.planning!.enabled = false;
    expect(activeCalendarPins(w, tomorrow, now)).toEqual([]);
    expect(w.calendarPreferences.planning!.pins).toHaveProperty(task.id);
    expect(JSON.stringify(w.items)).toBe(source);
  });
  it('roundtrips through workspace schema, including per-day orders', () => {
    const { w, task } = fixture(); setCalendarPin(w, pin(task, tomorrow));
    w.calendarPreferences.planning!.orders = { [day]: ['event', 'task'] };
    expect(validateWorkspace(w)).toEqual({ valid: true, errors: [] });
    expect(fromCanonicalJSON(toCanonicalJSON(w)).calendarPreferences.planning).toEqual(w.calendarPreferences.planning);
  });
  it('keeps a single reference when changing day; unpin never deletes items', () => {
    const { w, task } = fixture(), source = JSON.stringify(w.items);
    setCalendarPin(w, pin(task, day)); setCalendarPin(w, pin(task, tomorrow));
    expect(Object.keys(w.calendarPreferences.planning!.pins!)).toEqual(['task']);
    expect(activeCalendarPins(w, day, now)).toEqual([]);
    removeCalendarPin(w, sourceReference(task)); expect(JSON.stringify(w.items)).toBe(source);
  });
  it('expires on local midnight without a write; deletion and completion do not reserve', () => {
    const { w, task } = fixture(); setCalendarPin(w, pin(task, day));
    const saved = JSON.stringify(w);
    expect(activeCalendarPins(w, day, new Date(`${day}T23:59:59Z`))).toHaveLength(1);
    expect(activeCalendarPins(w, day, new Date(`${tomorrow}T00:00:00Z`))).toHaveLength(0);
    expect(JSON.stringify(w)).toBe(saved);
    task.state = 'done'; expect(activeCalendarPins(w, day, now)).toHaveLength(0);
    task.state = 'open'; task.deletedAt = now.toISOString(); expect(activeCalendarPins(w, day, now)).toHaveLength(0);
  });
  it('pins one virtual occurrence without materializing it', () => {
    const { w, task } = fixture(); task.role = 'series_template'; task.schedule!.startAt = at(7);
    task.recurrence = { rrule: 'FREQ=DAILY', timezone: 'UTC', exdates: [], rdates: [], anchor: 'schedule', closeAt: 'due', autoRenew: false };
    const occurrence = createOccurrence(task, new Date(at(7)), 0), ref = sourceReference(occurrence);
    setCalendarPin(w, pin(occurrence, tomorrow));
    expect(resolveCalendarSource(w, ref)?.id).toBe(occurrence.id);
    expect(w.items[occurrence.id]).toBeUndefined();
    expect(referenceKey(ref)).toContain(occurrence.occurrence!.recurrenceId);
    task.recurrence.exdates.push(ref.recurrenceId!); expect(resolveCalendarSource(w, ref)).toBeNull();
  });
  it('same-time placement preserves wall time across DST and original interval duration', () => {
    const { event } = fixture(); event.schedule!.startAt = '2026-10-24T07:30:00Z'; event.schedule!.endAt = '2026-10-24T09:30:00Z';
    const slot = sameTimeInterval(event, '2026-10-25', 'Europe/Berlin')!;
    expect(new Date(slot.start).toISOString()).toBe('2026-10-25T08:30:00.000Z'); expect(slot.end - slot.start).toBe(7_200_000);
  });
  it('does not add a second card when the original is present', () => {
    const { w, event } = fixture(); setCalendarPin(w, pin(event, day, 'same_time'));
    const prepared = prepareTimelineData(w, day, now), result = buildCalendarPlan(w, day, prepared, now);
    expect(naturallyOnDay(event, prepared, day)).toBe(true);
    expect(result.pins.size).toBe(0); expect(result.events.filter(e => e.item.id === event.id && !e.travel)).toHaveLength(1);
  });
  it('queues an old event using its estimate, without rewriting dates or Google data', () => {
    const { w, event } = fixture(); setCalendarPin(w, pin(event, tomorrow)); const source = JSON.stringify(w.items);
    event.schedule!.estimatedDuration = 'PT30M'; const changedSource = JSON.stringify(w.items);
    const result = buildCalendarPlan(w, tomorrow, prepareTimelineData(w, tomorrow, now), now);
    expect(result.proposals.find(e => e.item.id === event.id)!.end - result.proposals.find(e => e.item.id === event.id)!.start).toBe(1_800_000);
    expect(JSON.stringify(w.items)).toBe(changedSource); expect(changedSource).not.toBe(source);
  });
  it('same-time conflicts with reservations remain unplaced and queue can fit', () => {
    const { w, event } = fixture();
    const hidden = createItem('hidden', 'event', now); hidden.schedule = { timezone: 'UTC', startAt: `${tomorrow}T10:00:00Z`, endAt: `${tomorrow}T12:00:00Z` };
    setCalendarPin(w, pin(event, tomorrow, 'same_time'));
    const prepared = prepareTimelineData(w, tomorrow, now);
    const blocked = buildCalendarPlan(w, tomorrow, prepared, now, [hidden]);
    expect(blocked.warnings.find(v => v.item.id === event.id)?.reason).toBe('conflict');
    setCalendarPin(w, pin(event, tomorrow));
    expect(buildCalendarPlan(w, tomorrow, prepared, now, [hidden]).proposals.some(v => v.item.id === event.id)).toBe(true);
  });
  it('reorders immediately after travel back and respects hidden reserve', () => {
    const { w } = fixture();
    const hidden = createItem('hidden', 'event', now); hidden.schedule = { timezone: 'UTC', startAt: at(12), endAt: at(13) };
    const result = buildCalendarPlan(w, day, prepareTimelineData(w, day, now), now, [hidden], ['event', 'task']);
    expect(result.proposals[0]!.start).toBe(ms(13));
    const clear = buildCalendarPlan(w, day, prepareTimelineData(w, day, now), now, [], ['event', 'task']);
    expect(clear.proposals[0]!.start).toBe(ms(11) + 30 * 60_000);
  });
  it('rejects future due after an event starting exactly at due', () => {
    const { w, task } = fixture(); task.schedule!.dueAt = at(10);
    const result = buildCalendarPlan(w, day, prepareTimelineData(w, day, now), now, [], ['event', 'task']);
    expect(validateCalendarMove(result, task.id, now, 'UTC')).toBe('deadline');
  });
  it('allows a due task after travel back with evaluator reservations', () => {
    const { w, task } = fixture(); task.schedule!.dueAt = at(12); task.schedule!.estimatedDuration = 'PT30M';
    const migrated = fromCanonicalJSON(toCanonicalJSON(w));
    const evaluated = evaluateCalendarRange(migrated, day, tomorrow, migrated.calendarPreferences.dayView, now).days[day]!;
    const result = buildCalendarPlan(migrated, day, prepareTimelineData(migrated, day, now), now, evaluated.reservedItems, ['event', 'task']);
    expect(result.warnings).toEqual([]);
    expect(validateCalendarMove(result, 'task', now, 'UTC')).toBeNull();
  });
  it('allows overdue work after event and preserves its deadline', () => {
    const { w, task } = fixture(); task.schedule!.dueAt = at(7);
    const result = buildCalendarPlan(w, day, prepareTimelineData(w, day, now), now, [], ['event', 'task']);
    expect(validateCalendarMove(result, task.id, now, 'UTC')).toBeNull();
    expect(result.proposals[0]!.start).toBe(ms(11) + 1_800_000); expect(task.schedule!.dueAt).toBe(at(7));
  });
  it('treats date-only due as the end of its local day', () => {
    const { task } = fixture(); task.schedule!.dueAt = at(0); task.schedule!.dueDateOnly = true;
    expect(dueBoundary(task, 'UTC')).toBe(Date.parse(`${tomorrow}T00:00:00Z`));
  });
  it('plans date-only due on its own day, not at the previous midnight', () => {
    const { w, task } = fixture(); task.schedule!.dueAt = at(0); task.schedule!.dueDateOnly = true;
    const result = buildCalendarPlan(w, day, prepareTimelineData(w, day, now), now, [], ['event', 'task']);
    expect(result.movable.has(task.id)).toBe(true); expect(result.proposals[0]!.start).toBe(ms(11) + 1_800_000);
    expect(validateCalendarMove(result, task.id, now, 'UTC')).toBeNull();
  });
  it('avoids a selected sleep source and never treats missing sleep id as all events', () => {
    const { w, event } = fixture(); const prepared = prepareTimelineData(w, day, now);
    expect(prepared.sleep).toEqual([]);
    w.calendarPreferences.timeline!.sleepItemId = event.id; w.calendarPreferences.timeline!.hideSleep = true;
    const result = buildCalendarPlan(w, day, prepareTimelineData(w, day, now), now, [], ['event', 'task']);
    expect(result.proposals[0]!.start).toBeGreaterThanOrEqual(ms(11) + 1_800_000);
  });
  it('never changes a linked Google source, reminders, history or outbox while planning', () => {
    const { w, event } = fixture();
    event.external = { provider: 'google_calendar', calendarId: 'fixture-calendar', eventId: 'fixture-event', connectionId: 'fixture', sourceUrl: 'https://calendar.google.com/', syncedAt: now.toISOString(), readOnly: false, startAt: at(10), endAt: at(11) };
    event.extensions = { 'utm:googleLinkKey': 'fixture-key' };
    event.reminders = [{ id: 'reminder', mode: 'absolute', at: at(9), urgency: 'normal', repeatUntilAcknowledged: false }];
    const source = JSON.stringify(w.items);
    setCalendarPin(w, pin(event, tomorrow, 'queue'));
    const plan = buildCalendarPlan(w, tomorrow, prepareTimelineData(w, tomorrow, now), now, [], ['event']);
    calendarPlanMetricItems(plan, []); removeCalendarPin(w, sourceReference(event));
    expect(JSON.stringify(w.items)).toBe(source);
  });
  it('keeps duration intact when no full gap remains', () => {
    const { w, task } = fixture(); task.schedule!.estimatedDuration = 'PT24H';
    const result = buildCalendarPlan(w, day, prepareTimelineData(w, day, now), now);
    expect(result.unplaced.map(item => item.id)).toContain(task.id); expect(task.schedule!.estimatedDuration).toBe('PT24H');
  });
  it('does not double count pins in daily statistics', () => {
    const { w, event } = fixture(); w.calendarPreferences.timeline!.showUndated = false;
    setCalendarPin(w, pin(event, tomorrow, 'same_time'));
    const evaluated = evaluateCalendarRange(w, tomorrow, '2026-09-26', w.calendarPreferences.dayView, now).days[tomorrow]!;
    const plan = buildCalendarPlan(w, tomorrow, prepareTimelineData(w, tomorrow, now), now);
    const metricDay = { ...evaluated, evaluation: { ...evaluated.evaluation, items: calendarPlanMetricItems(plan, evaluated.evaluation.items) } };
    expect(calendarVisibleCapacity(w, metricDay, tomorrow, now, [], true).freeMs).toBe(23 * 3_600_000);
  });
});
