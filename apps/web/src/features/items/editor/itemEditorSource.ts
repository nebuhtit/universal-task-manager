import { itemDeletionTime, type UniversalItem, type WorkspaceDocument } from '@utm/core';

/** Resolve an occurrence to the source series when recurrence settings are edited. */
export function itemEditorSource(workspace: WorkspaceDocument | undefined, item: UniversalItem): UniversalItem {
  if (item.external?.readOnly === false || (item.role === 'occurrence' && item.schedule?.plannedDate)) return workspace?.items[item.id] ?? item;
  const seriesId = item.role === 'occurrence' ? item.occurrence?.seriesId : undefined;
  const series = seriesId ? workspace?.items[seriesId] : undefined;
  return series && workspace && !itemDeletionTime(workspace, series) ? series : workspace?.items[item.id] ?? item;
}

/** Prefer an existing identity before resolving a template to its live cycle.
 * Older workspaces can contain linked templates, including nested templates.
 * Redirecting those to a child loses the link needed to queue deletion.
 */
export function googleActionItem(workspace: WorkspaceDocument, item: UniversalItem): UniversalItem {
  const saved = workspace.items[item.id] ?? item;
  const pending = saved.extensions?.['utm:googleSave'] as { kind?: string } | undefined;
  if (saved.external || pending?.kind === 'delete' || saved.role !== 'series_template') return saved;
  return Object.values(workspace.items).find((entry) => !itemDeletionTime(workspace, entry) && entry.occurrence?.seriesId === saved.id) ?? saved;
}
