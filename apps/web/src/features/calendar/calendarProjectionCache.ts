import { effectiveItemDurationMs, googleCalendarProjection, projectOccurrences, recurrenceDisplayItems, type ProjectedOccurrence, type UniversalItem, type WorkspaceDocument } from '@utm/core';
import { beginProfileSpan, measureProfile, recordProfileCache } from '../../services/performanceProfile';

// A week needs seven day ranges plus navigator/evaluation queries. Four slots
// evicted still-visible days before the next refresh could reuse them.
const MAX_CACHED_RANGES = 10;
const MAX_CACHED_ROWS = 10_000;
function cacheRange(cache: Map<string, ProjectedOccurrence[]>, key: string, rows: ProjectedOccurrence[]) {
  // Bound memory as well as entries. One unusually large result may be cached,
  // but must not coexist with additional large ranges.
  const budget = Math.max(MAX_CACHED_ROWS, rows.length);
  let total = rows.length;
  for (const value of cache.values()) total += value.length;
  while (cache.size && (cache.size >= MAX_CACHED_RANGES || total > budget)) {
    const oldest = cache.keys().next().value!;
    total -= cache.get(oldest)!.length;
    cache.delete(oldest);
  }
  cache.set(key, rows);
}

export function calendarProjectionPadding(items: UniversalItem[]) {
  const desired = items.reduce((maximum, item) => item.role !== 'series_template' ? maximum : Math.max(maximum, effectiveItemDurationMs(item), Math.max(0, Date.parse(item.schedule?.dueAt ?? '') - Date.parse(item.schedule?.startAt ?? '')) || 0), 86_400_000);
  return { desired, padding: Math.min(desired, 366 * 86_400_000) };
}

/** Per-mounted-calendar cache. Inputs must be immutable workspace snapshots. */
export function createCalendarProjectionCache() {
  let previous: WorkspaceDocument | undefined;
  let mapped: WorkspaceDocument | undefined;
  let scheduleSignature = '';
  const ranges = new Map<string, ProjectedOccurrence[]>();
  const groups = new Map<string, { signature: string; workspace: WorkspaceDocument; ranges: Map<string, ProjectedOccurrence[]> }>();
  const counters = { mappings: 0, projections: 0, groupProjections: 0 };
  const sources = new Map<string, { signature: string; item: UniversalItem }>();
  const workspaceFor = (workspace: WorkspaceDocument) => {
    if (previous === workspace) { recordProfileCache('calendar.mapping', true, 'unchanged'); return mapped!; }
    const finish = beginProfileSpan('calendar.map');
    const nextScheduleSignature = JSON.stringify([
      workspace.workspaceId,
      workspace.calendarPreferences.timezone,
      workspace.tombstones,
      Object.values(workspace.items).map(item => ({
        id: item.id,
        role: item.role,
        state: item.state,
        schedule: item.schedule,
        recurrence: item.recurrence,
        occurrence: item.occurrence,
        external: item.external ? { transparency: item.external.transparency } : undefined,
      })),
    ]);
    // Rebuild the lightweight source map so edited titles are visible, while
    // keeping expensive recurrence projections when only card content changed.
    const visible = recurrenceDisplayItems(workspace);
    const liveIds = new Set(visible.map(item => item.id));
    for (const id of sources.keys()) if (!liveIds.has(id)) sources.delete(id);
    mapped = { ...workspace, items: Object.fromEntries(visible.map(source => {
      const item = googleCalendarProjection(source);
      const signature = JSON.stringify(item);
      const prior = sources.get(item.id);
      if (prior?.signature === signature) return [item.id, prior.item];
      sources.set(item.id, { signature, item });
      return [item.id, item];
    })) };
    recordProfileCache('calendar.mapping', false, !previous ? 'empty' : nextScheduleSignature !== scheduleSignature ? 'schedule-signature' : 'content-only', visible.length);
    // Projection rows also contain title/content. Refresh changed groups even
    // when their schedules match; unchanged series retain their range caches.
    {
      ranges.clear();
      if (!previous || nextScheduleSignature !== scheduleSignature) counters.mappings++;
      const roots = new Set(Object.values(mapped.items).filter(item => item.role === 'series_template' && !item.occurrence && item.recurrence).map(item => item.id));
      const buckets = new Map<string, WorkspaceDocument['items']>();
      for (const item of Object.values(mapped.items)) {
        const root = roots.has(item.id) ? item.id : item.occurrence && roots.has(item.occurrence.seriesId) ? item.occurrence.seriesId : '';
        // Partition only; projectOccurrences still decides actual visibility,
        // including overnight spans, timezone conversion and overdue items.
        // Moving an item rebuilds its old/new bucket, not every standalone.
        const anchor = item.schedule?.startAt ?? item.schedule?.dueAt ?? item.schedule?.plannedDate ?? item.schedule?.availableFrom;
        const key = root ? `series:${root}` : `standalone:${anchor?.slice(0, 10) ?? 'undated'}`;
        const bucket = buckets.get(key) ?? {}; bucket[item.id] = item; buckets.set(key, bucket);
      }
      for (const key of groups.keys()) if (!buckets.has(key)) groups.delete(key);
      for (const [key, items] of buckets) {
        const groupSignature = JSON.stringify([items, workspace.tombstones, workspace.calendarPreferences.timezone]);
        if (groups.get(key)?.signature !== groupSignature) groups.set(key, { signature: groupSignature, workspace: { ...mapped, items }, ranges: new Map() });
      }
    }
    previous = workspace; scheduleSignature = nextScheduleSignature;
    finish({ scanned: visible.length, recalculated: visible.length });
    return mapped;
  };
  const project = (workspace: WorkspaceDocument, start: Date, end: Date) => {
    const finish = beginProfileSpan('calendar.project');
    workspaceFor(workspace);
    const key = `${start.getTime()}:${end.getTime()}`;
    let rows = ranges.get(key);
    if (!rows) {
      recordProfileCache('calendar.range', false, 'range-not-cached');
      rows = [];
      for (const group of groups.values()) {
        let projected = group.ranges.get(key);
        if (!projected) {
          projected = measureProfile('calendar.group-project', () => projectOccurrences(group.workspace, start, end), value => ({ rows: value.length }));
          recordProfileCache('calendar.group', false, 'range-not-cached', projected.length);
          cacheRange(group.ranges, key, projected); counters.groupProjections++;
        } else recordProfileCache('calendar.group', true, 'unchanged');
        rows.push(...projected);
      }
      const at = (row: ProjectedOccurrence) => Date.parse(row.schedule.startAt ?? row.schedule.dueAt ?? '');
      rows.sort((a, b) => at(a) - at(b) || a.id.localeCompare(b.id));
      cacheRange(ranges, key, rows); counters.projections++;
    } else recordProfileCache('calendar.range', true, 'unchanged');
    finish({ rows: rows.length });
    return rows;
  };
  return { workspaceFor, project, counters };
}
export type CalendarProjectionCache = ReturnType<typeof createCalendarProjectionCache>;
