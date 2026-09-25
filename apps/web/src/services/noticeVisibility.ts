import { itemDeletionTime, type WorkspaceDocument } from '@utm/core';
import type { AppNotice } from '../components/layout/AppShell';

/** Stale in-memory notices must never outlive their item or its parent series. */
export function visibleItemNotices(workspace: WorkspaceDocument, notices: readonly AppNotice[], now = Date.now()): AppNotice[] {
  return notices.filter((notice) => {
    if (!notice.itemId) return true;
    const item = workspace.items[notice.itemId];
    if (!item || itemDeletionTime(workspace, item)) return false;
    // Event-only notices expire once the event opens. A Due remains actionable when overdue.
    const start = Date.parse(item.schedule?.startAt ?? '');
    const hasEventRange = Boolean(item.schedule?.startAt && item.schedule?.endAt);
    return Boolean(item.schedule?.dueAt) || !hasEventRange || !Number.isFinite(start) || start > now;
  });
}
