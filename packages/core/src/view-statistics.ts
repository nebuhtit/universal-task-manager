import { calendarDateKey, compileQuery, schedulePeriodBounds, type QueryTemporalOptions, type SchedulePeriod } from './dsl.js';
import { actualTimeMs } from './item-history.js';
import { projectOccurrences } from './calendar.js';
import { effectiveItemDurationMs, participatesInTimeStatistics, type ItemSetMetrics } from './organization.js';
import { durationToMs, type SavedView, type UniversalItem, type WorkspaceDocument } from './types.js';

const DAY_MS = 86_400_000;

export interface ViewPeriodBounds {
  period: SchedulePeriod;
  startDate: string;
  endDate: string;
  start: Date;
  endExclusive: Date;
  durationMs: number;
  timeZone: string;
}

export interface ViewTimeMetrics extends ItemSetMetrics {
  periodDurationMs?: number;
  reservedDurationMs: number;
  freeDurationMs?: number;
}

export interface ViewTimeMetricsAccumulator {
  add(item: UniversalItem): void;
  remove(item: UniversalItem): void;
  finish(reservedDurationMs?: number, reservedIntervals?: TimeInterval[]): ViewTimeMetrics;
}
export type TimeInterval = { start: number; end: number };
/** Shared capacity arithmetic; proposals never become persisted busy intervals. */
export function timeCapacity(period: TimeInterval, intervals: TimeInterval[], taskDurationMs = 0) {
  const busyMs = unionDuration(intervals.map(value => ({ start: Math.max(period.start, value.start), end: Math.min(period.end, value.end) })).filter(value => value.end > value.start));
  const availableMs = Math.max(0, period.end - period.start) - busyMs;
  return { busyMs, availableMs, remainingMs: availableMs - taskDurationMs };
}
export function unionDuration(intervals: TimeInterval[]): number {
  let total = 0, end = -Infinity;
  for (const interval of [...intervals].sort((a, b) => a.start - b.start)) {
    total += Math.max(0, interval.end - Math.max(interval.start, end));
    end = Math.max(end, interval.end);
  }
  return total;
}
function clippedInterval(start: number, end: number, period: ViewPeriodBounds): TimeInterval[] {
  const clipped = { start: Math.max(start, period.start.getTime()), end: Math.min(end, period.endExclusive.getTime()) };
  return clipped.end > clipped.start ? [clipped] : [];
}
export function occupiedIntervals(item: UniversalItem, period: ViewPeriodBounds): TimeInterval[] {
  const linked = item.external?.readOnly === false && item.external.startAt ? item.external : undefined;
  const start = Date.parse(linked?.startAt ?? item.schedule?.startAt ?? '');
  const explicitEnd = Date.parse(linked?.endAt ?? item.schedule?.endAt ?? '');
  if (!Number.isFinite(start)) return Number.isFinite(explicitEnd) ? clippedInterval(explicitEnd, explicitEnd + travelDurationMs(item, true), period) : [];
  const end = Number.isFinite(explicitEnd) ? explicitEnd : start + effectiveItemDurationMs(item);
  if (end < start) return [];
  const event = (linked?.allDay ?? item.schedule?.allDay) || item.external?.transparency === 'transparent' ? [] : clippedInterval(start, end, period);
  return [...event, ...clippedInterval(start - travelDurationMs(item), start, period), ...clippedInterval(end, end + travelDurationMs(item, true), period)];
}

/** Flexible work between Event opens and Due is not a fixed calendar booking. */
export function activeRangeBounds(item: UniversalItem): { start: number; end: number } | null {
  if (item.external || item.schedule?.endAt || item.schedule?.allDay || !item.schedule?.dueAt) return null;
  const start = Date.parse(item.schedule.startAt ?? '');
  const end = Date.parse(item.schedule.dueAt);
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
}

/** Equal calendar-day shares, inclusive of both boundary dates and independent of DST. */
export function activeRangeDailyDuration(item: UniversalItem, period: ViewPeriodBounds): number | null {
  const range = activeRangeBounds(item);
  if (!range) return null;
  const first = calendarDateKey(new Date(range.start), period.timeZone);
  const last = calendarDateKey(new Date(range.end), period.timeZone);
  const days = Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / DAY_MS) + 1;
  const overlapStart = period.startDate > first ? period.startDate : first;
  const overlapEnd = period.endDate < last ? period.endDate : last;
  if (overlapStart > overlapEnd || days <= 0) return 0;
  const included = Math.round((Date.parse(`${overlapEnd}T00:00:00Z`) - Date.parse(`${overlapStart}T00:00:00Z`)) / DAY_MS) + 1;
  return effectiveItemDurationMs(item) * included / days;
}

