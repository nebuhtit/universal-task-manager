import { schedulePeriodBounds, type QueryTemporalOptions, type SchedulePeriod } from './dsl.js';
import { projectOccurrences } from './calendar.js';
import { effectiveItemDurationMs, participatesInTimeStatistics, type ItemSetMetrics } from './organization.js';
import type { SavedView, UniversalItem, WorkspaceDocument } from './types.js';

const DAY_MS = 86_400_000;

export interface ViewPeriodBounds {
  period: SchedulePeriod;
  startDate: string;
  endDate: string;
  start: Date;
  endExclusive: Date;
  durationMs: number;
}

export interface ViewTimeMetrics extends ItemSetMetrics {
  periodDurationMs?: number;
  reservedDurationMs: number;
  freeDurationMs?: number;
}

export interface ViewTimeMetricsAccumulator {
  add(item: UniversalItem): void;
  remove(item: UniversalItem): void;
  finish(reservedDurationMs?: number): ViewTimeMetrics;
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

/** Resolves the start of a calendar date in an IANA timezone without relying on the host timezone. */
export function zonedDateStart(key: string, timeZone: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  const wallClock = Date.UTC(year!, month! - 1, day!);
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

export function viewPeriodBoundsForDates(startDate: string, endDate: string, timeZone = 'UTC'): ViewPeriodBounds {
  return {
    period: 'custom',
    startDate,
    endDate,
    start: zonedDateStart(startDate, timeZone),
    endExclusive: zonedDateStart(shiftDateKey(endDate, 1), timeZone),
    durationMs: dateCount(startDate, endDate) * DAY_MS,
  };
}

function dateCount(start: string, end: string): number {
  const startOrdinal = Date.parse(`${start}T00:00:00.000Z`);
  const endOrdinal = Date.parse(`${end}T00:00:00.000Z`);
  return Number.isFinite(startOrdinal) && Number.isFinite(endOrdinal) ? Math.floor((endOrdinal - startOrdinal) / DAY_MS) + 1 : 0;
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
    startDate: bounds.start,
    endDate: bounds.end,
    start: zonedDateStart(bounds.start, timeZone),
    endExclusive: zonedDateStart(endExclusiveDate, timeZone),
    durationMs: dateCount(bounds.start, bounds.end) * DAY_MS,
  };
}

const eligible = (item: UniversalItem) => !item.deletedAt
  && item.role !== 'series_template'
  && item.state !== 'cancelled'
  && item.state !== 'archived'
  && item.external?.transparency !== 'transparent'
  && participatesInTimeStatistics(item);

function durationInsidePeriod(item: UniversalItem, period: ViewPeriodBounds): number {
  const duration = effectiveItemDurationMs(item);
  if (duration <= 0) return 0;
  const start = item.schedule?.startAt ? Date.parse(item.schedule.startAt) : Number.NaN;
  const explicitEnd = item.schedule?.endAt ? Date.parse(item.schedule.endAt) : Number.NaN;
  if (!Number.isFinite(start)) return duration;
  const end = Number.isFinite(explicitEnd) && explicitEnd > start ? explicitEnd : start + duration;
  const overlap = Math.min(end, period.endExclusive.getTime()) - Math.max(start, period.start.getTime());
  return overlap > 0 ? overlap : duration;
}

/** Incrementally derives exactly the same metrics as a finite-period View. */
export function createViewTimeMetricsAccumulator(period?: ViewPeriodBounds): ViewTimeMetricsAccumulator {
  let totalItems = 0;
  let completedItems = 0;
  let totalDurationMs = 0;
  let completedDurationMs = 0;
  let remainingDurationMs = 0;
  let plannedDurationMs = 0;
  const seen = new Set<string>();
  const apply = (item: UniversalItem, direction: 1 | -1) => {
    const duration = effectiveItemDurationMs(item);
    if (!item.deletedAt && item.role !== 'series_template' && item.state !== 'cancelled' && item.state !== 'archived' && !item.external?.readOnly && participatesInTimeStatistics(item)) {
      totalItems += direction;
      totalDurationMs += direction * duration;
      if (item.state === 'done' || item.state === 'auto_closed') {
        completedItems += direction;
        completedDurationMs += direction * duration;
      } else if (item.state === 'open') remainingDurationMs += direction * duration;
    }
    if (period && eligible(item)) plannedDurationMs += direction * durationInsidePeriod(item, period);
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
    finish(reservedDurationMs = 0) {
      const base: ViewTimeMetrics = {
        totalItems,
        completedItems,
        completionPercent: totalDurationMs ? Math.round(completedDurationMs / totalDurationMs * 100) : 0,
        remainingDurationMs,
        reservedDurationMs,
      };
      if (!period) return base;
      return {
        ...base,
        periodDurationMs: period.durationMs,
        freeDurationMs: period.durationMs - plannedDurationMs - reservedDurationMs,
      };
    },
  };
}

/** Computes view metrics on demand. Nothing derived here is persisted in the workspace. */
export function calculateViewTimeMetrics(workspace: WorkspaceDocument, view: SavedView, matchingItems: Iterable<UniversalItem>, now = new Date()): ViewTimeMetrics {
  const items = [...matchingItems];
  const period = inferViewPeriod(view, now, { timeZone: workspace.calendarPreferences.timezone, weekStartsOn: workspace.calendarPreferences.weekStartsOn });
  const accumulator = createViewTimeMetricsAccumulator(period ?? undefined);
  items.forEach((item) => accumulator.add(item));
  if (!period) return accumulator.finish();

  const matchingIds = new Set(items.filter(eligible).map((item) => item.id));
  let reservedDurationMs = 0;
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
      if (occurrenceDuration > 0) reservedDurationMs += occurrenceDuration;
    }
  }
  return accumulator.finish(reservedDurationMs);
}
