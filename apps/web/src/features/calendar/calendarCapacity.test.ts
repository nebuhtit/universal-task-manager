import { createItem, createWorkspace } from '@utm/core';
import { describe, expect, it } from 'vitest';
import { calendarVisibleCapacity } from './calendarCapacity';
import { evaluateCalendarRange } from './calendarEvaluation';
import { calendarUndatedItems } from './calendarVisibility';

describe('calendar visible capacity', () => {
  it('subtracts the daily share of a hidden active-range reserve on each active day', () => {
    const now = new Date('2026-09-22T12:00:00Z');
    const workspace = createWorkspace('Flexible reserve', now);
    workspace.calendarPreferences.timezone = 'UTC';
    workspace.calendarPreferences.dayView.filter.source = 'title != "Hidden range"';
    const task = createItem('Hidden range', 'task', now);
    task.schedule = { timezone: 'UTC', startAt: '2026-09-22T09:00:00Z', dueAt: '2026-09-23T18:00:00Z', estimatedDuration: 'PT2H' };
    workspace.items[task.id] = task;
    workspace.calendarPreferences.dayView.statistics = { showTime: true, reservedItemIds: [task.id] };
    const days = evaluateCalendarRange(workspace, '2026-09-22', '2026-09-25', workspace.calendarPreferences.dayView, now).days;
    expect(calendarVisibleCapacity(workspace, days['2026-09-22']!, '2026-09-22', now, [], true)).toEqual({ freeMs: 11 * 3_600_000, hiddenReservedMs: 3_600_000 });
    expect(calendarVisibleCapacity(workspace, days['2026-09-23']!, '2026-09-23', now, [], true)).toEqual({ freeMs: 23 * 3_600_000, hiddenReservedMs: 3_600_000 });
    expect(calendarVisibleCapacity(workspace, days['2026-09-24']!, '2026-09-24', now, [], true)).toEqual({ freeMs: 24 * 3_600_000, hiddenReservedMs: 0 });
  });
  it('tracks Overdue and No date switches and counts a hidden reserve only once', () => {
    const now = new Date('2026-09-23T12:00:00Z');
    const workspace = createWorkspace('Capacity', now);
    workspace.calendarPreferences.timezone = 'UTC';
    workspace.calendarPreferences.dayView.filter.source = 'state == "open" && id != "work"';
    workspace.calendarPreferences.dayView.statistics = { showTime: true, reservedItemIds: ['work'] };
    workspace.calendarPreferences.timeline = { mode: 'timeline', hideSleep: false, showOverdue: true, showUndated: true };
    const scheduled = createItem('Scheduled', 'event', now);
    scheduled.id = 'scheduled';
    scheduled.schedule = { timezone: 'UTC', startAt: '2026-09-23T09:00:00Z', endAt: '2026-09-23T11:00:00Z', estimatedDuration: 'PT2H' };
    const work = createItem('Work', 'event', now);
    work.id = 'work';
    work.schedule = { timezone: 'UTC', startAt: '2026-09-23T10:00:00Z', endAt: '2026-09-23T14:00:00Z', estimatedDuration: 'PT4H' };
    const overdue = createItem('Late', 'task', now);
    overdue.id = 'overdue';
    overdue.schedule = { timezone: 'UTC', dueAt: '2026-09-22T18:00:00Z', estimatedDuration: 'PT1H' };
    const undated = createItem('No date', 'task', now);
    undated.id = 'undated';
    undated.schedule = { timezone: 'UTC', estimatedDuration: 'PT30M' };
    workspace.items = { scheduled, work, overdue, undated };
    const compute = () => {
      const day = evaluateCalendarRange(workspace, '2026-09-23', '2026-09-24', workspace.calendarPreferences.dayView, now).days['2026-09-23']!;
      return calendarVisibleCapacity(workspace, day, '2026-09-23', now, calendarUndatedItems(workspace, now), true);
    };
    expect(compute()).toEqual({ freeMs: 8.5 * 3_600_000, hiddenReservedMs: 2 * 3_600_000 });
    const later = new Date('2026-09-23T15:00:00Z');
    const laterDay = evaluateCalendarRange(workspace, '2026-09-23', '2026-09-24', workspace.calendarPreferences.dayView, later).days['2026-09-23']!;
    expect(calendarVisibleCapacity(workspace, laterDay, '2026-09-23', later, calendarUndatedItems(workspace, later), true)).toEqual({ freeMs: 7.5 * 3_600_000, hiddenReservedMs: 0 });
    workspace.calendarPreferences.timeline.showOverdue = false;
    workspace.calendarPreferences.timeline.showUndated = false;
    expect(compute().freeMs).toBe(10 * 3_600_000);
    workspace.calendarPreferences.dayView.statistics.reservedItemIds = [];
    expect(compute()).toEqual({ freeMs: 12 * 3_600_000, hiddenReservedMs: 0 });
  });

  it('uses the full day for another date, even when its events are in the morning', () => {
    const now = new Date('2026-09-23T12:00:00Z');
    const workspace = createWorkspace('Capacity', now);
    workspace.calendarPreferences.timezone = 'UTC';
    const meeting = createItem('Meeting', 'event', now);
    meeting.schedule = { timezone: 'UTC', startAt: '2026-09-24T08:00:00Z', endAt: '2026-09-24T10:00:00Z', estimatedDuration: 'PT2H' };
    workspace.items[meeting.id] = meeting;
    const day = evaluateCalendarRange(workspace, '2026-09-24', '2026-09-25', workspace.calendarPreferences.dayView, now).days['2026-09-24']!;
    expect(calendarVisibleCapacity(workspace, day, '2026-09-24', now, [], true).freeMs).toBe(22 * 3_600_000);
  });
});
