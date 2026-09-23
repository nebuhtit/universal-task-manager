import type { UniversalItem, WorkspaceDocument } from './types.js';
import { itemDeletionTime } from './item-deletion.js';

/** Collapse legacy nested copies of one cycle for display, without deleting history.
 * IDs remain the IDs of the winning stored items so edits target the same record.
 */
export function recurrenceDisplayItems(workspace: WorkspaceDocument): UniversalItem[] {
  const rows = new Map<string, UniversalItem>();
  for (const item of Object.values(workspace.items)) {
    if (itemDeletionTime(workspace, item)) continue;
    let parent = item;
    const seen = new Set([item.id]);
    while (parent.occurrence && parent.recurrenceOverride?.kind !== 'future_split') {
      const next = workspace.items[parent.occurrence.seriesId];
      if (!next || seen.has(next.id)) break;
      seen.add(next.id); parent = next;
    }
    const nested = Boolean(item.occurrence && parent.id !== item.id);
    const key = nested ? `cycle:${parent.id}:${item.occurrence!.recurrenceId}` : `item:${item.id}`;
    const row: UniversalItem = nested ? { ...item, role: 'occurrence', occurrence: { ...item.occurrence!, seriesId: parent.id } } : item;
    const prior = rows.get(key);
    // A finished copy must not be resurrected by another open legacy copy.
    const rank = (value: UniversalItem) => value.state === 'open' ? 0 : 1;
    if (!prior || rank(row) > rank(prior) || (rank(row) === rank(prior) && (row.updatedAt > prior.updatedAt || (row.updatedAt === prior.updatedAt && row.id < prior.id)))) rows.set(key, row);
  }
  return [...rows.values()];
}
