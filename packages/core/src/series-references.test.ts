import { describe, expect, it } from 'vitest';
import { compileQuery, createItem, createWorkspace, withinPlacementWorkspace, activeWithinBlockIds } from './index.js';
import { seriesReferenceAt, seriesReferenceIds, seriesReferenceOwner, seriesReferenceQuery } from './series-references.js';

function fixture() {
  const workspace = createWorkspace('Split Work', new Date('2026-10-06T07:00:00Z'));
  workspace.calendarPreferences.timezone = 'UTC';
  const work = createItem('Work', 'event'); work.id = 'work'; work.role = 'series_template';
  work.schedule = { timezone: 'UTC', startAt: '2026-10-06T09:00:00Z', endAt: '2026-10-06T17:00:00Z', estimatedDuration: 'PT8H' };
  work.recurrence = { rrule: 'FREQ=DAILY;UNTIL=20261012T235959Z', timezone: 'UTC', anchor: 'schedule', closeAt: 'next_activation', autoRenew: true, exdates: [], rdates: [] };
  const next = structuredClone(work); next.id = 'next'; next.recurrence!.rrule = 'FREQ=DAILY';
  next.schedule = { ...work.schedule, startAt: '2026-10-13T10:00:00Z', endAt: '2026-10-13T18:00:00Z' };
  next.recurrenceOverride = { kind: 'future_split', sourceSeriesId: 'work', recurrenceId: '2026-10-13T09:00:00Z' };
  const task = createItem('Related task', 'task', new Date('2026-10-06T07:00:00Z')); task.id = 'task';
  task.schedule = { timezone: 'UTC', plannedDate: '2026-10-14', estimatedDuration: 'PT10M' };
  task.relations = [{ id: 'relation', type: 'scheduled_within', targetId: 'work' }];
  workspace.items = { work, next, task };
  return { workspace, work, next, task };
}

describe('future split series references', () => {
  it('recovers a missing generated occurrence for within placement without rewriting history', () => {
    const { workspace, task } = fixture();
    const oldOccurrence = 'occ_work_20261006090000000';
    task.relations[0]!.targetId = oldOccurrence;
    const before = JSON.stringify(workspace);
    expect(seriesReferenceOwner(workspace, oldOccurrence)).toBe('work');
    expect(withinPlacementWorkspace(workspace, new Date('2026-10-14T07:00:00Z')).items.task?.schedule?.startAt).toBe('2026-10-14T10:00:00.000Z');
    expect(JSON.stringify(workspace)).toBe(before);
    delete workspace.items.work;
    expect(seriesReferenceOwner(workspace, oldOccurrence)).toBe('work');
    expect(withinPlacementWorkspace(workspace, new Date('2026-10-14T07:00:00Z')).items.task?.schedule?.startAt).toBe('2026-10-14T10:00:00.000Z');
    for (const id of ['occ_unknown_20261006090000000', 'occ_work_20260231090000000', 'occ_work_invalid']) expect(seriesReferenceOwner(workspace, id)).toBe(id);
    const standalone = createItem('Unrelated'); standalone.id = oldOccurrence; workspace.items[standalone.id] = standalone;
    expect(seriesReferenceOwner(workspace, oldOccurrence)).toBe(oldOccurrence);
  });
  it('places a task in the continued block and keeps the old relation and dates intact', () => {
    const { workspace, task } = fixture();
    const before = JSON.stringify(workspace);
    const display = withinPlacementWorkspace(workspace, new Date('2026-10-14T07:00:00Z'));
    expect(display.items.task?.schedule?.startAt).toBe('2026-10-14T10:00:00.000Z');
    expect(display.items.task?.schedule?.endAt).toBe('2026-10-14T10:10:00.000Z');
    expect(activeWithinBlockIds(workspace, ['work'], new Date('2026-10-14T11:00:00Z'))).toEqual(['work']);
    expect(activeWithinBlockIds(workspace, ['work'], new Date('2026-10-14T09:00:00Z'))).toEqual([]);
    expect(JSON.stringify(workspace)).toBe(before);
    expect(task.relations[0]?.targetId).toBe('work');
  });

  it('resolves chained splits by date and skips deleted or unrelated copies with the same title', () => {
    const { workspace, next } = fixture();
    const later = structuredClone(next); later.id = 'later';
    later.recurrenceOverride = { kind: 'future_split', sourceSeriesId: 'next', recurrenceId: '2026-10-20T10:00:00Z' };
    workspace.items.later = later;
    const unrelated = structuredClone(next); unrelated.id = 'unrelated'; delete unrelated.recurrenceOverride;
    workspace.items.unrelated = unrelated;
    expect(seriesReferenceIds(workspace, ['work'])).toEqual(['work', 'next', 'later']);
    expect(seriesReferenceAt(workspace, 'work', '2026-10-12T09:00:00Z')).toBe('work');
    expect(seriesReferenceAt(workspace, 'work', '2026-10-14T09:00:00Z')).toBe('next');
    expect(seriesReferenceAt(workspace, 'work', '2026-10-21T09:00:00Z')).toBe('later');
    workspace.tombstones.later = '2026-10-20T11:00:00Z';
    expect(seriesReferenceIds(workspace, ['work'])).toEqual(['work', 'next']);
    next.recurrenceOverride!.sourceSeriesId = 'next';
    expect(seriesReferenceIds(workspace, ['next'])).toEqual(['next']);
    expect(seriesReferenceAt(workspace, 'next', '2026-10-21T09:00:00Z')).toBe('next');
  });

  it('inherits exact ID filters through AND, OR and NOT without rewriting user strings or saved filters', () => {
    const { workspace, next, task } = fixture();
    const item = { ...next, occurrence: { seriesId: next.id, recurrenceId: '2026-10-14T10:00:00Z', sequence: 0, templateRevision: 1 } };
    const source = 'occurrence.seriesId != "work" && state == "open"';
    expect(compileQuery(seriesReferenceQuery(workspace, source))(item)).toBe(false);
    expect(compileQuery(seriesReferenceQuery(workspace, source + ' || title == "Work"'))(item)).toBe(true);
    expect(compileQuery(seriesReferenceQuery(workspace, '!("work" == occurrence.seriesId)'))(item)).toBe(false);
    expect(compileQuery(seriesReferenceQuery(workspace, 'occurrence.seriesId == "work"'))(item)).toBe(true);
    expect(compileQuery(seriesReferenceQuery(workspace, source))(task)).toBe(true);
    expect(seriesReferenceQuery(workspace, 'title == "work"')).toBe('title == "work"');
    expect(source).toBe('occurrence.seriesId != "work" && state == "open"');
  });
});