function shiftDateKey(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const value = new Date(Date.UTC(year!, month! - 1, day!));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function localParts(date: Date, timeZone: string): Record<string, number> {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(date);
    return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
  } catch {
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: date.getUTCHours(), minute: date.getUTCMinutes(), second: date.getUTCSeconds() };
  }
}

/** Resolves a calendar date and time in an IANA timezone without relying on the host timezone. */
export function zonedDateTime(key: string, hour: number, minute: number, timeZone: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  const wallClock = Date.UTC(year!, month! - 1, day!, hour, minute);
  let instant = new Date(wallClock);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const displayed = localParts(instant, timeZone);
    const displayedAsUtc = Date.UTC(displayed.year!, displayed.month! - 1, displayed.day!, displayed.hour!, displayed.minute!, displayed.second!);
    const next = new Date(wallClock - (displayedAsUtc - instant.getTime()));
    if (next.getTime() === instant.getTime()) break;
    instant = next;
  }
  return instant;
}

/** Resolves the start of a calendar date in an IANA timezone without relying on the host timezone. */
export function zonedDateStart(key: string, timeZone: string): Date { return zonedDateTime(key, 0, 0, timeZone); }

export function viewPeriodBoundsForDates(startDate: string, endDate: string, timeZone = 'UTC'): ViewPeriodBounds {
  return {
    period: 'custom',
    timeZone,
    startDate,
    endDate,
    start: zonedDateStart(startDate, timeZone),
    endExclusive: zonedDateStart(shiftDateKey(endDate, 1), timeZone),
    durationMs: zonedDateStart(shiftDateKey(endDate, 1), timeZone).getTime() - zonedDateStart(startDate, timeZone).getTime(),
  };
}

/** Infers one finite resource period from a visual schedule filter or the built-in legacy Today/Week filters. */
export function inferViewPeriod(view: Pick<SavedView, 'query'>, now: Date, options: QueryTemporalOptions = {}): ViewPeriodBounds | null {
  const source = view.query.source;
  const pattern = /scheduleInPeriod\("(today|tomorrow|this_week|next_week|next_days|custom)",\s*"[a-z_,]*",\s*(?:true|false),\s*(\d+),\s*"(\d{4}-\d{2}-\d{2}|)",\s*"(\d{4}-\d{2}-\d{2}|)"\)/g;
  const matches = [...source.matchAll(pattern)].map((match) => ({ period: match[1] as SchedulePeriod, nextDays: Number(match[2]), customStart: match[3] ?? '', customEnd: match[4] ?? '' }));
  let selected = matches.length === 1 ? matches[0] : undefined;
  if (!matches.length) {
    const today = /\b(eventToday|dueTodayOrOverdue)\b/.test(source);
    const week = /\b(eventThisWeek|dueThisWeekOrOverdue)\b/.test(source);
    if (today !== week) selected = { period: today ? 'today' : 'this_week', nextDays: 7, customStart: '', customEnd: '' };
  }
  if (!selected) return null;
  const bounds = schedulePeriodBounds(selected.period, now, options, selected.nextDays, selected.customStart, selected.customEnd);
  if (!bounds) return null;
  const timeZone = options.timeZone || 'UTC';
  const endExclusiveDate = shiftDateKey(bounds.end, 1);
  return {
    period: selected.period,
    timeZone,
    startDate: bounds.start,
    endDate: bounds.end,
    start: zonedDateStart(bounds.start, timeZone),
    endExclusive: zonedDateStart(endExclusiveDate, timeZone),
    durationMs: zonedDateStart(endExclusiveDate, timeZone).getTime() - zonedDateStart(bounds.start, timeZone).getTime(),
  };
}

function travelDurationMs(item: UniversalItem, back = false): number {
  try {
    const duration = durationToMs((back ? item.schedule?.travelBackDuration : item.schedule?.travelDuration) ?? 'PT0S');
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  } catch { return 0; }
}

const eligible = (item: UniversalItem) => !item.deletedAt
  && item.role !== 'series_template'
  && item.state !== 'cancelled'
  && item.state !== 'archived'
  && (participatesInTimeStatistics(item) || Boolean(item.schedule?.startAt && (travelDurationMs(item) > 0 || travelDurationMs(item, true) > 0)));

