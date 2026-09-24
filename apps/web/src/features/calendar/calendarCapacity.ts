import {
  activeRangeDailyDuration, calendarDateKey, createViewTimeMetricsAccumulator, itemDurationInsidePeriod, occupiedIntervals,
  participatesInTimeStatistics, unionDuration, viewPeriodBoundsForDates,
  type UniversalItem, type WorkspaceDocument,
} from '@utm/core';
import type { CalendarDayEvaluation } from './calendarEvaluation';
import { showOverdueToday } from './calendarVisibility';

/** Reuse untouched full-day capacity; only today's remaining portion follows the clock. */
export function createCalendarCapacityCache() {
  const days = new Map<string, { workspace: WorkspaceDocument; items: UniversalItem[]; reserved: UniversalItem[]; undated: UniversalItem[]; allDayOpen: boolean; input: string; signature: string; value: ReturnType<typeof calendarVisibleCapacity> }>();
  const counters = { calculations: 0 };
  return { counters, calculate(workspace: WorkspaceDocument, day: CalendarDayEvaluation, key: string, now: Date, undated: UniversalItem[], allDayOpen: boolean) {
    // JSON signatures are only built when inputs change, not on each clock tick.
    const zone = workspace.calendarPreferences.timezone;
    const prior = days.get(key);
    const input = prior && prior.workspace === workspace && prior.items === day.evaluation.items && prior.reserved === day.reservedItems && prior.undated === undated && prior.allDayOpen === allDayOpen ? prior.input
      : JSON.stringify([zone, workspace.calendarPreferences.timeline?.showOverdue, workspace.calendarPreferences.timeline?.showUndated, allDayOpen, day.evaluation.items, day.reservedItems, undated, day.evaluation.items.map(item => item.occurrence ? workspace.items[item.occurrence.seriesId]?.recurrence : null)]);
    const signature = `${input}:${calendarDateKey(now, zone) === key ? now.getTime() : 'full'}`;
    if (prior?.signature === signature) {
      days.set(key, { ...prior, workspace, items: day.evaluation.items, reserved: day.reservedItems, undated, allDayOpen });
      return prior.value;
    }
    const value = calendarVisibleCapacity(workspace, day, key, now, undated, allDayOpen);
    if (days.size >= 62 && !days.has(key)) days.delete(days.keys().next().value!);
    days.set(key, { workspace, items: day.evaluation.items, reserved: day.reservedItems, undated, allDayOpen, input, signature, value }); counters.calculations++;
    return value;
  } };
}

/** One read-only capacity result shared by the navigator, header and Timeline. */
export function calendarVisibleCapacity(
  workspace: WorkspaceDocument,
  day: CalendarDayEvaluation,
  key: string,
  now: Date,
  undatedItems: UniversalItem[],
  allDayOpen: boolean,
) {
  const zone = workspace.calendarPreferences.timezone;
  const settings = workspace.calendarPreferences.timeline;
  const fullDay = viewPeriodBoundsForDates(key, key, zone);
  // Today's capacity is actionable time remaining, not free hours already past.
  // Other days still use their complete local-day bounds.
  const current = now.getTime();
  const period = current >= fullDay.start.getTime() && current < fullDay.endExclusive.getTime()
    ? { ...fullDay, start: now, durationMs: fullDay.endExclusive.getTime() - current }
    : fullDay;
  const accumulator = createViewTimeMetricsAccumulator(period);
  const visible = new Map<string, UniversalItem>();
  for (const item of day.evaluation.items) {
    const overdue = showOverdueToday(item, key, now, zone, item.occurrence ? workspace.items[item.occurrence.seriesId] : undefined);
    if (overdue && settings?.showOverdue === false) continue;
    if (item.schedule?.allDay && !overdue && !allDayOpen) continue;
    visible.set(item.id, item);
  }
  if (settings?.showUndated === true) for (const item of undatedItems) if (!visible.has(item.id)) visible.set(item.id, item);
  const visibleSources = new Set([...visible.values()].map(item => item.occurrence?.seriesId ?? item.id));
  for (const item of visible.values()) {
    const overdue = showOverdueToday(item, key, now, zone, item.occurrence ? workspace.items[item.occurrence.seriesId] : undefined);
    // An old timed interval must not be moved to today. Its remaining Duration is
    // tentative work, rather than occupancy at the historical event time.
    if (overdue && item.state === 'open' && occupiedIntervals(item, period).length === 0) {
      const schedule = { ...item.schedule! };
      delete schedule.startAt;
      delete schedule.endAt;
      const external = item.external ? { ...item.external } : undefined;
      if (external) { delete external.startAt; delete external.endAt; }
      const copy = { ...item, schedule, ...(external ? { external } : {}) };
      accumulator.add(copy);
    } else accumulator.add(item);
  }
  const reservedIntervals = [] as ReturnType<typeof occupiedIntervals>;
  let reservedUnanchoredMs = 0;
  for (const item of day.reservedItems) {
    if (visibleSources.has(item.occurrence?.seriesId ?? item.id) || !participatesInTimeStatistics(item) || item.external?.transparency === 'transparent') continue;
    const activeShare = activeRangeDailyDuration(item, period);
    if (activeShare !== null) reservedUnanchoredMs += activeShare;
    else if (item.external?.startAt || item.schedule?.startAt) reservedIntervals.push(...occupiedIntervals(item, period));
    else reservedUnanchoredMs += itemDurationInsidePeriod(item, period);
  }
  const reservedMs = reservedUnanchoredMs + unionDuration(reservedIntervals);
  const withoutReserveMs = accumulator.finish().freeDurationMs ?? period.durationMs;
  const metrics = accumulator.finish(reservedMs, reservedIntervals);
  const freeMs = metrics.freeDurationMs ?? period.durationMs;
  return { freeMs, hiddenReservedMs: Math.max(0, withoutReserveMs - freeMs) };
}
