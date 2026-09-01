import type { AutomationAction, SavedView, UniversalItem, WorkspaceDocument } from './types.js';

const clone = <T>(value: T): T => structuredClone(value);

export const isGoogleCalendarItem = (item: UniversalItem | undefined): boolean => item?.external?.provider === 'google_calendar';

function stripKnownItemReferences<T>(value: T, removedIds: ReadonlySet<string>): T | undefined {
  if (typeof value === 'string') return removedIds.has(value) ? undefined : value;
  if (Array.isArray(value)) return value.flatMap((entry) => {
    const safe = stripKnownItemReferences(entry, removedIds);
    return safe === undefined ? [] : [safe];
  }) as T;
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const safe = stripKnownItemReferences(entry, removedIds);
    if (safe !== undefined) result[key] = safe;
  }
  return result as T;
}

function sanitizeView(view: SavedView, removedIds: ReadonlySet<string>): SavedView {
  const safe = clone(view);
  if (safe.statistics) {
    const reservedItemIds = Array.isArray(safe.statistics.reservedItemIds) ? safe.statistics.reservedItemIds : [];
    safe.statistics.reservedItemIds = reservedItemIds.filter((id) => !removedIds.has(id));
  }
  if (safe.creationDefaults) safe.creationDefaults = stripKnownItemReferences(safe.creationDefaults, removedIds) ?? {};
  if (safe.extensions) safe.extensions = stripKnownItemReferences(safe.extensions, removedIds) ?? {};
  return safe;
}

function actionReferencesRemovedItem(action: AutomationAction, removedIds: ReadonlySet<string>): boolean {
  return action.type === 'add_relation' && removedIds.has(action.targetId);
}

/**
 * Creates a snapshot safe to place in any exported file. Google Calendar is a
 * local read-only cache, so its events and connection metadata are regenerated
 * by a later sign-in instead of travelling with UTM data.
 */
export function workspaceForExport(workspace: WorkspaceDocument): WorkspaceDocument {
  const safe = clone(workspace);
  // This runs while an encrypted workspace is still locked, before normal
  // schema migration can repair legacy/partial arrays. Keep recovery export
  // generation tolerant so an old workspace can always reach migration.
  safe.items = safe.items && typeof safe.items === 'object' && !Array.isArray(safe.items) ? safe.items : {};
  safe.views = safe.views && typeof safe.views === 'object' && !Array.isArray(safe.views) ? safe.views : {};
  safe.tombstones = safe.tombstones && typeof safe.tombstones === 'object' && !Array.isArray(safe.tombstones) ? safe.tombstones : {};
  safe.automations = safe.automations && typeof safe.automations === 'object' && !Array.isArray(safe.automations) ? safe.automations : {};
  const removedIds = new Set(Object.entries(safe.items)
    .filter(([id, item]) => id.startsWith('google:') || isGoogleCalendarItem(item) || JSON.stringify(item.extensions ?? {}).includes('google_calendar'))
    .map(([id]) => id));
  // Interrupted syncs can leave only a tombstone. Google-generated item IDs
  // use this reserved prefix, which must not leak a calendar or event ID.
  for (const id of Object.keys(safe.tombstones)) if (id.startsWith('google:')) removedIds.add(id);

  let foundDependent = true;
  while (foundDependent) {
    foundDependent = false;
    for (const [id, item] of Object.entries(safe.items)) {
      if (!removedIds.has(id) && item.occurrence && removedIds.has(item.occurrence.seriesId)) {
        removedIds.add(id);
        foundDependent = true;
      }
    }
  }
  for (const id of removedIds) {
    delete safe.items[id];
    delete safe.tombstones[id];
  }
  for (const item of Object.values(safe.items)) {
    item.relations = (Array.isArray(item.relations) ? item.relations : []).filter((relation) => !removedIds.has(relation.targetId));
    item.custom = stripKnownItemReferences(item.custom, removedIds) ?? {};
    if (item.extensions) item.extensions = stripKnownItemReferences(item.extensions, removedIds) ?? {};
  }
  for (const [id, view] of Object.entries(safe.views)) safe.views[id] = sanitizeView(view, removedIds);
  for (const rule of Object.values(safe.automations)) rule.actions = (Array.isArray(rule.actions) ? rule.actions : []).filter((action) => !actionReferencesRemovedItem(action, removedIds));
  safe.automationLog = (Array.isArray(safe.automationLog) ? safe.automationLog : []).filter((entry) => !entry.itemId || !removedIds.has(entry.itemId));
  safe.migrationIssues = (Array.isArray(safe.migrationIssues) ? safe.migrationIssues : []).filter((issue) => !removedIds.has(issue.entityId));
  delete safe.calendarPreferences.googleCalendar;
  return safe;
}

export function itemsForExport(workspace: WorkspaceDocument, items: UniversalItem[]): UniversalItem[] {
  const staged = clone(workspace);
  for (const item of items) staged.items[item.id] = clone(item);
  const safe = workspaceForExport(staged);
  return items.flatMap((item) => safe.items[item.id] ? [clone(safe.items[item.id]!)] : []);
}

export function viewsForExport(workspace: WorkspaceDocument, views: SavedView[]): SavedView[] {
  const staged = clone(workspace);
  for (const view of views) staged.views[view.id] = clone(view);
  const safe = workspaceForExport(staged);
  return views.flatMap((view) => safe.views[view.id] ? [clone(safe.views[view.id]!)] : []);
}
