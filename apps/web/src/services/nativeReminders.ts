import { createOccurrence, itemDeletionTime, projectOccurrences, reminderTime, type UniversalItem, type WorkspaceDocument } from '@utm/core';
import { measureProfile } from './performanceProfile';
import { auditDav } from './webdavDiagnostics';

export interface NativeReminderEntry {
  id: string;
  itemId: string;
  title: string;
  body: string;
  at: string;
  delivery?: 'notification' | 'alarm';
}

type NativeReminderMessage =
  | { id: string; kind: 'reminders.status' }
  | { id: string; kind: 'reminders.requestPermission' }
  | { id: string; kind: 'reminders.sync'; workspaceId: string; items: NativeReminderEntry[]; retainedAlarmIds: string[] }
  | { id: string; kind: 'timer.schedule'; timerId: string; title: string; at: string }
  | { id: string; kind: 'timer.cancel'; timerId: string };

type NativeReminderStatus = { id: string; ok: boolean; authorization?: string; scheduled?: number; pendingIds?: string[]; error?: string };
const handlerName = 'utmNativeReminders';
const maximumPendingReminders = 60;
const pending = new Map<string, { resolve: (status: NativeReminderStatus) => void; reject: (reason: Error) => void }>();
let listening = false;
let nativeSyncQueue: Promise<unknown> = Promise.resolve();

