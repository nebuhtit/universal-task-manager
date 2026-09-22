import { expect, it } from 'vitest';
import { createItem, createWorkspace, makeSeries, reconcileRecurrences, createOccurrence, buildRecurrenceRule, softDeleteItemTree, restoreItemTree, itemDeletionTime, projectOccurrences, validateWorkspace } from './index.js';

function fixture() {
  const workspace = createWorkspace('Date cycles');
  const item = createItem('Thursday');
  item.schedule = { timezone: 'Europe/Berlin', plannedDate: '2026-10-22', estimatedDuration: 'PT1H', dueAt: '2026-10-22T16:00:00Z' };
  const series = makeSeries(item, 'FREQ=WEEKLY;BYDAY=TH');
  workspace.items[series.id] = series;
  return { workspace, series };
}

it('keeps each unfinished date cycle independent across DST and completion', () => {
  const { workspace, series } = fixture();
  const result = reconcileRecurrences(workspace, new Date('2026-10-30T12:00:00Z'));
  expect(result.errors).toBeUndefined();
  expect(result.created.map(item => item.schedule?.plannedDate)).toEqual(['2026-10-22', '2026-10-29']);
  expect(result.created.map(item => item.schedule?.dueAt)).toEqual(['2026-10-22T16:00:00.000Z', '2026-10-29T17:00:00.000Z']);
  for (const item of result.created) { expect(item.schedule?.startAt).toBeUndefined(); expect(item.schedule?.endAt).toBeUndefined(); }
  result.created[1]!.state = 'done';
  const next = reconcileRecurrences(workspace, new Date('2026-11-06T12:00:00Z'));
  expect(next.created).toHaveLength(1);
  expect(result.created[0]!.state).toBe('open');
  expect(result.created[1]!.state).toBe('done');
  expect(series.schedule?.plannedDate).toBe('2026-10-22');
  expect(reconcileRecurrences(workspace, new Date('2026-11-06T12:00:00Z')).created).toHaveLength(0);
});

it('does not recreate a deleted cycle and cascades deletion to nested descendants', () => {
  const { workspace, series } = fixture();
  const first = reconcileRecurrences(workspace, new Date('2026-10-23T12:00:00Z')).created[0]!;
  const nested = makeSeries(first, 'FREQ=WEEKLY;BYDAY=TH');
  workspace.items[first.id] = nested;
  const child = createOccurrence(nested, new Date('2026-10-29T23:00:00Z'), 1);
  workspace.items[child.id] = child;
  softDeleteItemTree(workspace, series.id, '2026-10-30T12:00:00Z');
  expect(itemDeletionTime(workspace, child)).toBe('2026-10-30T12:00:00Z');
  expect(child.deletedAt).toBeDefined();
  expect(reconcileRecurrences(workspace, new Date('2026-11-06T12:00:00Z')).created).toHaveLength(0);
  restoreItemTree(workspace, series.id);
  expect(itemDeletionTime(workspace, child)).toBeUndefined();
  softDeleteItemTree(workspace, child.id, '2026-11-01T12:00:00Z');
  expect(itemDeletionTime(workspace, series)).toBeUndefined();
});

it('hides legacy live children of deleted parents without mutating them', () => {
  const { workspace, series } = fixture();
  const child = createOccurrence(series, new Date('2026-10-21T22:00:00Z'), 0);
  workspace.items[child.id] = child;
  workspace.tombstones[series.id] = '2026-10-23T12:00:00Z';
  expect(itemDeletionTime(workspace, child)).toBeDefined();
  expect(child.deletedAt).toBeUndefined();
});

it('rejects sub-day recurrence for date-only tasks', () => {
  const { series } = fixture();
  series.recurrence!.rrule = 'FREQ=HOURLY';
  expect(() => buildRecurrenceRule(series)).toThrow('Date-only recurrence');
});

it('projects future date-only cycles read-only and preserves their identity on materialization', () => {
  const { workspace } = fixture();
  const before = JSON.stringify(workspace);
  const rows = projectOccurrences(workspace, new Date('2026-10-28T23:00:00Z'), new Date('2026-10-29T23:00:00Z'));
  expect(rows).toHaveLength(1);
  expect(rows[0]!.schedule.plannedDate).toBe('2026-10-29');
  expect(rows[0]!.dueOnly).toBe(false);
  expect(JSON.stringify(workspace)).toBe(before);
  const created = reconcileRecurrences(workspace, new Date('2026-10-30T12:00:00Z')).created;
  expect(created[1]!.occurrence?.recurrenceId).toBe(rows[0]!.recurrenceId);
  expect(validateWorkspace(workspace).errors).toEqual([]);
  const id = created[1]!.id;
  softDeleteItemTree(workspace, id, '2026-10-30T12:00:00Z');
  delete workspace.items[id];
  expect(reconcileRecurrences(workspace, new Date('2026-10-30T12:00:00Z')).created).toHaveLength(0);
  expect(projectOccurrences(workspace, new Date('2026-10-28T23:00:00Z'), new Date('2026-10-29T23:00:00Z'))).toHaveLength(0);
});
