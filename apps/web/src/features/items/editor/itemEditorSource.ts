import { itemDeletionTime, type UniversalItem, type WorkspaceDocument } from '@utm/core';

/** Resolve an occurrence to the source series when recurrence settings are edited. */
export function itemEditorSource(workspace: WorkspaceDocument | undefined, item: UniversalItem): UniversalItem {
  if (item.external?.readOnly === false || (item.role === 'occurrence' && item.schedule?.plannedDate)) return workspace?.items[item.id] ?? item;
  const seriesId = item.role === 'occurrence' ? item.occurrence?.seriesId : undefined;
  const series = seriesId ? workspace?.items[seriesId] : undefined;
  return series && workspace && !itemDeletionTime(workspace, series) ? series : workspace?.items[item.id] ?? item;
}

/** A Google event belongs to one live cycle, never the recurrence template. */
export function googleActionItem(workspace: WorkspaceDocument, item: UniversalItem): UniversalItem {
  if (item.role !== 'series_template') return workspace.items[item.id] ?? item;
  return Object.values(workspace.items).find((entry) => !entry.deletedAt && entry.occurrence?.seriesId === item.id) ?? item;
}
