import { createItem, createWorkspace, createOccurrence, makeSeries, projectOccurrences, zonedDateStart, type WorkspaceDocument } from '@utm/core';
import { describe, expect, it } from 'vitest';
import { createCalendarEvaluator, evaluateCalendarRange } from './calendarEvaluation';
import { createCalendarProjectionCache } from './calendarProjectionCache';
import { createCalendarCapacityCache, calendarVisibleCapacity } from './calendarCapacity';
import { calendarUndatedItems } from './calendarVisibility';
import { applyTimelinePlanning, prepareTimelineData, timelineData } from './timelineData';
import * as Automerge from '@automerge/automerge';
import { temporalEvaluationKey } from '../views/useViewEvaluation';

const start = '2026-09-21', end = '2026-09-28';
const now = new Date('2026-09-23T12:00:00Z');
function fixture() {
  const workspace = createWorkspace('Synthetic calendar cache', now);
  workspace.calendarPreferences.timezone = 'UTC';
  workspace.calendarPreferences.dayView.filter.source = 'state == "open"';
  workspace.calendarPreferences.dayView.sortSource = 'schedule.startAt asc nulls last';
  for (let day = 21; day < 28; day++) {
    const item = createItem(`Day ${day}`, 'task', now); item.id = `day-${day}`;
    item.schedule = { timezone: 'UTC', startAt: `2026-09-${day}T14:00:00Z`, endAt: `2026-09-${day}T15:00:00Z`, estimatedDuration: 'PT1H' };
    workspace.items[item.id] = item;
  }
  return workspace;
}
const evaluate = (cache: ReturnType<typeof createCalendarEvaluator>, workspace: WorkspaceDocument, at = now) => cache.evaluate(workspace, start, end, workspace.calendarPreferences.dayView, at);
const reference = (workspace: WorkspaceDocument, at = now) => evaluateCalendarRange(workspace, start, end, workspace.calendarPreferences.dayView, at);

