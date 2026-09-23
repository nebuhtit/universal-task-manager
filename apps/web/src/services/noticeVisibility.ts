import { itemDeletionTime, type WorkspaceDocument } from '@utm/core';
import type { AppNotice } from '../components/layout/AppShell';

/** Stale in-memory notices must never outlive their item or its parent series. */
export function visibleItemNotices(workspace: WorkspaceDocument, notices: readonly AppNotice[]): AppNotice[] {
  return notices.filter((notice) => {
    if (!notice.itemId) return true;
    const item = workspace.items[notice.itemId];
    return Boolean(item && !itemDeletionTime(workspace, item));
  });
}
