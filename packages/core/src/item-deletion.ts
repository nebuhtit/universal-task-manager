import type { UniversalItem, WorkspaceDocument } from './types.js';

/** A deleted recurrence owner also hides its cycles, including legacy nested series. */
export function itemDeletionTime(workspace: WorkspaceDocument, item: UniversalItem): string | undefined {
  const seen = new Set<string>();
  let current: UniversalItem | undefined = item;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    const deleted = current.deletedAt ?? workspace.tombstones[current.id];
    if (deleted) return deleted;
    if (current.recurrenceOverride?.kind === 'future_split') return undefined;
    const parentId: string | undefined = current.occurrence?.seriesId;
    if (!parentId) return undefined;
    if (workspace.tombstones[parentId]) return workspace.tombstones[parentId];
    current = workspace.items[parentId];
  }
  return undefined;
}

export function itemDeletionIds(workspace: WorkspaceDocument, id: string): string[] {
  const selected = new Set([id]);
  if (workspace.items[id]?.role !== 'series_template') return [...selected];
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of Object.values(workspace.items)) {
      if (item.occurrence && item.recurrenceOverride?.kind !== 'future_split' && selected.has(item.occurrence.seriesId) && !selected.has(item.id)) {
        selected.add(item.id); changed = true;
      }
    }
  }
  return [...selected];
}

export function softDeleteItemTree(workspace: WorkspaceDocument, id: string, at: string): void {
  for (const key of itemDeletionIds(workspace, id)) {
    const item = workspace.items[key];
    if (!item || item.deletedAt) continue;
    item.deletedAt = at;
    workspace.tombstones[key] = at;
  }
}

export function restoreItemTree(workspace: WorkspaceDocument, id: string): void {
  const at = workspace.items[id]?.deletedAt ?? workspace.tombstones[id];
  for (const key of itemDeletionIds(workspace, id)) {
    const item = workspace.items[key];
    if (!item || (key !== id && item.deletedAt !== at)) continue;
    delete item.deletedAt; delete workspace.tombstones[key];
  }
}
