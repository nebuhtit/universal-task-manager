import type { UniversalItem, WorkspaceDocument } from '@utm/core';

/** Only completion-anchored series need an explicit completion timestamp before ticking. */
export function usesCompletionAnchoredRecurrence(workspace: WorkspaceDocument, item: UniversalItem): boolean {
  const series = item.occurrence?.seriesId ? workspace.items[item.occurrence.seriesId] : item;
  return series?.recurrence?.anchor === 'completion';
}