const handler = () => {
  const webkit = window.webkit as { messageHandlers?: Record<string, { postMessage(message: unknown): void }> } | undefined;
  return webkit?.messageHandlers?.[handlerName];
};
const requestId = () => `reminders-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function setupListener() {
  if (listening) return;
  listening = true;
  window.addEventListener('utm-native-reminders-status', ((event: CustomEvent<NativeReminderStatus>) => {
    const status = event.detail;
    const request = status && pending.get(status.id);
    if (!request) return;
    pending.delete(status.id);
    if (status.ok) request.resolve(status);
    else request.reject(new Error(status.error || 'Native reminder operation failed'));
  }) as EventListener);
}

function send(message: NativeReminderMessage, timeoutMs = 30_000): Promise<NativeReminderStatus> {
  const target = handler();
  if (!target) return Promise.reject(new Error('Native reminders are available only in the Universal iOS app'));
  setupListener();
  auditDav('reminders-native-request', { requestId: message.id, kind: message.kind });
  const completion = new Promise<NativeReminderStatus>((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(message.id); auditDav('reminders-native-timeout', { requestId: message.id, kind: message.kind }); reject(new Error('Native reminder status timed out')); }, timeoutMs);
    pending.set(message.id, { resolve: status => { clearTimeout(timeout); auditDav('reminders-native-confirmed', { requestId: message.id, kind: message.kind, authorization: status.authorization, scheduled: status.scheduled, pendingIds: status.pendingIds }); resolve(status); }, reject: reason => { clearTimeout(timeout); auditDav('reminders-native-failed', { requestId: message.id, kind: message.kind }); reject(reason); } });
    try { target.postMessage(message); }
    catch (reason) { pending.get(message.id)?.reject(reason instanceof Error ? reason : new Error('Native reminder operation failed')); pending.delete(message.id); }
  });
  return completion;
}

export const isNativeReminderAvailable = () => Boolean(handler());
export const nativeReminderPermissionStatus = () => send({ id: requestId(), kind: 'reminders.status' }, 5_000);

export function notificationItemMomentBody(workspace: WorkspaceDocument, item: UniversalItem, now: Date, suffix = ''): string {
  const locale = workspace.calendarPreferences.language === 'ru' ? 'ru-RU' : 'en-GB';
  const zone = workspace.calendarPreferences.timezone;
  const dateKey = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const value = item.schedule?.startAt ?? item.schedule?.dueAt;
  if (!value) return `Reminder${suffix}`;
  const date = new Date(value);
  const moment = new Intl.DateTimeFormat(locale, dateKey(date) === dateKey(now)
    ? { timeZone: zone, hour: '2-digit', minute: '2-digit' }
    : { timeZone: zone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
  return `${item.schedule?.startAt ? 'Event opens' : 'Due'} · ${moment}${suffix}`;
}

export function nativeReminderSchedule(workspace: WorkspaceDocument, now = new Date()): NativeReminderEntry[] {
  return measureProfile('reminders.prepare', () => prepareReminderSchedule(workspace, now), value => ({ rows: value.length }));
}

export function reminderCandidates(workspace: WorkspaceDocument, now: Date): UniversalItem[] {
  const items = new Map(Object.values(workspace.items).map(item => [item.id, item]));
  const known = new Set(Object.values(workspace.items).filter(item => item.occurrence).map(item => `${item.occurrence!.seriesId}:${item.occurrence!.recurrenceId}`));
  let projected: ReturnType<typeof projectOccurrences> = [];
  try { projected = projectOccurrences(workspace, new Date(now.getTime() - 86_400_000), new Date(now.getTime() + 45 * 86_400_000)); }
  catch { auditDav('reminders-projection-failed'); }
  for (const row of projected) {
    if (!row.virtual || !row.seriesId || !row.recurrenceId || known.has(`${row.seriesId}:${row.recurrenceId}`)) continue;
    const series = workspace.items[row.sourceItemId];
    if (series?.state !== 'open') continue;
    const item = createOccurrence(series, new Date(row.recurrenceId), 0);
    items.set(item.id, item);
  }
  return [...items.values()];
}

export function reminderDeliveryTime(item: UniversalItem, at: string): number {
  // Activation controls list visibility, not advance reminders for a cycle.
  const available = !item.occurrence && item.schedule?.availableFrom ? Date.parse(item.schedule.availableFrom) : Number.NEGATIVE_INFINITY;
  return Math.max(Date.parse(at), Number.isFinite(available) ? available : Number.NEGATIVE_INFINITY);
}

function prepareReminderSchedule(workspace: WorkspaceDocument, now: Date): NativeReminderEntry[] {
  const nowTime = now.getTime();
  const skipped: object[] = [];
  const entries = reminderCandidates(workspace, now).flatMap((item) => {
    if (itemDeletionTime(workspace, item) || item.state !== 'open' || item.role === 'series_template') {
      if (item.reminders.length) skipped.push({ itemId: item.id, reason: itemDeletionTime(workspace, item) ? 'deleted' : item.role === 'series_template' ? 'template' : 'closed' });
      return [];
    }
    return (item.reminders ?? []).flatMap((reminder) => {
      const resolvedAt = reminderTime(item, reminder);
      if (!resolvedAt) { skipped.push({ itemId: item.id, reminderId: reminder.id, reason: reminder.acknowledgedAt ? 'acknowledged' : 'unresolved' }); return []; }
      const deliveryTime = reminderDeliveryTime(item, resolvedAt);
      if (!Number.isFinite(deliveryTime) || deliveryTime <= nowTime) { skipped.push({ itemId: item.id, reminderId: reminder.id, at: resolvedAt, reason: 'past-or-invalid' }); return []; }
      return [{
        id: `utm:${workspace.workspaceId}:${item.id}:${reminder.id}`,
        itemId: item.id,
        title: item.title || 'Universal reminder',
        body: notificationItemMomentBody(workspace, item, now),
        at: new Date(deliveryTime).toISOString(),
        ...(reminder.delivery ? { delivery: reminder.delivery } : {}),
      } satisfies NativeReminderEntry];
    });
  }).sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  const selected = entries.slice(0, maximumPendingReminders);
  auditDav('reminders-plan', { now: now.toISOString(), candidates: entries.length, truncated: entries.length - selected.length, selected: selected.map(({ id, itemId, at, delivery }) => ({ id, itemId, at, delivery })), skipped });
  return selected;
}

export function requestNativeReminderPermission(): Promise<NativeReminderStatus> {
  return send({ id: requestId(), kind: 'reminders.requestPermission' });
}

export function syncNativeReminders(workspace: WorkspaceDocument, now = new Date()): Promise<NativeReminderStatus> {
  const items = nativeReminderSchedule(workspace, now);
  const retainedAlarmIds = Object.values(workspace.items).filter(item => !itemDeletionTime(workspace, item) && item.state === 'open' && item.role !== 'series_template').flatMap(item => item.reminders.filter(reminder => {
    const at = reminderTime(item, reminder);
    return reminder.delivery === 'alarm' && at && Date.parse(at) <= now.getTime();
  }).map(reminder => `utm:${workspace.workspaceId}:${item.id}:${reminder.id}`));
  retainedAlarmIds.push(...items.filter(item => item.delivery === 'alarm').map(item => item.id));
  const request = nativeSyncQueue.catch(() => undefined).then(() => send({ id: requestId(), kind: 'reminders.sync', workspaceId: workspace.workspaceId, items, retainedAlarmIds }));
  nativeSyncQueue = request.then(() => undefined, () => undefined);
  return request;
}

export function scheduleNativeTimer(timerId: string, title: string, at: string): Promise<NativeReminderStatus> {
  return send({ id: requestId(), kind: 'timer.schedule', timerId, title, at });
}

export function cancelNativeTimer(timerId: string): Promise<NativeReminderStatus> {
  return send({ id: requestId(), kind: 'timer.cancel', timerId });
}