function overlap(start: number, end: number, period: ViewPeriodBounds): number {
  return Math.max(0, Math.min(end, period.endExclusive.getTime()) - Math.max(start, period.start.getTime()));
}

export function itemDurationInsidePeriod(item: UniversalItem, period: ViewPeriodBounds): number {
  const travel = travelDurationMs(item);
  if (item.external?.readOnly === false) {
    const start = Date.parse(item.external.startAt ?? ''); const end = Date.parse(item.external.endAt ?? '');
    if (!Number.isFinite(start)) return 0;
    const event = item.external.allDay || item.external.transparency === 'transparent' || !Number.isFinite(end) ? 0 : overlap(start, end, period);
    return event + overlap(start - travel, start, period) + (Number.isFinite(end) ? overlap(end, end + travelDurationMs(item, true), period) : 0);
  }
  const duration = effectiveItemDurationMs(item);
  const start = item.schedule?.startAt ? Date.parse(item.schedule.startAt) : Number.NaN;
  const explicitEnd = item.schedule?.endAt ? Date.parse(item.schedule.endAt) : Number.NaN;
  if (!Number.isFinite(start)) return duration > 0 ? duration : 0;
  const end = Number.isFinite(explicitEnd) && explicitEnd > start ? explicitEnd : start + duration;
  const eventOverlap = overlap(start, end, period);
  const event = item.schedule?.allDay || item.external?.transparency === 'transparent' ? 0 : eventOverlap;
  return event + overlap(start - travel, start, period) + overlap(end, end + travelDurationMs(item, true), period);
}

/** Incrementally derives exactly the same metrics as a finite-period View. */
export function createViewTimeMetricsAccumulator(period?: ViewPeriodBounds): ViewTimeMetricsAccumulator {
  let totalItems = 0;
  let completedItems = 0;
  let totalDurationMs = 0;
  let completedDurationMs = 0;
  let remainingDurationMs = 0;
  let plannedDurationMs = 0;
  let actualDurationMs = 0;
  const seen = new Set<string>();
  const occupied = new Map<string, TimeInterval[]>();
  const apply = (item: UniversalItem, direction: 1 | -1) => {
    if (!item.deletedAt && item.role !== 'series_template' && item.state !== 'cancelled' && item.state !== 'archived' && participatesInTimeStatistics(item) && (!item.external?.readOnly || item.external.transparency !== 'transparent')) actualDurationMs += direction * actualTimeMs(item);
    const duration = effectiveItemDurationMs(item);
    if (!item.deletedAt && item.role !== 'series_template' && item.state !== 'cancelled' && item.state !== 'archived' && !item.external?.readOnly && item.canBeCompleted !== false && !item.isNote && participatesInTimeStatistics(item)) {
      totalItems += direction;
      totalDurationMs += direction * duration;
      if (item.state === 'done' || item.state === 'auto_closed') {
        completedItems += direction;
        completedDurationMs += direction * duration;
      } else if (item.state === 'open') remainingDurationMs += direction * duration;
    }
    if (period && eligible(item)) {
      const activeShare = activeRangeDailyDuration(item, period);
      if (activeShare !== null) { plannedDurationMs += direction * activeShare; return; }
      const anchored = Boolean(item.external?.startAt ?? item.schedule?.startAt) || Boolean(item.schedule?.endAt && travelDurationMs(item, true) > 0);
      if (anchored) { if (direction === 1) occupied.set(item.id, occupiedIntervals(item, period)); else occupied.delete(item.id); }
      else plannedDurationMs += direction * itemDurationInsidePeriod(item, period);
    }
  };
  return {
    add(item) {
      if (seen.has(item.id)) return;
      seen.add(item.id);
      apply(item, 1);
    },
    remove(item) {
      if (!seen.delete(item.id)) return;
      apply(item, -1);
    },
    finish(reservedDurationMs = 0, reservedIntervals: TimeInterval[] = []) {
      const base: ViewTimeMetrics = {
        totalItems,
        completedItems,
        completionPercent: totalDurationMs ? Math.round(completedDurationMs / totalDurationMs * 100) : 0,
        remainingDurationMs,
        reservedDurationMs,
        actualDurationMs,
      };
      if (!period) return base;
      return {
        ...base,
        periodDurationMs: period.durationMs,
        freeDurationMs: timeCapacity({ start: period.start.getTime(), end: period.endExclusive.getTime() }, [...occupied.values()].flat().concat(reservedIntervals), plannedDurationMs + Math.max(0, reservedDurationMs - unionDuration(reservedIntervals))).remainingMs,
      };
    },
  };
}

