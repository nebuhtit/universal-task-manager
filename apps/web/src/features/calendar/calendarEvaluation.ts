import {
  withinPlacementWorkspace,
  compileQuery,
  expressionDependsOnCurrentTime,
  parseSortSource,
  recurrenceDisplayItems,
  activeRangeBounds,
  calendarDateKey,
  googleCalendarProjection,
  createOccurrence,
  createViewTimeMetricsAccumulator,
  activeRangeDailyDuration,
  itemDurationInsidePeriod,
  occupiedIntervals,
  unionDuration,
  type TimeInterval,
  participatesInTimeStatistics,
  projectOccurrences,
  plannedDateForDisplay,
  itemDeletionTime,
  scheduleDateKeysInRange,
  viewPeriodBoundsForDates,
  zonedDateStart,
  type CalendarDayViewPreferences,
  type ProjectedOccurrence,
  type SavedView,
  type UniversalItem,
  type ViewTimeMetrics,
  type WorkspaceDocument,
} from '@utm/core';
import { getWorkspaceIndex } from '../../services/workspaceIndex';
import { showOverdueToday } from './calendarVisibility';
import { isItemTemplate } from '../items/fieldDisplay';
import { attentionSortValues, sortViewItems, viewItemForEvaluation, type ViewEvaluation } from '../views/viewSelectors';
import { createCalendarProjectionCache, type CalendarProjectionCache } from './calendarProjectionCache';
import { measureProfile, recordProfileCache } from '../../services/performanceProfile';

type EvaluationCache = {
  projections: CalendarProjectionCache;
  rows: Map<string, { row: ProjectedOccurrence; source: UniversalItem; item: UniversalItem }>;
  source?: WorkspaceDocument;
  workspace?: WorkspaceDocument;
  context: string;
  days: Map<string, { signature: string; value: CalendarDayEvaluation }>;
  counters: { dayCalculations: number; indexBuilds: number };
};

/** Independent instance per Calendar; never writes into persisted workspace data. */
export function createCalendarEvaluator() {
  const cache: EvaluationCache = { projections: createCalendarProjectionCache(), rows: new Map(), context: '', days: new Map(), counters: { dayCalculations: 0, indexBuilds: 0 } };
  return { projections: cache.projections, counters: cache.counters,
    evaluate: (workspace: WorkspaceDocument, start: string, end: string, settings: CalendarDayViewPreferences, now: Date) => evaluateCalendarRange(workspace, start, end, settings, now, cache),
  };
}

export type CalendarProjectedEntry = { row: ProjectedOccurrence; item: UniversalItem };
export type CalendarDayEvaluation = {
  entries: CalendarProjectedEntry[];
  reservedItems: UniversalItem[];
  view: SavedView;
  metrics: ViewTimeMetrics;
  evaluation: ViewEvaluation;
};

export type CalendarRangeEvaluation = {
  workspace: WorkspaceDocument;
  projectedCount: number;
  filteredCount: number;
  days: Record<string, CalendarDayEvaluation>;
};

