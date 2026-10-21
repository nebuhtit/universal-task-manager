import { describe, expect, it } from 'vitest';
import { createItem, createOccurrence, createWorkspace, type SavedView } from '@utm/core';
import { activeCalendarPins, removeCalendarPin, setCalendarPin, sourceReference } from './calendarPlanning';
import { evaluateCalendarRange } from './calendarEvaluation';
import { selectViewItems } from '../views/viewSelectors';

function fixture() {
  const workspace = createWorkspace('Continued Work'); workspace.calendarPreferences.timezone = 'UTC';
  const old = createItem('Work', 'event'); old.id = 'old'; old.role = 'series_template';
  old.schedule = { timezone: 'UTC', startAt: '2026-10-06T09:00:00Z', endAt: '2026-10-06T17:00:00Z', estimatedDuration: 'PT8H' };
  old.recurrence = { rrule: 'FREQ=DAILY;UNTIL=20261012T235959Z', timezone: 'UTC', anchor: 'schedule', closeAt: 'next_activation', autoRenew: true, exdates: [], rdates: [] };
  const next = structuredClone(old); next.id = 'next'; next.recurrence!.rrule = 'FREQ=DAILY';
  next.schedule = { ...old.schedule, startAt: '2026-10-13T09:00:00Z', endAt: '2026-10-13T17:00:00Z' };
  next.recurrenceOverride = { kind: 'future_split', sourceSeriesId: old.id, recurrenceId: '2026-10-13T09:00:00Z' };
  workspace.items = { old, next };
  return { workspace, old, next };
}

describe('continued calendar series', () => {
  it('keeps the continued block hidden and reserved, including in views, without editing preferences', () => {
    const { workspace } = fixture();
    const settings = workspace.calendarPreferences.dayView;
    settings.filter.source = 'occurrence.seriesId != "old"'; settings.scheduleSources = ['event'];
    settings.statistics = { showTime: true, reservedItemIds: ['old'] };
    const before = JSON.stringify(workspace);
    const result = evaluateCalendarRange(workspace, '2026-10-12', '2026-10-15', settings, new Date('2026-10-14T07:00:00Z'));
    for (const day of ['2026-10-12', '2026-10-13', '2026-10-14']) {
      expect(result.days[day]?.evaluation.items).toEqual([]);
      expect(result.days[day]?.metrics.reservedDurationMs).toBe(8 * 3600000);
    }
    const view: SavedView = { id: 'test', name: 'Hidden Work', renderer: 'list', fields: ['title'], sort: [], query: settings.filter };
    expect(selectViewItems(workspace, view, new Date('2026-10-14T07:00:00Z'))).toEqual([]);
    expect(JSON.stringify(workspace)).toBe(before);
  });

  it('resolves future pins to the continuation and leaves historical pins and source data intact', () => {
    const { workspace, old, next } = fixture();
    const past = createOccurrence(old, new Date('2026-10-12T09:00:00Z'), 0);
    const future = createOccurrence(old, new Date('2026-10-14T09:00:00Z'), 0);
    setCalendarPin(workspace, { ...sourceReference(past), day: '2026-10-12', mode: 'same_time' });
    setCalendarPin(workspace, { ...sourceReference(future), day: '2026-10-14', mode: 'same_time' });
    const before = JSON.stringify(workspace);
    const oldPins = activeCalendarPins(workspace, '2026-10-12', new Date('2026-10-12T07:00:00Z'));
    expect(oldPins[0]?.item.occurrence?.seriesId).toBe(old.id);
    const pins = activeCalendarPins(workspace, '2026-10-14', new Date('2026-10-14T07:00:00Z'));
    expect(pins[0]?.item.occurrence?.seriesId).toBe(next.id);
    expect(pins[0]?.pin.itemId).toBe(pins[0]?.item.id);
    expect(pins[0]?.pin.seriesId).toBe(next.id);
    expect(JSON.stringify(workspace)).toBe(before);
    // Unpinning the displayed continuation removes its inherited source pin.
    removeCalendarPin(workspace, pins[0]!.pin);
    expect(activeCalendarPins(workspace, '2026-10-14', new Date('2026-10-14T07:00:00Z'))).toEqual([]);
    expect(activeCalendarPins(workspace, '2026-10-12', new Date('2026-10-12T07:00:00Z'))).toHaveLength(1);
    setCalendarPin(workspace, { ...sourceReference(future), day: '2026-10-14', mode: 'same_time' });
    setCalendarPin(workspace, { ...pins[0]!.pin, mode: 'queue' });
    expect(activeCalendarPins(workspace, '2026-10-14', new Date('2026-10-14T07:00:00Z'))).toHaveLength(1);
    expect(activeCalendarPins(workspace, '2026-10-14', new Date('2026-10-14T07:00:00Z'))[0]?.pin.mode).toBe('queue');
  });

  it('uses the continued schedule time and does not invent a cycle removed by its new rule', () => {
    const { workspace, old, next } = fixture();
    const future = createOccurrence(old, new Date('2026-10-14T09:00:00Z'), 0);
    setCalendarPin(workspace, { ...sourceReference(future), day: '2026-10-14', mode: 'same_time' });
    next.schedule!.startAt = '2026-10-13T10:00:00Z'; next.schedule!.endAt = '2026-10-13T18:00:00Z';
    const pins = activeCalendarPins(workspace, '2026-10-14', new Date('2026-10-14T07:00:00Z'));
    expect(pins[0]?.item.schedule?.startAt).toBe('2026-10-14T10:00:00.000Z');
    next.recurrence!.rrule = 'FREQ=WEEKLY;BYDAY=TU';
    expect(activeCalendarPins(workspace, '2026-10-14', new Date('2026-10-14T07:00:00Z'))).toEqual([]);
  });

  it('gates related tasks by the continued hidden block instead of its expired source', () => {
    const { workspace } = fixture();
    const task = createItem('Related task'); task.id = 'task';
    task.relations = [{ id: 'link', type: 'scheduled_within', targetId: 'old' }];
    workspace.items.task = task;
    const view: SavedView = { id: 'today', name: 'Today', renderer: 'list', fields: ['title'], sort: [],
      query: { source: 'state == "open" && occurrence.seriesId != "old" && withinReservedBlockWhenSet == true' },
      statistics: { showTime: true, reservedItemIds: ['old'] } };
    expect(selectViewItems(workspace, view, new Date('2026-10-14T10:00:00Z')).map(item => item.id)).toEqual(['task']);
    expect(selectViewItems(workspace, view, new Date('2026-10-14T08:00:00Z'))).toEqual([]);
  });
});
