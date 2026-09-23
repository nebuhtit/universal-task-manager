import { effectiveItemDurationMs, googleCalendarProjection, projectOccurrences, recurrenceDisplayItems, type ProjectedOccurrence, type UniversalItem, type WorkspaceDocument } from '@utm/core';

export function calendarProjectionPadding(items: UniversalItem[]) {
  const desired = items.reduce((maximum, item) => item.role !== 'series_template' ? maximum : Math.max(maximum, effectiveItemDurationMs(item), Math.max(0, Date.parse(item.schedule?.dueAt ?? '') - Date.parse(item.schedule?.startAt ?? '')) || 0), 86_400_000);
  return { desired, padding: Math.min(desired, 366 * 86_400_000) };
}

/** Per-mounted-calendar cache. Inputs must be immutable workspace snapshots. */
export function createCalendarProjectionCache() {
  let previous: WorkspaceDocument | undefined;
  let mapped: WorkspaceDocument | undefined;
  let signature = '';
  const ranges = new Map<string, ProjectedOccurrence[]>();
  const groups = new Map<string, { signature: string; workspace: WorkspaceDocument; ranges: Map<string, ProjectedOccurrence[]> }>();
  const counters = { mappings: 0, projections: 0, groupProjections: 0 };
  const workspaceFor = (workspace: WorkspaceDocument) => {
    if (previous === workspace) return mapped!;
    const next = JSON.stringify([workspace.workspaceId, workspace.items, workspace.tombstones, workspace.calendarPreferences.timezone]);
    if (!mapped || next !== signature) {
      mapped = { ...workspace, items: Object.fromEntries(recurrenceDisplayItems(workspace).map(item => [item.id, googleCalendarProjection(item)])) };
      ranges.clear(); counters.mappings++;
      const roots = new Set(Object.values(mapped.items).filter(item => item.role === 'series_template' && !item.occurrence && item.recurrence).map(item => item.id));
      const buckets = new Map<string, WorkspaceDocument['items']>();
      for (const item of Object.values(mapped.items)) {
        const root = roots.has(item.id) ? item.id : item.occurrence && roots.has(item.occurrence.seriesId) ? item.occurrence.seriesId : '';
        const key = root ? `series:${root}` : 'standalone';
        const bucket = buckets.get(key) ?? {}; bucket[item.id] = item; buckets.set(key, bucket);
      }
      for (const key of groups.keys()) if (!buckets.has(key)) groups.delete(key);
      for (const [key, items] of buckets) {
        const groupSignature = JSON.stringify([items, workspace.tombstones, workspace.calendarPreferences.timezone]);
        if (groups.get(key)?.signature !== groupSignature) groups.set(key, { signature: groupSignature, workspace: { ...mapped, items }, ranges: new Map() });
      }
    } else mapped = { ...workspace, items: mapped.items };
    previous = workspace; signature = next;
    return mapped;
  };
  const project = (workspace: WorkspaceDocument, start: Date, end: Date) => {
    workspaceFor(workspace);
    const key = `${start.getTime()}:${end.getTime()}`;
    let rows = ranges.get(key);
    if (!rows) {
      rows = [];
      for (const group of groups.values()) {
        let projected = group.ranges.get(key);
        if (!projected) {
          projected = projectOccurrences(group.workspace, start, end);
          if (group.ranges.size >= 4) group.ranges.delete(group.ranges.keys().next().value!);
          group.ranges.set(key, projected); counters.groupProjections++;
        }
        rows.push(...projected);
      }
      const at = (row: ProjectedOccurrence) => Date.parse(row.schedule.startAt ?? row.schedule.dueAt ?? '');
      rows.sort((a, b) => at(a) - at(b) || a.id.localeCompare(b.id));
      if (ranges.size >= 4) ranges.delete(ranges.keys().next().value!);
      ranges.set(key, rows); counters.projections++;
    }
    return rows;
  };
  return { workspaceFor, project, counters };
}
export type CalendarProjectionCache = ReturnType<typeof createCalendarProjectionCache>;
