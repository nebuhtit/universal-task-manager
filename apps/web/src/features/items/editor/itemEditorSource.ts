import { itemDeletionTime, type UniversalItem, type WorkspaceDocument } from '@utm/core';

/** Resolve an occurrence to the source series when recurrence settings are edited. */
export function itemEditorSource(workspace: WorkspaceDocument | undefined, item: UniversalItem): UniversalItem {
  const saved = workspace?.items[item.id];
  if (saved?.role === 'series_template' && saved.occurrence) return saved;
  const seriesId = item.role === 'occurrence' ? item.occurrence?.seriesId : undefined;
  const series = seriesId ? workspace?.items[seriesId] : undefined;
  if (series && workspace && !itemDeletionTime(workspace, series)) {
    const draft: UniversalItem = { ...series, ...item, id: series.id, role: 'series_template', ...(series.recurrence ? { recurrence: series.recurrence } : {}) };
    delete draft.occurrence;
    // The editor must show the selected cycle's dates, not the master's start.
    if (draft.external) { draft.external = { ...draft.external }; delete draft.external.startAt; delete draft.external.endAt; }
    return draft;
  }
  return workspace?.items[item.id] ?? item;
}

/** Prefer an existing identity before resolving a template to its live cycle.
 * Older workspaces can contain linked templates, including nested templates.
 * Redirecting those to a child loses the link needed to queue deletion.
 */
export function googleActionItem(workspace: WorkspaceDocument, item: UniversalItem): UniversalItem {
  const saved = workspace.items[item.id] ?? item;
  if (saved.role === 'series_template' && saved.recurrence && saved.schedule?.startAt && saved.schedule.endAt) {
    if (saved.external) return saved;
    const linked = Object.values(workspace.items).find(entry => !itemDeletionTime(workspace, entry) && entry.occurrence?.seriesId === saved.id && entry.external?.readOnly === false);
    return linked?.external ? { ...saved, external: linked.external } : saved;
  }
  const pending = saved.extensions?.['utm:googleSave'] as { kind?: string } | undefined;
  if (saved.external || pending?.kind === 'delete' || saved.role !== 'series_template') return saved;
  return Object.values(workspace.items).find((entry) => !itemDeletionTime(workspace, entry) && entry.occurrence?.seriesId === saved.id) ?? saved;
}
