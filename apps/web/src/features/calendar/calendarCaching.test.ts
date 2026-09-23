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