/** Computes view metrics on demand. Nothing derived here is persisted in the workspace. */
export function viewStatisticsItems(workspace: WorkspaceDocument, view: SavedView, matchingItems: Iterable<UniversalItem>, now = new Date(), matchesForStatistics?: (item: UniversalItem) => boolean): UniversalItem[] {
  const items = [...matchingItems];
  if (view.statistics?.includeHiddenCompleted) {
    const included = new Set(items.map((item) => item.id));
    let predicate = matchesForStatistics;
    if (!predicate) {
      try {
        const query = compileQuery(view.query.source || 'true', undefined, { timeZone: workspace.calendarPreferences.timezone, weekStartsOn: workspace.calendarPreferences.weekStartsOn });
        predicate = (item) => query(item, now);
      } catch { predicate = () => false; }
    }
    for (const item of Object.values(workspace.items)) {
      if (!['done', 'auto_closed'].includes(item.state) || item.deletedAt || item.role === 'series_template' || included.has(item.id)) continue;
      if (view.area && !item.areas.includes(view.area) || view.project && !item.projects.includes(view.project) || view.list && item.list !== view.list) continue;
      if (predicate({ ...item, state: 'open' })) { items.push(item); included.add(item.id); }
    }
  }
  return items;
}

export function calculateViewTimeMetrics(workspace: WorkspaceDocument, view: SavedView, matchingItems: Iterable<UniversalItem>, now = new Date(), matchesForStatistics?: (item: UniversalItem) => boolean): ViewTimeMetrics {
  const items = viewStatisticsItems(workspace, view, matchingItems, now, matchesForStatistics);
  const period = inferViewPeriod(view, now, { timeZone: workspace.calendarPreferences.timezone, weekStartsOn: workspace.calendarPreferences.weekStartsOn });
  const accumulator = createViewTimeMetricsAccumulator(period ?? undefined);
  const finish = (reserved = 0, intervals: TimeInterval[] = []) => {
    const metrics = accumulator.finish(reserved, intervals);
    if (!view.statistics?.showActualTime) delete metrics.actualDurationMs;
    return metrics;
  };
  items.forEach((item) => accumulator.add(item));
  if (!period) return finish();

  const matchingIds = new Set(items.filter(eligible).map((item) => item.id));
  let reservedDurationMs = 0;
  const reservedIntervals: TimeInterval[] = [];
  const reservedIds = new Set(view.statistics?.reservedItemIds ?? []);
  if (reservedIds.size) {
    let occurrences: ReturnType<typeof projectOccurrences> = [];
    try { occurrences = projectOccurrences(workspace, period.start, period.endExclusive); } catch { /* A malformed imported recurrence must not break the view. */ }
    for (const occurrence of occurrences) {
      if (!reservedIds.has(occurrence.sourceItemId)) continue;
      if (occurrence.materializedItemId && matchingIds.has(occurrence.materializedItemId)) continue;
      const materialized = occurrence.materializedItemId ? workspace.items[occurrence.materializedItemId] : undefined;
      if (materialized && !eligible(materialized)) continue;
      const source = workspace.items[occurrence.sourceItemId];
      if (!source || source.deletedAt) continue;
      const start = occurrence.schedule.startAt ? Date.parse(occurrence.schedule.startAt) : Number.NaN;
      const end = occurrence.schedule.endAt ? Date.parse(occurrence.schedule.endAt) : Number.NaN;
      const fullDuration = Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : effectiveItemDurationMs(source);
      const occurrenceDuration = Number.isFinite(start)
        ? Math.max(0, Math.min((Number.isFinite(end) && end > start ? end : start + fullDuration), period.endExclusive.getTime()) - Math.max(start, period.start.getTime()))
        : fullDuration;
      const occurrenceTravel = Number.isFinite(start) ? overlap(start - travelDurationMs(source), start, period) : 0;
      const reservation = { ...source, schedule: occurrence.schedule };
      const activeShare = activeRangeDailyDuration(reservation, period);
      if (activeShare !== null) { reservedDurationMs += activeShare; continue; }
      if (Number.isFinite(start)) {
        reservedIntervals.push(...occupiedIntervals(reservation, period));
      } else if (occurrenceDuration > 0 || occurrenceTravel > 0) reservedDurationMs += occurrenceDuration + occurrenceTravel;
    }
  }
  return finish(reservedDurationMs + unionDuration(reservedIntervals), reservedIntervals);
}
