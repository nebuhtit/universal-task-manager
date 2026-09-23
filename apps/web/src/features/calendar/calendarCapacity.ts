import {
  createViewTimeMetricsAccumulator, itemDurationInsidePeriod, occupiedIntervals,
  participatesInTimeStatistics, unionDuration, viewPeriodBoundsForDates,
  type UniversalItem, type WorkspaceDocument,
} from '@utm/core';
import type { CalendarDayEvaluation } from './calendarEvaluation';
import { showOverdueToday } from './calendarVisibility';

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
  const period = viewPeriodBoundsForDates(key, key, zone);
  const accumulator = createViewTimeMetricsAccumulator(period);
  const visible = new Map<string, UniversalItem>();
  for (const item of day.evaluation.items) {
    const overdue = showOverdueToday(item, key, now, zone, item.occurrence ? workspace.items[item.occurrence.seriesId] : undefined);
    if (overdue && settings?.showOverdue === false) continue;
    if (item.schedule?.allDay && !overdue && !allDayOpen) continue;
    visible.set(item.id, item);
  }
  if (settings?.showUndated === true) for (const item of undatedItems) visible.set(item.id, item);
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
    if (item.external?.startAt || item.schedule?.startAt) reservedIntervals.push(...occupiedIntervals(item, period));
    else reservedUnanchoredMs += itemDurationInsidePeriod(item, period);
  }
  const reservedMs = reservedUnanchoredMs + unionDuration(reservedIntervals);
  const withoutReserveMs = accumulator.finish().freeDurationMs ?? period.durationMs;
  const metrics = accumulator.finish(reservedMs, reservedIntervals);
  const freeMs = metrics.freeDurationMs ?? period.durationMs;
  return { freeMs, hiddenReservedMs: Math.max(0, withoutReserveMs - freeMs) };
}
