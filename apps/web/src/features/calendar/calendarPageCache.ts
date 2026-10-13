import { createCalendarEvaluator, type CalendarRangeEvaluation } from './calendarEvaluation';
import { createCalendarCapacityCache, calendarVisibleCapacity } from './calendarCapacity';
import { createCalendarPlanCache, calendarPlanMetricItems, planningEnabled } from './calendarPlanning';
import { prepareTimelineData } from './timelineData';
import { calendarUndatedItems } from './calendarVisibility';
import { completionHoldsSnapshot } from '../views/viewSelectors';
import { withinPlacementWorkspace, type UniversalItem, type WorkspaceDocument } from '@utm/core';
import { prepareCalendarProjectionBoundaries, type CalendarProjectionBoundaries } from './calendarProjectionCache';

function dateKeys(start: string, end: string) {
  const keys: string[] = [];
  for (let key = start; key < end; key = new Date(Date.parse(key + 'T12:00:00Z') + 86_400_000).toISOString().slice(0, 10)) keys.push(key);
  return keys;
}

function retain<T>(cache: Map<string, T>, key: string, value: T) {
  cache.delete(key); cache.set(key, value);
  while (cache.size > 3) cache.delete(cache.keys().next().value!);
  return value;
}

/** Owned by the unlocked app session, released when its workspace is locked. */
export function createCalendarPageCache(workspaceId: string) {
  const evaluator = createCalendarEvaluator(), capacityCache = createCalendarCapacityCache(), planCache = createCalendarPlanCache();
  type RangeValue = { calendar: CalendarRangeEvaluation; undated: UniversalItem[]; preparedDays: Record<string, ReturnType<typeof prepareTimelineData>> | null; plans: Record<string, ReturnType<typeof planCache>> | null; capacities: Record<string, ReturnType<typeof calendarVisibleCapacity>> };
  type RangeEntry = { workspace: WorkspaceDocument; at: number; capacityAt: number; completion: number; allDayOpen: boolean; value: RangeValue; boundaries: CalendarProjectionBoundaries | undefined };
  const prepareRange = (workspace: WorkspaceDocument, start: string, end: string, now: Date, capacityNow: Date, allDayOpen: boolean, prior?: RangeEntry): RangeValue => {
    const reusable = prior?.workspace === workspace && prior.at === +now && prior.completion === completionHoldsSnapshot();
    const calendar = reusable ? prior.value.calendar : evaluator.evaluate(workspace, start, end, workspace.calendarPreferences.dayView, now);
    const keys = dateKeys(start, end);
    const undated = reusable ? prior.value.undated : calendarUndatedItems(workspace, now);
    const preparedDays = reusable ? prior.value.preparedDays : planningEnabled(workspace) ? Object.fromEntries(keys.map(key => [key, prepareTimelineData(workspace, key, now, evaluator.projections)])) : null;
    const plans = preparedDays ? Object.fromEntries(keys.map(key => [key, planCache(workspace, key, preparedDays[key]!, capacityNow, calendar.days[key]!.reservedItems)])) : null;
    const capacities = Object.fromEntries(keys.map(key => {
      const day = calendar.days[key]!, plan = plans?.[key];
      return [key, plan ? calendarVisibleCapacity(workspace, { ...day, evaluation: { ...day.evaluation, items: calendarPlanMetricItems(plan, day.evaluation.items) } }, key, capacityNow, undated.filter(item => !plan.ids.includes(item.id)), allDayOpen) : capacityCache.calculate(workspace, day, key, capacityNow, undated, allDayOpen)];
    }));
    return { calendar, preparedDays, plans, capacities, undated };
  };
  const ranges = new Map<string, RangeEntry>();
  type TimelineEntry = { workspace: WorkspaceDocument; at: number; completion: number; value: ReturnType<typeof prepareTimelineData> };
  const timelines = new Map<string, TimelineEntry>();
  const peekRange = (workspace: WorkspaceDocument, start: string, end: string, now: Date, capacityNow: Date, allDayOpen: boolean) => {
    const prior = ranges.get(`${start}:${end}`);
    return prior?.workspace === workspace && prior.at === +now && prior.capacityAt === +capacityNow && prior.completion === completionHoldsSnapshot() && prior.allDayOpen === allDayOpen ? prior.value : undefined;
  };
  const peekTimeline = (workspace: WorkspaceDocument, key: string, now: Date) => {
    const prior = timelines.get(key);
    return prior?.workspace === workspace && prior.at === +now && prior.completion === completionHoldsSnapshot() ? prior.value : undefined;
  };
  return { workspaceId, evaluator, capacityCache, planCache, peekRange, peekTimeline,
    peekProjectionBoundaries(workspace: WorkspaceDocument, start: string, end: string, selected: string) {
      const prior = ranges.get(`${start}:${end}`);
      if (prior?.workspace !== workspace || !prior.boundaries?.days[selected]) return;
      return [...prior.boundaries.period, ...prior.boundaries.days[selected]!];
    },
    // Worker results enter the same bounded cache. The caller must still own
    // this immutable input and its UI completion generation when they arrive.
    acceptPrepared(workspace: WorkspaceDocument, now: Date, capacityNow: Date, allDayOpen: boolean, completion: number, result: CalendarPreparedSlides) {
      if (completion !== completionHoldsSnapshot()) return false;
      for (const range of result.ranges) retain(ranges, `${range.start}:${range.end}`, { workspace, at: +now, capacityAt: +capacityNow, completion, allDayOpen, boundaries: range.boundaries, value: { ...range.value, calendar: { ...range.value.calendar, workspace: { ...withinPlacementWorkspace(workspace, now), items: range.projectedItems } } } });
      for (const timeline of result.timelines) retain(timelines, timeline.key, { workspace, at: +now, completion, value: timeline.value });
      return true;
    },
    rangeFor(workspace: WorkspaceDocument, start: string, end: string, now: Date, capacityNow: Date, allDayOpen: boolean) {
      const key = `${start}:${end}`, hit = peekRange(workspace, start, end, now, capacityNow, allDayOpen);
      if (hit) { retain(ranges, key, ranges.get(key)!); return hit; }
      const prior = ranges.get(key);
      const value = prepareRange(workspace, start, end, now, capacityNow, allDayOpen, prior);
      retain(ranges, key, { workspace, at: +now, capacityAt: +capacityNow, completion: completionHoldsSnapshot(), allDayOpen, value, boundaries: prior?.workspace === workspace ? prior.boundaries : undefined });
      return value;
    },
    timelineFor(workspace: WorkspaceDocument, key: string, now: Date) {
      const hit = peekTimeline(workspace, key, now);
      if (hit) { retain(timelines, key, timelines.get(key)!); return hit; }
      const value = prepareTimelineData(workspace, key, now, evaluator.projections);
      retain(timelines, key, { workspace, at: +now, completion: completionHoldsSnapshot(), value });
      return value;
    },
  };
}

