import { describe, expect, it } from 'vitest';
import { createItem, createWorkspace } from '@utm/core';
import { calendarUndatedItems, showUndatedItem, showOverdueToday } from './calendarVisibility';
import { timelineData } from './timelineData';
import { evaluateCalendarRange } from './calendarEvaluation';

const now = new Date('2026-09-22T12:00:00Z');
describe('calendar supplemental visibility', () => {
  it('shows late Due today in both modes without editing dates', () => {
    const workspace = createWorkspace('Test', now); workspace.calendarPreferences.timezone = 'UTC';
    workspace.calendarPreferences.dayView.filter.source = 'true';
    const item = createItem('Late', 'task', now); item.schedule = { timezone: 'UTC', dueAt: '2026-09-20T12:00:00Z' };
    workspace.items[item.id] = item;
    const before = JSON.stringify(workspace);
    const data = timelineData(workspace, '2026-09-22', now);
    expect(data.overdue.map(x => x.id)).toEqual([item.id]); expect(data.events).toHaveLength(0);
    const range = evaluateCalendarRange(workspace, '2026-09-22', '2026-09-23', workspace.calendarPreferences.dayView, now);
    expect(range.days['2026-09-22']?.evaluation.items.map(x => x.id)).toContain(item.id);
    expect(JSON.stringify(workspace)).toBe(before);
    expect(showOverdueToday(item, '2026-09-23', now, 'UTC')).toBe(false);
    item.schedule.startAt = '2026-09-19T10:00:00Z';
    expect(showOverdueToday(item, '2026-09-22', now, 'UTC')).toBe(true);
    item.recurrence = { rrule: 'FREQ=WEEKLY', rdates: [], exdates: [], timezone: 'UTC', closeAt: 'due', anchor: 'schedule', autoRenew: true };
    expect(showOverdueToday(item, '2026-09-22', now, 'UTC')).toBe(false);
    item.schedule.dueAt = '2026-09-22T10:00:00Z';
    expect(showOverdueToday(item, '2026-09-22', now, 'UTC')).toBe(true);
    item.state = 'done'; expect(showOverdueToday(item, '2026-09-22', now, 'UTC')).toBe(false);
  });
  it('uses completion time and calendar timezone, never updatedAt', () => {
    const item = createItem('Done', 'task', now);
    expect(showUndatedItem(item, now, 'UTC')).toBe(true);
    item.state = 'done'; expect(showUndatedItem(item, now, 'UTC')).toBe(false);
    item.closure = { at: '2026-09-21T23:00:00Z', actor: 'user', reason: 'manual' };
    expect(showUndatedItem(item, now, 'UTC')).toBe(false);
    expect(showUndatedItem(item, now, 'Europe/Moscow')).toBe(true);
    item.state = 'cancelled'; expect(showUndatedItem(item, now, 'Europe/Moscow')).toBe(false);
  });
  it('selects List No date items with the day-view filter and no deleted or old completions', () => {
    const workspace = createWorkspace('List', now); workspace.calendarPreferences.timezone = 'UTC';
    workspace.calendarPreferences.dayView.filter.source = 'true';
    const open = createItem('Open', 'task', now);
    const done = createItem('Done today', 'task', now); done.state = 'done'; done.closure = { at: now.toISOString(), actor: 'user', reason: 'manual' };
    const old = createItem('Done yesterday', 'task', now); old.state = 'done'; old.closure = { at: '2026-09-21T12:00:00Z', actor: 'user', reason: 'manual' };
    const deleted = createItem('Deleted', 'task', now); deleted.deletedAt = now.toISOString();
    for (const item of [open, done, old, deleted]) workspace.items[item.id] = item;
    expect(calendarUndatedItems(workspace, now).map(item => item.title).sort()).toEqual(['Done today', 'Open']);
  });
  it('filters No date completions and does not coalesce late cycles', () => {
    const w = createWorkspace('Cycles', now); w.calendarPreferences.timezone = 'UTC';
    w.calendarPreferences.dayView.filter.source = 'true'; w.calendarPreferences.timeline = { mode: 'timeline', hideSleep: false, showUndated: true };
    for (const [title, at] of [['today', '2026-09-22T10:00:00Z'], ['yesterday', '2026-09-21T10:00:00Z']]) {
      const item = createItem(title!, 'task', now); item.state = 'done'; item.closure = { at: at!, actor: 'user', reason: 'manual' }; w.items[item.id] = item;
    }
    const source = createItem('Series', 'task', now); source.role = 'series_template'; w.items[source.id] = source;
    const cycleIds: string[] = [];
    for (const day of ['2026-09-19', '2026-09-20']) {
      const item = createItem(`Cycle ${day}`, 'task', now); item.role = 'occurrence';
      item.occurrence = { seriesId: source.id, recurrenceId: `${day}T10:00:00Z`, sequence: 0, templateRevision: 1 };
      item.schedule = { timezone: 'UTC', dueAt: `${day}T12:00:00Z` }; w.items[item.id] = item; cycleIds.push(item.id);
    }
    const data = timelineData(w, '2026-09-22', now);
    expect(data.undated.map(x => x.title)).toContain('today'); expect(data.undated.map(x => x.title)).not.toContain('yesterday');
    expect(data.overdue.map(x => x.id).sort()).toEqual(cycleIds.sort());
    const list = evaluateCalendarRange(w, '2026-09-22', '2026-09-23', w.calendarPreferences.dayView, now);
    expect(list.days['2026-09-22']!.evaluation.items.map(x => x.id).sort()).toEqual(cycleIds.sort());
  });
});