describe('incremental calendar computation', () => {
  it('keeps a whole visible week warm instead of evicting its first days on every refresh', () => {
    const workspace = fixture();
    workspace.items['day-21'] = makeSeries(workspace.items['day-21']!, 'FREQ=DAILY');
    const cache = createCalendarProjectionCache();
    // Navigator boundaries, range evaluation, then the seven padded day queries.
    const ranges = [
      [zonedDateStart(start, 'UTC'), zonedDateStart(end, 'UTC')],
      [new Date('2026-09-20T00:00:00Z'), new Date('2026-09-29T00:00:00Z')],
      ...Array.from({ length: 7 }, (_, index) => [
        new Date(Date.UTC(2026, 8, 20 + index)), new Date(Date.UTC(2026, 8, 23 + index)),
      ]),
    ];
    const first = ranges.map(([a, b]) => cache.project(workspace, a!, b!));
    const builds = { ...cache.counters };
    expect(builds.projections).toBe(9);
    for (let refresh = 0; refresh < 3; refresh++) {
      ranges.forEach(([a, b], index) => expect(cache.project(workspace, a!, b!)).toBe(first[index]));
    }
    expect(cache.counters).toEqual(builds);
    const edited = structuredClone(workspace);
    edited.items['day-21']!.schedule!.endAt = '2026-09-21T16:00:00Z';
    ranges.forEach(([a, b]) => expect(cache.project(edited, a!, b!)).toEqual(projectOccurrences(cache.workspaceFor(edited), a!, b!)));
    expect(cache.counters.groupProjections).toBeGreaterThan(builds.groupProjections);
  });

  it('bounds cached ranges and evicts large overlapping results instead of retaining a growing history', () => {
    const empty = fixture(); empty.items = {};
    const cache = createCalendarProjectionCache();
    const firstStart = new Date('2026-09-21T00:00:00Z');
    const firstEnd = new Date('2026-09-22T00:00:00Z');
    cache.project(empty, firstStart, firstEnd);
    for (let offset = 1; offset <= 10; offset++) cache.project(empty, new Date(+firstStart + offset), firstEnd);
    cache.project(empty, firstStart, firstEnd);
    expect(cache.counters.projections).toBe(12);

    const dense = fixture();
    const item = dense.items['day-23']!;
    dense.items = Object.fromEntries(Array.from({ length: 4_000 }, (_, index) => {
      const id = `dense-${index}`;
      return [id, { ...item, id }];
    }));
    const denseCache = createCalendarProjectionCache();
    const a = new Date('2026-09-23T00:00:00Z'), b = new Date('2026-09-24T00:00:00Z');
    const first = denseCache.project(dense, a, b);
    expect(first).toHaveLength(4_000);
    for (let offset = 1; offset <= 2; offset++) denseCache.project(dense, new Date(+a + offset), b);
    expect(denseCache.project(dense, a, b)).toEqual(first);
    expect(denseCache.counters.projections).toBe(4);
    expect(denseCache.counters.groupProjections).toBe(4);
  });

  it('accepts immutable Automerge snapshots and invalidates deletions and series edits', () => {
    const workspace = fixture();
    workspace.items['day-21'] = makeSeries(workspace.items['day-21']!, 'FREQ=DAILY');
    let doc = Automerge.from(workspace as unknown as Record<string, unknown>) as Automerge.Doc<WorkspaceDocument>;
    const cache = createCalendarEvaluator();
    expect(evaluate(cache, doc)).toEqual(reference(doc));
    doc = Automerge.change(doc, draft => { draft.items['day-21']!.recurrence!.rrule = 'FREQ=WEEKLY'; });
    expect(evaluate(cache, doc)).toEqual(reference(doc));
    doc = Automerge.change(doc, draft => { draft.items['day-23']!.deletedAt = now.toISOString(); });
    expect(evaluate(cache, doc)).toEqual(reference(doc));
    doc = Automerge.change(doc, draft => {
      draft.items['day-24']!.state = 'done';
      draft.calendarPreferences.dayView.statistics = { showTime: true, includeHiddenCompleted: true, reservedItemIds: [] };
    });
    expect(evaluate(cache, doc)).toEqual(reference(doc));
  });

  it('updates provisional placement without reprojecting on each minute', () => {
    const workspace = fixture(); workspace.calendarPreferences.timeline = { mode: 'timeline', hideSleep: false, showUndated: true };
    workspace.items.undated = createItem('Unscheduled', 'task', now);
    workspace.items.undated.id = 'undated'; workspace.items.undated.schedule = { timezone: 'UTC', estimatedDuration: 'PT30M' };
    const cache = createCalendarProjectionCache();
    const prepared = prepareTimelineData(workspace, '2026-09-23', now, cache);
    const projections = cache.counters.projections;
    for (const offset of [60_000, 120_000]) {
      const at = new Date(+now + offset);
      expect(applyTimelinePlanning(prepared, at)).toEqual(timelineData(workspace, '2026-09-23', at));
    }
    expect(cache.counters.projections).toBe(projections);
  });
  it('reuses projections, index and all day metrics across an ordinary clock tick', () => {
    const workspace = fixture(); const cache = createCalendarEvaluator();
    const before = evaluate(cache, workspace);
    const later = new Date(+now + 60_000); const after = evaluate(cache, workspace, later);
    expect(after).toEqual(reference(workspace, later));
    expect(cache.projections.counters.projections).toBe(1);
    expect(cache.counters).toEqual({ dayCalculations: 7, indexBuilds: 1 });
    for (const key of Object.keys(before.days)) expect(after.days[key]!.metrics).toBe(before.days[key]!.metrics);
  });

  it('recalculates only changed days when an item moves or changes duration', () => {
    const workspace = fixture(); const cache = createCalendarEvaluator(); evaluate(cache, workspace);
    const changed = structuredClone(workspace);
    changed.items['day-25']!.schedule!.estimatedDuration = 'PT2H';
    expect(evaluate(cache, changed)).toEqual(reference(changed));
    expect(cache.counters.dayCalculations).toBe(8);
    const moved = structuredClone(changed);
    moved.items['day-25']!.schedule!.startAt = '2026-09-26T18:00:00Z';
    moved.items['day-25']!.schedule!.endAt = '2026-09-26T19:00:00Z';
    expect(evaluate(cache, moved)).toEqual(reference(moved));
    expect(cache.counters.dayCalculations).toBe(10);
  });

  it('retains untouched day and card identities while rebuilding only the edited date bucket', () => {
    const workspace = fixture(), cache = createCalendarEvaluator();
    workspace.items.neighbour = { ...structuredClone(workspace.items['day-25']!), id: 'neighbour' };
    const before = evaluate(cache, workspace);
    const count = cache.projections.counters.groupProjections;
    const changed = structuredClone(workspace);
    changed.items['day-25']!.schedule!.endAt = '2026-09-25T16:00:00Z';
    const after = evaluate(cache, changed);
    expect(after).toEqual(reference(changed));
    expect(cache.projections.counters.groupProjections - count).toBe(1);
    expect(after.days['2026-09-25']!.evaluation.items.find(item => item.id === 'neighbour')).toBe(before.days['2026-09-25']!.evaluation.items.find(item => item.id === 'neighbour'));
    for (const key of Object.keys(before.days)) {
      if (key === '2026-09-25') expect(after.days[key]).not.toBe(before.days[key]);
      else {
        expect(after.days[key]).toBe(before.days[key]);
        expect(after.days[key]!.evaluation.items).toBe(before.days[key]!.evaluation.items);
      }
    }
    const moved = structuredClone(changed);
    moved.items['day-25']!.schedule!.startAt = '2026-09-26T18:00:00Z';
    moved.items['day-25']!.schedule!.endAt = '2026-09-26T19:00:00Z';
    const result = evaluate(cache, moved);
    expect(result).toEqual(reference(moved));
    expect(result.days['2026-09-24']).toBe(after.days['2026-09-24']);
    expect(result.days['2026-09-25']).not.toBe(after.days['2026-09-25']);
    expect(result.days['2026-09-26']).not.toBe(after.days['2026-09-26']);
  });

  it('refreshes title-dependent filters and sorts instead of hiding content edits in the cache', () => {
    const workspace = fixture(), cache = createCalendarEvaluator();
    workspace.calendarPreferences.dayView.filter.source = 'title != "hidden"';
    workspace.calendarPreferences.dayView.sortSource = 'title asc nulls last';
    const before = evaluate(cache, workspace);
    const changed = structuredClone(workspace); changed.items['day-25']!.title = 'hidden';
    const after = evaluate(cache, changed);
    expect(after).toEqual(reference(changed));
    expect(after.days['2026-09-25']!.evaluation.items).toHaveLength(0);
    expect(after.days['2026-09-24']).toBe(before.days['2026-09-24']);
  });

  it('refreshes only today remaining capacity on a tick', () => {
    const workspace = fixture(); const calendar = reference(workspace); const cache = createCalendarCapacityCache();
    const undated = calendarUndatedItems(workspace, now);
    for (const at of [now, new Date(+now + 60_000)]) for (const [key, day] of Object.entries(calendar.days)) {
      expect(cache.calculate(workspace, day, key, at, undated, true)).toEqual(calendarVisibleCapacity(workspace, day, key, at, undated, true));
    }
    expect(cache.counters.calculations).toBe(8);
  });

  it.each(['minutesUntil(schedule.startAt) < 60', 'now() > schedule.dueAt', 'eventToday', 'activeRange', 'scheduleInPeriod("today", "event,due", true, 7, "", "")', 'state ==', 'true'])('keeps temporal filter %s equivalent to the uncached evaluator', source => {
    const workspace = fixture(); const cache = createCalendarEvaluator();
    workspace.items['day-23']!.schedule!.dueAt = '2026-09-23T14:00:00Z';
    workspace.calendarPreferences.dayView.filter.source = source;
    for (const value of ['2026-09-23T12:59:59Z', '2026-09-23T13:00:01Z', '2026-09-23T14:00:00Z', '2026-09-23T14:00:01Z', '2026-09-24T00:00:01Z', '2026-09-23T12:00:00Z']) {
      const at = new Date(value); expect(evaluate(cache, workspace, at)).toEqual(reference(workspace, at));
    }
  });

  it('reuses an unchanged series projection when an unrelated item changes', () => {
    const workspace = fixture();
    const root = makeSeries(workspace.items['day-21']!, 'FREQ=DAILY', { timezone: 'UTC', anchor: 'schedule', autoRenew: true, closeAt: 'due', activationOffset: 'PT0M', exdates: [], rdates: [] });
    workspace.items[root.id] = root;
    const occurrence = createOccurrence(root, new Date('2026-09-24T14:00:00Z'), 3);
    occurrence.schedule!.startAt = '2026-09-24T17:00:00Z'; occurrence.schedule!.endAt = '2026-09-24T18:00:00Z';
    workspace.items[occurrence.id] = occurrence;
    const cache = createCalendarProjectionCache(); const a = zonedDateStart(start, 'UTC'), b = zonedDateStart(end, 'UTC');
    expect(cache.project(workspace, a, b)).toEqual(projectOccurrences(cache.workspaceFor(workspace), a, b));
    const builds = cache.counters.groupProjections;
    const changed = structuredClone(workspace); changed.items['day-27']!.title = 'Changed';
    expect(cache.project(changed, a, b)).toEqual(projectOccurrences(cache.workspaceFor(changed), a, b));
    expect(cache.counters.groupProjections - builds).toBe(1);
    expect(timelineData(changed, '2026-09-24', now, cache)).toEqual(timelineData(changed, '2026-09-24', now));
  });

  it('invalidates filters, reserves and timezone, including DST day lengths', () => {
    const cache = createCalendarEvaluator(); let workspace = fixture(); evaluate(cache, workspace);
    for (const zone of ['Europe/Berlin', 'America/New_York', 'UTC']) {
      workspace = structuredClone(workspace); workspace.calendarPreferences.timezone = zone;
      workspace.calendarPreferences.dayView.filter.source = 'id != "day-23"';
      workspace.calendarPreferences.dayView.statistics = { showTime: true, reservedItemIds: ['day-23'] };
      const prefs = workspace.calendarPreferences.dayView;
      expect(cache.evaluate(workspace, '2026-10-24', '2026-10-27', prefs, now)).toEqual(evaluateCalendarRange(workspace, '2026-10-24', '2026-10-27', prefs, now));
    }
  });

  it('detects strict/inclusive boundaries, midnight, continuous filters and clock rewind', () => {
    const due = +new Date('2026-09-23T14:00:00Z'); const key = (at: number, continuous = false) => temporalEvaluationKey([due], new Date(at), 'Europe/Moscow', continuous);
    expect(key(due - 60_000)).toBe(key(due - 1));
    expect(key(due - 1)).not.toBe(key(due));
    expect(key(due)).not.toBe(key(due + 1));
    expect(key(due + 1)).toBe(key(due + 60_000));
    expect(key(due + 1, true)).not.toBe(key(due + 1001, true));
    expect(key(+new Date('2026-09-23T20:59:59Z'))).not.toBe(key(+new Date('2026-09-23T21:00:00Z')));
  });
});