function shiftDateKey(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const value = new Date(Date.UTC(year!, month! - 1, day!));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function calendarDayView(key: string, settings: CalendarDayViewPreferences): SavedView {
  const filter = settings.filter.source.trim() || 'true';
  return {
    id: `calendar:${key}`,
    name: key,
    renderer: 'list',
    fields: [...settings.fields],
    query: { source: `(scheduleInPeriod("custom", "${settings.scheduleSources.join(',')}", false, 7, "${key}", "${key}")) && (${filter})` },
    sort: settings.sort.map((rule) => ({ field: rule.expression, direction: rule.direction, nulls: rule.nulls })),
    ...(settings.sortSource ? { sortSource: settings.sortSource } : {}),
    statistics: settings.statistics ?? { showTime: true, reservedItemIds: [] },
  };
}

function itemForRow(workspace: WorkspaceDocument, row: ProjectedOccurrence): UniversalItem | null {
  const source = workspace.items[row.materializedItemId ?? row.sourceItemId];
  if (!source) return null;
  if (!row.virtual) return { ...source, schedule: { ...row.schedule }, state: row.state };
  if (!row.recurrenceId) return null;
  const projected = createOccurrence(source, new Date(row.recurrenceId), 0);
  projected.id = row.id;
  projected.schedule = { ...row.schedule };
  projected.state = row.state;
  return projected;
}

/**
 * Evaluates an entire Calendar navigator range in one batch: recurrence is
 * projected once, the custom filter is evaluated once per occurrence, and
 * each accepted item is distributed directly into its intersected day buckets.
 */
export function evaluateCalendarRange(
  workspace: WorkspaceDocument,
  rangeStartKey: string,
  rangeEndKey: string,
  settings: CalendarDayViewPreferences,
  now: Date,
  cache?: EvaluationCache,
): CalendarRangeEvaluation {
  return measureProfile('calendar.evaluate', () => evaluateCalendarRangeInternal(workspace, rangeStartKey, rangeEndKey, settings, now, cache), value => ({ rows: value.projectedCount, matched: value.filteredCount, days: Object.keys(value.days).length }));
}

function evaluateCalendarRangeInternal(
  workspace: WorkspaceDocument,
  rangeStartKey: string,
  rangeEndKey: string,
  settings: CalendarDayViewPreferences,
  now: Date,
  cache?: EvaluationCache,
): CalendarRangeEvaluation {
  workspace = withinPlacementWorkspace(workspace, now);
  const timeZone = workspace.calendarPreferences.timezone;
  const today = calendarDateKey(now, timeZone);
  const rangeStart = zonedDateStart(rangeStartKey, timeZone);
  const rangeEnd = zonedDateStart(rangeEndKey, timeZone);
  const calendarWorkspace = cache?.projections.workspaceFor(workspace) ?? { ...workspace, items: Object.fromEntries(recurrenceDisplayItems(workspace).map((item) => [item.id, googleCalendarProjection(item)])) };
  const projected = (cache ? cache.projections.project(workspace, rangeStart, rangeEnd) : projectOccurrences(calendarWorkspace, rangeStart, rangeEnd))
    .map((row) => {
      const source = calendarWorkspace.items[row.materializedItemId ?? row.sourceItemId];
      const prior = cache?.rows.get(row.id);
      // An edited neighbour can rebuild the date/series projection bucket.
      // Keep this card when its source AND projected interval are unchanged.
      const item = prior && prior.source === source && (prior.row === row || JSON.stringify(prior.row) === JSON.stringify(row)) ? prior.item : itemForRow(calendarWorkspace, row);
      if (cache && source && item) cache.rows.set(row.id, { row, source, item });
      return { row, item };
    })
    .filter((entry): entry is CalendarProjectedEntry => Boolean(entry.item));
  const projectedIds = new Set(projected.map(entry => entry.item.id));
  if (cache) for (const id of cache.rows.keys()) if (!projectedIds.has(id)) cache.rows.delete(id);
  for (const item of Object.values(calendarWorkspace.items)) {
    const key = plannedDateForDisplay(item, now, timeZone);
    const overdue = today >= rangeStartKey && today < rangeEndKey && showOverdueToday(item, today, now, timeZone, item.occurrence ? calendarWorkspace.items[item.occurrence.seriesId] : undefined);
    // A boundary outside the range can still have a Due or active span inside it.
    const scheduledHere = (!key || activeRangeBounds(item)) && scheduleDateKeysInRange(item, settings.scheduleSources, rangeStartKey, rangeEndKey, { timeZone }).length > 0;
    if (!itemDeletionTime(calendarWorkspace, item) && item.role !== 'series_template' && ((key && key >= rangeStartKey && key < rangeEndKey) || scheduledHere || overdue) && !projectedIds.has(item.id)) {
      projected.push({ item, row: { id: item.id, sourceItemId: item.id, materializedItemId: item.id, virtual: false, title: item.title, state: item.state, preset: item.preset, schedule: { ...item.schedule! }, dueOnly: false } });
      projectedIds.add(item.id);
    }
  }
  let projectedWorkspace = {
    ...workspace,
    items: Object.fromEntries(projected.map(({ item }) => [item.id, item])),
  } as WorkspaceDocument;
  if (cache) {
    const prior = cache.workspace;
    if (cache.source === workspace && prior && Object.keys(prior.items).length === projected.length && projected.every(({ item }) => prior.items[item.id] === item)) projectedWorkspace = prior;
    else { cache.workspace = projectedWorkspace; cache.counters.indexBuilds++; }
    if (cache.source !== workspace) {
      const { items: _items, updatedAt: _updatedAt, calendarPreferences, ...rest } = workspace;
      // Timeline/List and other presentation-only preferences belong to the UI
      // revision. They must not invalidate the expensive calendar evaluation.
      const { timeline: _timeline, ...evaluationPreferences } = calendarPreferences;
      const context = { ...rest, calendarPreferences: evaluationPreferences };
      cache.context = JSON.stringify(context);
      cache.source = workspace;
    }
  }
  const index = getWorkspaceIndex(projectedWorkspace, true);
  const filterSource = settings.filter.source.trim() || 'true';
  const templateFilterRequested = /\bisTemplate\b/.test(filterSource);
  let predicate: ReturnType<typeof compileQuery> | null = null;
  try {
    predicate = compileQuery(filterSource, (item, at) => index.queryContextFor(item, at), {
      timeZone,
      weekStartsOn: workspace.calendarPreferences.weekStartsOn,
    });
  } catch { /* Invalid user filters consistently produce an empty Calendar. */ }

  const filtered = predicate ? projected.filter(({ item }) => {
    const source = viewItemForEvaluation(item);
    if (!templateFilterRequested && isItemTemplate(source)) return false;
    return predicate!(index.queryItemFor(source), now);
  }) : [];

  const buckets = new Map<string, {
    entries: CalendarProjectedEntry[];
    view: SavedView;
    metricItems: UniversalItem[];
    occurrenceIndexBySeries: Map<string, number>;
    standaloneIds: Set<string>;
    visibleSourceIds: Set<string>;
    reservedSourceIds: Set<string>;
    reserveCandidates: Map<string, UniversalItem>;
    reservedDurationMs: number;
    reservedIntervals: TimeInterval[];
  }>();
  for (let key = rangeStartKey; key < rangeEndKey; key = shiftDateKey(key, 1)) {
    buckets.set(key, {
      entries: [],
      view: calendarDayView(key, settings),
      metricItems: [],
      occurrenceIndexBySeries: new Map(),
      standaloneIds: new Set(),
      visibleSourceIds: new Set(),
      reservedSourceIds: new Set(),
      reserveCandidates: new Map(),
      reservedDurationMs: 0,
      reservedIntervals: [],
    });
  }

  const occurrencePreference = (left: CalendarProjectedEntry, right: CalendarProjectedEntry) => {
    if (left.item.state === 'open' && right.item.state !== 'open') return -1;
    if (right.item.state === 'open' && left.item.state !== 'open') return 1;
    return new Date(right.item.occurrence?.recurrenceId ?? right.item.updatedAt).getTime()
      - new Date(left.item.occurrence?.recurrenceId ?? left.item.updatedAt).getTime();
  };

  for (const entry of filtered) {
    const scheduleSource = viewItemForEvaluation(entry.item);
    const planned = plannedDateForDisplay(scheduleSource, now, timeZone);
    const keys = planned && !activeRangeBounds(scheduleSource) ? [planned] : scheduleDateKeysInRange(scheduleSource, settings.scheduleSources, rangeStartKey, rangeEndKey, { timeZone });
    if (showOverdueToday(scheduleSource, today, now, timeZone, scheduleSource.occurrence ? calendarWorkspace.items[scheduleSource.occurrence.seriesId] : undefined) && !keys.includes(today)) keys.push(today);
    for (const key of keys) {
      const bucket = buckets.get(key);
      if (!bucket) continue;
      const overdueCycle = showOverdueToday(scheduleSource, key, now, timeZone, scheduleSource.occurrence ? calendarWorkspace.items[scheduleSource.occurrence.seriesId] : undefined);
      const seriesId = entry.item.role === 'occurrence' && !entry.item.schedule?.plannedDate && !overdueCycle ? entry.item.occurrence?.seriesId : undefined;
      bucket.visibleSourceIds.add(seriesId ?? entry.item.id);
      if (!seriesId) {
        if (bucket.standaloneIds.has(entry.item.id)) continue;
        bucket.standaloneIds.add(entry.item.id);
        bucket.entries.push(entry);
        bucket.metricItems.push(entry.item);
        continue;
      }
      const existingIndex = bucket.occurrenceIndexBySeries.get(seriesId);
      if (existingIndex === undefined) {
        bucket.occurrenceIndexBySeries.set(seriesId, bucket.entries.length);
        bucket.entries.push(entry);
        bucket.metricItems.push(entry.item);
        continue;
      }
      const existing = bucket.entries[existingIndex]!;
      if (occurrencePreference(entry, existing) >= 0) continue;
      bucket.entries[existingIndex] = entry;
      bucket.metricItems.splice(bucket.metricItems.indexOf(existing.item), 1);
      bucket.metricItems.push(entry.item);
    }
  }

  const reservedIds = new Set(settings.statistics?.reservedItemIds ?? []);
  if (settings.statistics?.includeHiddenCompleted && predicate) {
    for (const { item } of projected) {
      if ((item.state !== 'done' && item.state !== 'auto_closed') || item.deletedAt || item.role === 'series_template' || !predicate(index.queryItemFor({ ...item, state: 'open' }), now)) continue;
      for (const key of scheduleDateKeysInRange(item, settings.scheduleSources, rangeStartKey, rangeEndKey, { timeZone })) {
        const bucket = buckets.get(key);
        if (!bucket || bucket.entries.some((entry) => entry.item.id === item.id)) continue;
        bucket.metricItems.push(item);
        bucket.visibleSourceIds.add(item.occurrence?.seriesId ?? item.id);
      }
    }
  }
  if (reservedIds.size) for (const entry of projected) {
    const sourceId = entry.item.role === 'occurrence' ? entry.item.occurrence?.seriesId : entry.item.id;
    if (!sourceId || !reservedIds.has(sourceId) || entry.item.deletedAt || entry.item.state === 'cancelled' || entry.item.state === 'archived' || entry.item.external?.transparency === 'transparent' || !participatesInTimeStatistics(entry.item)) continue;
    const keys = scheduleDateKeysInRange(viewItemForEvaluation(entry.item), ['event_open', 'event', 'active', 'due'], rangeStartKey, rangeEndKey, { timeZone });
    for (const key of keys) {
      const bucket = buckets.get(key);
      if (!bucket) continue;
      if (!bucket.reserveCandidates.has(sourceId)) bucket.reserveCandidates.set(sourceId, entry.item);
      if (bucket.visibleSourceIds.has(sourceId) || bucket.reservedSourceIds.has(sourceId)) continue;
      bucket.reservedSourceIds.add(sourceId);
      const period = viewPeriodBoundsForDates(key, key, timeZone);
      const activeShare = activeRangeDailyDuration(entry.item, period);
      if (activeShare !== null) bucket.reservedDurationMs += activeShare;
      else if (entry.item.schedule?.startAt || entry.item.external?.startAt) bucket.reservedIntervals.push(...occupiedIntervals(entry.item, period));
      else bucket.reservedDurationMs += itemDurationInsidePeriod(entry.item, period);
    }
  }

  const sortSource = settings.sortSource ?? settings.sort.map(rule => `${rule.expression} ${rule.direction} nulls ${rule.nulls}`).join('\n');
  let timeSort = true;
  let attentionSort = false;
  try {
    const rules = parseSortSource(sortSource);
    attentionSort = rules.some(rule => rule.expression === 'attentionOrder');
    timeSort = rules.some(rule => expressionDependsOnCurrentTime(rule.expression));
  } catch { /* Keep invalid sort behavior unchanged. */ }
  const days = Object.fromEntries([...buckets].map(([key, bucket]) => {
    const contentSensitive = /\b(title|body|bodyMarkdown|description|tags|contexts|areas|projects)\b/i.test(`${filterSource}\n${sortSource}`);
    const compactItem = (item: UniversalItem) => contentSensitive ? item : {
      id: item.id,
      state: item.state,
      schedule: item.schedule,
      occurrence: item.occurrence,
      external: item.external ? { transparency: item.external.transparency, startAt: item.external.startAt, endAt: item.external.endAt } : undefined,
    };
    const signature = cache ? measureProfile('calendar.signature', () => JSON.stringify([cache.context, bucket.view, bucket.entries.map(({ item, row }) => ({ row, item: compactItem(item) })), bucket.metricItems.map(compactItem), [...bucket.reserveCandidates].map(([id, item]) => [id, compactItem(item)]), bucket.reservedDurationMs, bucket.reservedIntervals, timeSort ? now.getTime() : null, attentionSort ? bucket.entries.map(({ item }) => attentionSortValues(viewItemForEvaluation(item), now)) : null]), () => ({ rows: bucket.entries.length })) : '';
    const prior = cache?.days.get(key);
    if (prior?.signature === signature) {
      recordProfileCache('calendar.day', true, 'unchanged');
      const currentItems = new Map(bucket.entries.map(({ item }) => [item.id, item]));
      const reuse = <T,>(before: T[], after: T[]) => before.length === after.length && before.every((value, i) => value === after[i]) ? before : after;
      const items = reuse(prior.value.evaluation.items, prior.value.evaluation.items.map(item => currentItems.get(item.id) ?? item));
      const entries = reuse(prior.value.entries, prior.value.entries.map(entry => {
        const item = currentItems.get(entry.item.id) ?? entry.item;
        return item === entry.item ? entry : { ...entry, item };
      }));
      const reservedItems = reuse(prior.value.reservedItems, [...bucket.reserveCandidates.values()]);
      const unchanged = items === prior.value.evaluation.items && entries === prior.value.entries && reservedItems === prior.value.reservedItems && +prior.value.evaluation.now === +now;
      const value = unchanged ? prior.value : { ...prior.value, entries, reservedItems, evaluation: { ...prior.value.evaluation, items, now } };
      cache!.days.set(key, { signature, value });
      return [key, value];
    }
    if (cache) recordProfileCache('calendar.day', false, prior ? 'day-signature' : 'empty', bucket.entries.length);
    const items = sortViewItems(projectedWorkspace, bucket.view, bucket.entries.map(({ item }) => item), now);
    const entriesById = new Map(bucket.entries.map((entry) => [entry.item.id, entry]));
    const entries = items.map((item) => entriesById.get(item.id)).filter((entry): entry is CalendarProjectedEntry => Boolean(entry));
    const accumulator = createViewTimeMetricsAccumulator(viewPeriodBoundsForDates(key, key, timeZone));
    bucket.metricItems.forEach(item => accumulator.add(item));
    const metrics = accumulator.finish(bucket.reservedDurationMs + unionDuration(bucket.reservedIntervals), bucket.reservedIntervals);
    if (!bucket.view.statistics?.showActualTime) delete metrics.actualDurationMs;
    const value = { entries, reservedItems: [...bucket.reserveCandidates.values()], view: bucket.view, metrics, evaluation: { items, metrics, now } };
    if (cache) { cache.days.set(key, { signature, value }); cache.counters.dayCalculations++; }
    return [key, value];
  }));
  if (cache) for (const key of cache.days.keys()) if (!buckets.has(key)) cache.days.delete(key);

  return { workspace: projectedWorkspace, projectedCount: projected.length, filteredCount: filtered.length, days };
}
