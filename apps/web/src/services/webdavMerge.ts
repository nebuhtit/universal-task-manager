import { workspaceForExport, type WorkspaceDocument } from '@utm/core';

export type SyncSnapshot = Record<string, unknown>;
export type SyncConflict = { path: string; local: unknown; remote: unknown };
const fields = ['items', 'tombstones', 'views', 'viewOrder', 'listDefinitions', 'areaDefinitions', 'projectDefinitions', 'organizationPreferences', 'customFields', 'dashboards', 'automations'] as const;
export function syncSnapshot(workspace: WorkspaceDocument): SyncSnapshot {
  const safe = workspaceForExport(JSON.parse(JSON.stringify(workspace)) as WorkspaceDocument);
  // Remote transfer must not enqueue a second device's Google outbox. Each
  // device signs in to its own calendar; the Google sync implementation stays local.
  for (const item of Object.values(safe.items)) if (item.extensions) for (const key of Object.keys(item.extensions)) if (/^utm:google/.test(key)) delete item.extensions[key];
  return Object.fromEntries(fields.map(field => [field, safe[field]]));
}
export const syncEqual = (a: unknown, b: unknown): boolean => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const same = syncEqual;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  return object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export function mergeSync(base: SyncSnapshot, local: SyncSnapshot, remote: SyncSnapshot, resolution?: 'local' | 'remote'): { snapshot: SyncSnapshot; conflicts: SyncConflict[] } {
  const conflicts: SyncConflict[] = [];
  function merge(b: unknown, l: unknown, r: unknown, path: string[]): unknown {
    if (same(l, r)) return l;
    if (same(l, b)) return r;
    if (same(r, b)) return l;
    if (['updatedAt', 'revision'].includes(path.at(-1) ?? '')) {
      if (typeof l === 'number' && typeof r === 'number') return Math.max(l, r);
      if (typeof l === 'string' && typeof r === 'string') return l > r ? l : r;
    }
    if (object(l) && object(r) && (object(b) || b === undefined)) {
      const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const key of new Set([...Object.keys(object(b) ? b : {}), ...Object.keys(l), ...Object.keys(r)])) {
        const value = merge(object(b) ? b[key] : undefined, l[key], r[key], [...path, key]);
        if (value !== undefined) result[key] = value;
      }
      return result;
    }
    conflicts.push({ path: path.join('.'), local: l, remote: r });
    return resolution === 'remote' ? r : l;
  }
  const snapshot = structuredClone(merge(base, local, remote, [])) as SyncSnapshot;
  // Tombstones travel independently of deleted records. Never resurrect a
  // record deleted remotely unless a newer explicit edit is preserved as conflict.
  const items = snapshot.items as WorkspaceDocument['items'];
  const tombstones = snapshot.tombstones as WorkspaceDocument['tombstones'];
  if (items && tombstones) for (const [id, at] of Object.entries(tombstones)) {
    if (!items[id]) continue;
    const before = (base.items as WorkspaceDocument['items'] | undefined)?.[id];
    const left = (local.items as WorkspaceDocument['items'] | undefined)?.[id];
    const right = (remote.items as WorkspaceDocument['items'] | undefined)?.[id];
    const leftDeleted = (local.tombstones as Record<string, string> | undefined)?.[id];
    const rightDeleted = (remote.tombstones as Record<string, string> | undefined)?.[id];
    const concurrentDelete = (!left && leftDeleted && right && !same(right, before)) || (!right && rightDeleted && left && !same(left, before));
    if (concurrentDelete) {
      const path = `items.${id}`;
      if (!conflicts.some(conflict => conflict.path === path)) conflicts.push({ path, local: left, remote: right });
      const chosen = resolution === 'remote' ? right : left;
      if (chosen) { items[id] = structuredClone(chosen); delete tombstones[id]; }
      else delete items[id];
    } else if (items[id]!.updatedAt <= at) delete items[id];
  }
  return { snapshot: structuredClone(snapshot), conflicts };
}
export function applySyncSnapshot(draft: WorkspaceDocument, snapshot: SyncSnapshot): void {
  const previous = syncSnapshot(draft);
  const sharedItems = previous.items as WorkspaceDocument['items'];
  const shared = new Set(Object.keys(sharedItems));
  const incoming = snapshot.items as WorkspaceDocument['items'];
  for (const id of shared) if (!incoming[id]) delete draft.items[id];
  for (const [id, value] of Object.entries(incoming)) {
    if (same(sharedItems[id], value)) continue;
    const existing = draft.items[id];
    const item = structuredClone(value);
    // Preserve device-owned Google linkage/outbox on a user's own local item.
    if (existing?.external?.readOnly === false) item.external = JSON.parse(JSON.stringify(existing.external)) as NonNullable<typeof existing.external>;
    if (existing?.extensions) for (const [key, entry] of Object.entries(existing.extensions)) if (/^utm:google/.test(key)) { item.extensions ??= {}; item.extensions[key] = JSON.parse(JSON.stringify(entry)) as typeof entry; }
    draft.items[id] = item;
  }
  for (const field of fields) if (field !== 'items' && snapshot[field] !== undefined && !same(previous[field], snapshot[field])) (draft as unknown as Record<string, unknown>)[field] = structuredClone(snapshot[field]);
}
