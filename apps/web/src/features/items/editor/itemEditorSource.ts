import type { UniversalItem, WorkspaceDocument } from '@utm/core';

/** Resolve an occurrence to the source series when recurrence settings are edited. */
export function itemEditorSource(workspace: WorkspaceDocument | undefined, item: UniversalItem): UniversalItem {
  const seriesId = item.role === 'occurrence' ? item.occurrence?.seriesId : undefined;
  return seriesId && workspace?.items[seriesId] ? workspace.items[seriesId]! : item;
}

