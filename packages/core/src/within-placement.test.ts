import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createWorkspace, createItem, withinPlacementWorkspace, calculateViewTimeMetrics, type SavedView } from './index.js';

const now = new Date('2026-10-06T07:00:00Z');
function fixture(duration = 'PT3H') {
  const workspace = createWorkspace('Within', now); workspace.calendarPreferences.timezone = 'UTC';
  const work = createItem('Work', 'event', now); work.id = 'work';
  work.schedule = { timezone: 'UTC', startAt: '2026-10-06T09:00:00Z', endAt: '2026-10-06T17:00:00Z' };
  const task = createItem('Task', 'task', now); task.id = 'task';
  task.schedule = { timezone: 'UTC', plannedDate: '2026-10-06', estimatedDuration: duration };
  task.relations = [{ id: 'r', type: 'scheduled_within', targetId: work.id }];
  workspace.items = { work, task };
  return { workspace, work, task };
}
describe('within placement', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
  afterEach(() => vi.useRealTimers());
  it('rolls a missed planned day into current or next Work without changing stored dates', () => {
    const { workspace, task, work } = fixture('PT1H');
    task.schedule!.plannedDate = '2026-10-05';
    work.role = 'series_template';
    work.recurrence = { rrule: 'FREQ=WEEKLY', timezone: 'UTC', anchor: 'schedule', autoRenew: true, exdates: [], rdates: [] };
    const current = withinPlacementWorkspace(workspace, new Date('2026-10-06T10:00:00Z'));
    expect(current.items.task?.schedule?.plannedDate).toBe('2026-10-06');
    expect(current.items.task?.schedule?.startAt).toBe('2026-10-06T09:00:00.000Z');
    expect(withinPlacementWorkspace(workspace, new Date('2026-10-06T10:01:00Z'))).toBe(current);
    const next = withinPlacementWorkspace(current, new Date('2026-10-06T17:00:00Z'));
    expect(next.items.task?.schedule?.plannedDate).toBe('2026-10-13');
    expect(next.items.task?.schedule?.startAt).toBe('2026-10-13T09:00:00.000Z');
    expect(task.schedule?.plannedDate).toBe('2026-10-05');
    expect(task.schedule?.startAt).toBeUndefined();
  });
  it('invalidates at local midnight without a workspace edit', () => {
    const { workspace, task } = fixture();
    workspace.calendarPreferences.timezone = 'Europe/Moscow';
    task.schedule!.plannedDate = '2026-10-05';
    const before = withinPlacementWorkspace(workspace, new Date('2026-10-05T20:59:00Z'));
    expect(before.items.task).toBe(task);
    const after = withinPlacementWorkspace(workspace, new Date('2026-10-05T21:00:00Z'));
    expect(after.items.task?.schedule?.plannedDate).toBe('2026-10-06');
  });
  it('does not roll completed tasks, explicit times, or a missed day without future Work', () => {
    for (const kind of ['done', 'explicit', 'missing'] as const) {
      const { workspace, task } = fixture();
      task.schedule!.plannedDate = '2026-10-05';
      if (kind === 'done') task.state = 'done';
      if (kind === 'explicit') task.schedule!.startAt = '2026-10-05T12:00:00Z';
      if (kind === 'missing') delete workspace.items.work;
      expect(withinPlacementWorkspace(workspace, now).items.task).toBe(task);
    }
  });
  it.each([['PT3H', 16], ['PT9H', 15]])('unions %s of tasks with eight reserved hours', (duration, freeHours) => {
    const { workspace, task } = fixture(duration);
    const view: SavedView = { id: 'v', name: 'Today', renderer: 'list', fields: [], sort: [], query: { source: 'scheduleInPeriod("today", "event", false, 7, "", "")' }, statistics: { showTime: true, reservedItemIds: ['work'] } };
    expect(calculateViewTimeMetrics(workspace, view, [task], now).freeDurationMs).toBe(Number(freeHours) * 3600000);
    expect(task.schedule?.startAt).toBeUndefined();
  });
  it('uses intersection then falls back to first available target, preserves explicit time', () => {
    const { workspace, task } = fixture('PT30M');
    const cleaning = createItem('Cleaning', 'event', now); cleaning.id = 'cleaning';
    cleaning.schedule = { timezone: 'UTC', startAt: '2026-10-06T12:00:00Z', endAt: '2026-10-06T13:00:00Z' };
    workspace.items.cleaning = cleaning; task.relations.push({ id: 'r2', type: 'scheduled_within', targetId: cleaning.id });
    expect(withinPlacementWorkspace(workspace).items.task?.schedule?.startAt).toBe('2026-10-06T12:00:00.000Z');
    const changed = structuredClone(workspace); changed.items.cleaning!.schedule!.startAt = '2026-10-06T19:00:00Z'; changed.items.cleaning!.schedule!.endAt = '2026-10-06T20:00:00Z';
    expect(withinPlacementWorkspace(changed).items.task?.schedule?.startAt).toBe('2026-10-06T09:00:00.000Z');
    const explicit = structuredClone(workspace); explicit.items.task!.schedule!.startAt = '2026-10-06T18:00:00Z';
    expect(withinPlacementWorkspace(explicit).items.task?.schedule?.startAt).toBe('2026-10-06T18:00:00Z');
  });
  it('orders tasks and updates placement when a block moves without writing source times', () => {
    const { workspace, task } = fixture('PT1H');
    const second = structuredClone(task); second.id = 'task2'; second.createdAt = '2026-10-06T07:01:00Z'; workspace.items.task2 = second;
    const first = withinPlacementWorkspace(workspace);
    expect(first.items.task2?.schedule?.startAt).toBe('2026-10-06T10:00:00.000Z');
    const moved = structuredClone(workspace); moved.items.work!.schedule!.startAt = '2026-10-06T11:00:00Z';
    expect(withinPlacementWorkspace(moved).items.task2?.schedule?.startAt).toBe('2026-10-06T12:00:00.000Z');
    expect(second.schedule?.startAt).toBeUndefined();
  });
  it('resolves an undated task into a current block no earlier than capture time', () => {
    const { workspace, task } = fixture(); delete task.schedule!.plannedDate; task.createdAt = '2026-10-06T10:30:00Z';
    expect(withinPlacementWorkspace(workspace).items.task?.schedule?.startAt).toBe('2026-10-06T10:30:00.000Z');
  });
  it('keeps an explicitly selected day without a block and supports weekly blocks', () => {
    const { workspace, task, work } = fixture(); task.schedule!.plannedDate = '2026-10-13';
    expect(withinPlacementWorkspace(workspace).items.task).toBe(task);
    const repeating = structuredClone(workspace); repeating.items.work = { ...work, role: 'series_template', recurrence: { rrule: 'FREQ=WEEKLY', timezone: 'UTC', anchor: 'schedule', autoRenew: true, exdates: [], rdates: [] } };
    expect(withinPlacementWorkspace(repeating).items.task?.schedule?.startAt).toBe('2026-10-13T09:00:00.000Z');
  });
  it('reuses unaffected day objects across workspace revisions', () => {
    const { workspace } = fixture(); const first = withinPlacementWorkspace(workspace);
    const changed = { ...workspace, title: 'Other title' };
    expect(withinPlacementWorkspace(changed).items.task).toBe(first.items.task);
  });
  it('counts two overlapping reserves only once, plus explicit task time outside both', () => {
    const { workspace, task } = fixture('PT30M');
    const cleaning = createItem('Cleaning', 'event', now); cleaning.id = 'cleaning';
    cleaning.schedule = { timezone: 'UTC', startAt: '2026-10-06T15:00:00Z', endAt: '2026-10-06T19:00:00Z' };
    workspace.items.cleaning = cleaning; task.relations.push({ id: 'r2', type: 'scheduled_within', targetId: 'cleaning' });
    const view: SavedView = { id: 'v', name: 'Today', renderer: 'list', fields: [], sort: [], query: { source: 'scheduleInPeriod("today", "event", false, 7, "", "")' }, statistics: { showTime: true, reservedItemIds: ['work', 'cleaning'] } };
    expect(calculateViewTimeMetrics(workspace, view, [task], now).freeDurationMs).toBe(14 * 3600000);
    const explicit = structuredClone(workspace); explicit.items.task!.schedule!.startAt = '2026-10-06T19:00:00Z';
    expect(calculateViewTimeMetrics(explicit, view, [explicit.items.task!], now).freeDurationMs).toBe(13.5 * 3600000);
  });
});
