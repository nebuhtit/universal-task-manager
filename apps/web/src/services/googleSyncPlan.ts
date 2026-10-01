import { applyGoogleCalendarSync, googleCalendarEventToItem, reconcileCalendarOrganization, type GoogleCalendarEvent, type WorkspaceDocument } from '@utm/core';
import type { GoogleCalendarSyncResult } from './googleCalendar';
import { syncTrace } from './syncTrace';

export interface GoogleRecovery { itemId: string; calendarId: string; event: GoogleCalendarEvent }
export interface GoogleSyncPlanInput { workspace: WorkspaceDocument; result: GoogleCalendarSyncResult; recovered: GoogleRecovery[] }
export interface GoogleSyncPatch { path: string[]; before: string | undefined; after: string | undefined }
const maps = new Set(['items', 'views', 'tombstones']);
const record = (value: unknown) => value as Record<string, unknown>;
// Automerge's immutable view and mutable draft can enumerate map keys in
// different orders after edits. Compare JSON values, not their insertion order.
const serialize = (value: unknown): string | undefined => JSON.stringify(value, (_key, entry) =>
  entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]]))
    : entry);

/** Pure calculation on a detached snapshot, never on the live Automerge draft. */
export function calculateGoogleSyncPlan({ workspace, result, recovered }: GoogleSyncPlanInput): GoogleSyncPatch[] {
  const before = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(workspace)) {
    if (maps.has(key)) for (const [id, item] of Object.entries(record(value))) before.set(JSON.stringify([key, id]), serialize(item));
    else before.set(JSON.stringify([key]), serialize(value));
  }
  const google = workspace.calendarPreferences.googleCalendar;
  if (!google) throw new Error('Google connection changed.');
  // Repair only the legacy cross-calendar receipt shape, and only with a fresh
  // full response confirming the exact destination identity. Never undo a real
  // queued deletion or match events by title/time.
  for (const item of Object.values(workspace.items)) {
    if (item.deletedAt || item.external || item.extensions?.['utm:googleSave'] || item.extensions?.['utm:itemDelete']) continue;
    const receipts = item.extensions?.['utm:googleDeletionReceipts'];
    if (!Array.isArray(receipts)) continue;
    const matches = receipts.flatMap(receipt => {
      if (receipt.accountEmail !== google.accountEmail || typeof receipt.eventId !== 'string' || typeof receipt.calendarId !== 'string') return [];
      const suffix = `:${receipt.eventId}`;
      if (!item.id.startsWith('google:') || !item.id.endsWith(suffix)) return [];
      const sourceCalendar = item.id.slice(7, -suffix.length);
      if (sourceCalendar === encodeURIComponent(receipt.calendarId)) return [];
      const batch = result.batches.find(batch => batch.fullSync && batch.calendarId === receipt.calendarId);
      const event = batch?.events.find(event => event.id === receipt.eventId && event.status !== 'cancelled');
      return event ? [{ receipt, event }] : [];
    });
    if (matches.length !== 1) continue;
    const { receipt, event } = matches[0]!;
    const mirror = googleCalendarEventToItem(event, receipt.calendarId, google.connectionId, result.syncedAt);
    if (!mirror?.external) continue;
    item.external = { ...mirror.external, readOnly: false };
    item.extensions!['utm:googleDeletionReceipts'] = receipts.filter(entry => entry !== receipt);
    delete workspace.tombstones[item.id];
  }
  for (const recovery of recovered) {
    if (recovered.filter(entry => entry.itemId === recovery.itemId).length !== 1) continue;
    const target = workspace.items[recovery.itemId];
    if (!target || target.deletedAt || target.external || target.extensions?.['utm:googleSave']) continue;
    const mirror = googleCalendarEventToItem(recovery.event, recovery.calendarId, google.connectionId, result.syncedAt);
    if (!mirror?.external) continue;
    target.external = { ...mirror.external, readOnly: false };
    target.extensions ??= {};
    target.extensions['utm:googleSeriesEvent'] = recovery.event;
    target.extensions['utm:googleCreate'] = { calendarId: recovery.calendarId, eventId: recovery.event.id, accountEmail: google.accountEmail ?? '' };
    applyGoogleCalendarSync(workspace, { connectionId: google.connectionId, calendarId: recovery.calendarId, events: [recovery.event], syncedAt: result.syncedAt, fullSync: false });
  }
  for (const batch of result.batches) applyGoogleCalendarSync(workspace, batch);
  if (result.calendars.filter(calendar => calendar.selected).every(calendar => result.batches.some(batch => batch.calendarId === calendar.id && batch.fullSync))) google.moveMirrorRepairVersion = 1;
  workspace.calendarPreferences.googleCalendar = { ...google, calendars: result.calendars, syncTokens: result.syncTokens, syncWindow: result.syncWindow, lastSyncedAt: result.syncedAt, ...(result.accountEmail ? { accountEmail: result.accountEmail } : {}) };
  delete workspace.calendarPreferences.googleCalendar.lastError;
  reconcileCalendarOrganization(workspace);
  const after = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(workspace)) {
    if (maps.has(key)) for (const [id, item] of Object.entries(record(value))) after.set(JSON.stringify([key, id]), serialize(item));
    else after.set(JSON.stringify([key]), serialize(value));
  }
  return [...new Set([...before.keys(), ...after.keys()])].flatMap(path => before.get(path) === after.get(path) ? [] : [{ path: JSON.parse(path), before: before.get(path), after: after.get(path) }]);
}

/** Check every precondition before making any change, including sync tokens. */
export function applyGoogleSyncPlan(workspace: WorkspaceDocument, patches: GoogleSyncPatch[]): void {
  syncTrace('patch-check-start', { patches: patches.length });
  const parent = (path: string[]) => path.length === 2 ? record(record(workspace)[path[0]!]) : record(workspace);
  for (const patch of patches) if (serialize(parent(patch.path)[patch.path.at(-1)!]) !== patch.before) throw new Error('Workspace changed during Google sync. Your changes are safe; retry Sync.');
  syncTrace('patch-check-end');
  syncTrace('patch-write-start');
  let processed = 0;
  for (const patch of patches) {
    const target = parent(patch.path), key = patch.path.at(-1)!;
    if (patch.after === undefined) delete target[key]; else target[key] = JSON.parse(patch.after);
    if (++processed % 100 === 0) syncTrace('patch-write-progress', { processed });
  }
  syncTrace('patch-write-end', { processed });
}