export type CalendarPageCache = ReturnType<typeof createCalendarPageCache>;
export type CalendarSlideRequest = { ranges: Array<{ start: string; end: string }>; timelines: string[]; now: number; capacityNow: number; allDayOpen: boolean };
export type CalendarPreparedSlides = {
  ranges: Array<{ start: string; end: string; boundaries: CalendarProjectionBoundaries; projectedItems: Record<string, UniversalItem>; value: Omit<ReturnType<CalendarPageCache['rangeFor']>, 'calendar'> & { calendar: Omit<CalendarRangeEvaluation, 'workspace'> } }>;
  timelines: Array<{ key: string; value: ReturnType<CalendarPageCache['timelineFor']> }>;
};

/** Read-only worker entry; deliberately reuses the authoritative algorithms. */
export function prepareCalendarSlides(cache: CalendarPageCache, workspace: WorkspaceDocument, request: CalendarSlideRequest): CalendarPreparedSlides {
  const now = new Date(request.now), capacityNow = new Date(request.capacityNow);
  return {
    ranges: request.ranges.map(({ start, end }) => {
      const value = cache.rangeFor(workspace, start, end, now, capacityNow, request.allDayOpen);
      // Do not copy the entire source document back with every neighbour.
      const { workspace: projected, ...calendar } = value.calendar;
      const boundaries = prepareCalendarProjectionBoundaries(cache.evaluator.projections, workspace, start, end, dateKeys(start, end));
      return { start, end, boundaries, projectedItems: projected.items, value: { ...value, calendar } };
    }),
    timelines: request.timelines.map(key => ({ key, value: cache.timelineFor(workspace, key, now) })),
  };
}
