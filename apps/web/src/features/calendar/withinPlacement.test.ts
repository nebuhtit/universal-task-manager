import { describe, it, expect } from 'vitest';
import { createWorkspace, createItem, withinPlacementWorkspace } from '@utm/core';
import { evaluateCalendarRange } from './calendarEvaluation';
import { prepareTimelineData } from './timelineData';
import { calendarVisibleCapacity } from './calendarCapacity';
import { buildCalendarPlan, calendarPlanMetricItems } from './calendarPlanning';
import { itemEditorSource } from '../items/editor/itemEditorSource';
import { createQuickEntryItem } from '../items/quickEntry';

describe('within placement calendar integration', () => {
  it.each([false, true])('shares intervals across list, timeline and planning capacity, including missed day=%s', (missed) => {
    const now = new Date('2026-10-06T07:00:00Z');
    const workspace = createWorkspace('Within integration', now); workspace.calendarPreferences.timezone = 'UTC';
    const work = createItem('Work', 'event', now); work.id = 'work';
    work.schedule = { timezone: 'UTC', startAt: '2026-10-06T09:00:00Z', endAt: '2026-10-06T17:00:00Z' };
    workspace.items.work = work;
    const task = createQuickEntryItem('Wash rr [Work](item:work) дл 3ч', now, undefined, [], workspace);
    workspace.items[task.id] = task;
    workspace.calendarPreferences.dayView.filter.source = 'id != "work"';
    workspace.calendarPreferences.dayView.statistics = { showTime: true, reservedItemIds: ['work'] };
    expect(task.schedule?.plannedDate).toBe('2026-10-06');
    if (missed) task.schedule!.plannedDate = '2026-10-05';
    const evaluation = evaluateCalendarRange(workspace, '2026-10-06', '2026-10-07', workspace.calendarPreferences.dayView, now).days['2026-10-06']!;
    const prepared = prepareTimelineData(workspace, '2026-10-06', now);
    expect(prepared.events.filter(e => e.item.id === task.id)).toHaveLength(1);
    expect(prepared.events[0]!.start).toBe(Date.parse('2026-10-06T09:00:00Z'));
    expect(evaluation.evaluation.items.find(i => i.id === task.id)?.schedule?.startAt).toBe('2026-10-06T09:00:00.000Z');
    const plan = buildCalendarPlan(workspace, '2026-10-06', prepared, now, evaluation.reservedItems);
    const day = { ...evaluation, evaluation: { ...evaluation.evaluation, items: calendarPlanMetricItems(plan, evaluation.evaluation.items) } };
    expect(calendarVisibleCapacity(workspace, day, '2026-10-06', now, [], true).freeMs).toBe(9 * 3600000);
    expect(itemEditorSource(workspace, prepared.events[0]!.item)).toBe(task);
    expect(task.schedule?.startAt).toBeUndefined();
    const restored = JSON.parse(JSON.stringify(workspace));
    expect(withinPlacementWorkspace(restored, now).items[task.id]?.schedule?.startAt).toBe('2026-10-06T09:00:00.000Z');
    expect(task.schedule?.plannedDate).toBe(missed ? '2026-10-05' : '2026-10-06');
  });
});
