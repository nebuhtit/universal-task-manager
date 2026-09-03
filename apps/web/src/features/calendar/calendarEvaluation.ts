import {
  compileQuery,
  createOccurrence,
  createViewTimeMetricsAccumulator,
  projectOccurrences,
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
import { isItemTemplate } from '../items/fieldDisplay';
import { sortViewItems, viewItemForEvaluation, type ViewEvaluation } from '../views/viewSelectors';

export type CalendarProjectedEntry = { row: ProjectedOccurrence; item: UniversalItem };
export type CalendarDayEvaluation = {
  entries: CalendarProjectedEntry[];
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
    statistics: { showTime: true, reservedItemIds: [] },
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
): CalendarRangeEvaluation {
  const timeZone = workspace.calendarPreferences.timezone;
  const rangeStart = zonedDateStart(rangeStartKey, timeZone);
  const rangeEnd = zonedDateStart(rangeEndKey, timeZone);
  const projected = projectOccurrences(workspace, rangeStart, rangeEnd)
    .map((row) => ({ row, item: itemForRow(workspace, row) }))
    .filter((entry): entry is CalendarProjectedEntry => Boolean(entry.item));
  const projectedWorkspace = {
    ...workspace,
    items: Object.fromEntries(projected.map(({ item }) => [item.id, item])),
  } as WorkspaceDocument;
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
    metrics: ReturnType<typeof createViewTimeMetricsAccumulator>;
    occurrenceIndexBySeries: Map<string, number>;
    standaloneIds: Set<string>;
  }>();
  for (let key = rangeStartKey; key < rangeEndKey; key = shiftDateKey(key, 1)) {
    buckets.set(key, {
      entries: [],
      view: calendarDayView(key, settings),
      metrics: createViewTimeMetricsAccumulator(viewPeriodBoundsForDates(key, key, timeZone)),
      occurrenceIndexBySeries: new Map(),
      standaloneIds: new Set(),
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
    const keys = scheduleDateKeysInRange(scheduleSource, settings.scheduleSources, rangeStartKey, rangeEndKey, { timeZone });
    for (const key of keys) {
      const bucket = buckets.get(key);
      if (!bucket) continue;
      const seriesId = entry.item.role === 'occurrence' ? entry.item.occurrence?.seriesId : undefined;
      if (!seriesId) {
        if (bucket.standaloneIds.has(entry.item.id)) continue;
        bucket.standaloneIds.add(entry.item.id);
        bucket.entries.push(entry);
        bucket.metrics.add(entry.item);
        continue;
      }
      const existingIndex = bucket.occurrenceIndexBySeries.get(seriesId);
      if (existingIndex === undefined) {
        bucket.occurrenceIndexBySeries.set(seriesId, bucket.entries.length);
        bucket.entries.push(entry);
        bucket.metrics.add(entry.item);
        continue;
      }
      const existing = bucket.entries[existingIndex]!;
      if (occurrencePreference(entry, existing) >= 0) continue;
      bucket.entries[existingIndex] = entry;
      bucket.metrics.remove(existing.item);
      bucket.metrics.add(entry.item);
    }
  }

  const days = Object.fromEntries([...buckets].map(([key, bucket]) => {
    const items = sortViewItems(projectedWorkspace, bucket.view, bucket.entries.map(({ item }) => item), now);
    const entriesById = new Map(bucket.entries.map((entry) => [entry.item.id, entry]));
    const entries = items.map((item) => entriesById.get(item.id)).filter((entry): entry is CalendarProjectedEntry => Boolean(entry));
    const metrics = bucket.metrics.finish();
    return [key, { entries, view: bucket.view, metrics, evaluation: { items, metrics, now } }];
  }));

  return { workspace: projectedWorkspace, projectedCount: projected.length, filteredCount: filtered.length, days };
}
