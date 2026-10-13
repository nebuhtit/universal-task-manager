import { createItem, createWorkspace, type WorkspaceDocument } from '@utm/core';
import { describe, expect, it } from 'vitest';
import { createCalendarPageCache } from './calendarPageCache';
import { evaluateCalendarRange } from './calendarEvaluation';
import { calendarVisibleCapacity } from './calendarCapacity';
import { calendarUndatedItems } from './calendarVisibility';
import { setCompletionHold } from '../views/viewSelectors';
import { buildCalendarPlan, calendarPlanMetricItems } from './calendarPlanning';

const now = new Date('2026-09-24T08:00:00Z');
const shift = (key: string, days: number) => new Date(Date.parse(key + 'T12:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);
function fixture() {
  const workspace = createWorkspace('Prepared slides', now);
  workspace.calendarPreferences.timezone = 'UTC';
  workspace.calendarPreferences.dayView.filter.source = 'state == "open"';
  const item = createItem('Current title', 'event', now); item.id = 'event';
  item.schedule = { timezone: 'UTC', startAt: '2026-09-24T09:00:00Z', endAt: '2026-09-24T10:00:00Z', estimatedDuration: 'PT1H' };
  workspace.items.event = item;
  return workspace;
}

describe('bounded prepared calendar slides', () => {
  it('keeps planning, capacity and source data unchanged while preparing adjacent periods', () => {
    const workspace = fixture(); workspace.calendarPreferences.planning = { enabled: true };
    const task = createItem('Flexible task', 'task', now); task.id = 'flexible';
    task.schedule = { timezone: 'UTC', plannedDate: '2026-09-24', estimatedDuration: 'PT30M', dueAt: '2026-09-24T13:00:00Z' };
    workspace.items.flexible = task;
    const before = JSON.stringify(workspace), cache = createCalendarPageCache(workspace.workspaceId);
    const result = cache.rangeFor(workspace, '2026-09-21', '2026-09-28', now, now, true);
    cache.rangeFor(workspace, '2026-09-28', '2026-10-05', now, now, true);
    const day = result.calendar.days['2026-09-24']!;
    const plan = buildCalendarPlan(workspace, '2026-09-24', result.preparedDays!['2026-09-24']!, now, day.reservedItems);
    expect(result.plans!['2026-09-24']).toEqual(plan);
    expect(result.capacities['2026-09-24']).toEqual(calendarVisibleCapacity(workspace, { ...day, evaluation: { ...day.evaluation, items: calendarPlanMetricItems(plan, day.evaluation.items) } }, '2026-09-24', now, result.undated.filter(item => !plan.ids.includes(item.id)), true));
    expect(cache.peekRange(workspace, '2026-09-21', '2026-09-28', now, now, false)).toBeUndefined();
    expect(JSON.stringify(workspace)).toBe(before);
  });
  it('reuses the already prepared range after warming both neighbours, with exact reference results', () => {
    const workspace = fixture(), cache = createCalendarPageCache(workspace.workspaceId);
    const original = JSON.stringify(workspace);
    const current = cache.rangeFor(workspace, '2026-09-21', '2026-09-28', now, now, true);
    for (const start of ['2026-09-14', '2026-09-28']) cache.rangeFor(workspace, start, shift(start, 7), now, now, true);
    const builds = { ...cache.evaluator.counters, ...cache.evaluator.projections.counters };
    expect(cache.rangeFor(workspace, '2026-09-21', '2026-09-28', now, now, true)).toBe(current);
    expect({ ...cache.evaluator.counters, ...cache.evaluator.projections.counters }).toEqual(builds);
    const reference = evaluateCalendarRange(workspace, '2026-09-21', '2026-09-28', workspace.calendarPreferences.dayView, now);
    expect(current.calendar).toEqual(reference);
    for (const [key, day] of Object.entries(reference.days)) expect(current.capacities[key]).toEqual(calendarVisibleCapacity(workspace, day, key, now, calendarUndatedItems(workspace, now), true));
    expect(JSON.stringify(workspace)).toBe(original);
    cache.rangeFor(workspace, '2026-10-05', '2026-10-12', now, now, true);
    expect(cache.peekRange(workspace, '2026-09-14', '2026-09-21', now, now, true)).toBeUndefined();
  });

  it('never serves old slides after same-revision content, duration, deletion or settings changes', () => {
    let workspace = fixture(); const cache = createCalendarPageCache(workspace.workspaceId);
    const read = (source: WorkspaceDocument) => cache.rangeFor(source, '2026-09-21', '2026-09-28', now, now, true);
    read(workspace); cache.timelineFor(workspace, '2026-09-24', now);
    for (const mutate of [
      (draft: WorkspaceDocument) => { draft.items.event!.title = 'New title'; },
      (draft: WorkspaceDocument) => { draft.items.event!.schedule!.endAt = '2026-09-24T12:00:00Z'; },
      (draft: WorkspaceDocument) => { draft.calendarPreferences.timezone = 'Europe/Moscow'; },
      (draft: WorkspaceDocument) => { draft.tombstones.event = now.toISOString(); },
    ]) {
      workspace = structuredClone(workspace); mutate(workspace);
      expect(cache.peekRange(workspace, '2026-09-21', '2026-09-28', now, now, true)).toBeUndefined();
      expect(cache.peekTimeline(workspace, '2026-09-24', now)).toBeUndefined();
      expect(read(workspace).calendar).toEqual(evaluateCalendarRange(workspace, '2026-09-21', '2026-09-28', workspace.calendarPreferences.dayView, now));
      cache.timelineFor(workspace, '2026-09-24', now);
    }
  });

  it('refreshes clock/completion dependencies and only recalculates capacity for its own clock', () => {
    const workspace = fixture(), cache = createCalendarPageCache(workspace.workspaceId);
    const first = cache.rangeFor(workspace, '2026-09-21', '2026-09-28', now, now, true);
    const later = new Date(+now + 60_000);
    expect(cache.peekRange(workspace, '2026-09-21', '2026-09-28', later, now, true)).toBeUndefined();
    const capacity = cache.rangeFor(workspace, '2026-09-21', '2026-09-28', now, later, true);
    expect(capacity.calendar).toBe(first.calendar);
    expect(capacity.capacities['2026-09-24']!.freeMs).toBeLessThan(first.capacities['2026-09-24']!.freeMs);
    const previous = workspace.items.event!;
    setCompletionHold(previous.id, { previous, undoUntil: Date.now() + 3000, removeAt: Date.now() + 3200 });
    try { expect(cache.peekRange(workspace, '2026-09-21', '2026-09-28', now, later, true)).toBeUndefined(); }
    finally { setCompletionHold(previous.id); }
    for (const key of ['2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26']) cache.timelineFor(workspace, key, now);
    expect(cache.peekTimeline(workspace, '2026-09-23', now)).toBeUndefined();
    const warmed = cache.peekTimeline(workspace, '2026-09-25', now);
    expect(cache.timelineFor(workspace, '2026-09-25', now)).toBe(warmed);
  });
});
