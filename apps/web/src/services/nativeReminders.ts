import { itemDeletionTime, reminderTime, type UniversalItem, type WorkspaceDocument } from '@utm/core';

export interface NativeReminderEntry {
  id: string;
  itemId: string;
  title: string;
  body: string;
  at: string;
  delivery?: 'notification' | 'alarm';
}

type NativeReminderMessage =
  | { id: string; kind: 'reminders.requestPermission' }
  | { id: string; kind: 'reminders.sync'; workspaceId: string; items: NativeReminderEntry[]; retainedAlarmIds: string[] }
  | { id: string; kind: 'timer.schedule'; timerId: string; title: string; at: string }
  | { id: string; kind: 'timer.cancel'; timerId: string };

type NativeReminderStatus = { id: string; ok: boolean; authorization?: string; scheduled?: number; error?: string };
const handlerName = 'utmNativeReminders';
const maximumPendingReminders = 60;
const pending = new Map<string, { resolve: (status: NativeReminderStatus) => void; reject: (reason: Error) => void }>();
let listening = false;

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

function send(message: NativeReminderMessage): Promise<NativeReminderStatus> {
  const target = handler();
  if (!target) return Promise.reject(new Error('Native reminders are available only in the Universal iOS app'));
  setupListener();
  const completion = new Promise<NativeReminderStatus>((resolve, reject) => pending.set(message.id, { resolve, reject }));
  target.postMessage(message);
  return completion;
}

export const isNativeReminderAvailable = () => Boolean(handler());

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
  const nowTime = now.getTime();
  return Object.values(workspace.items).flatMap((item) => {
    if (itemDeletionTime(workspace, item) || item.state !== 'open' || item.role === 'series_template') return [];
    const availableAt = item.schedule?.availableFrom ? Date.parse(item.schedule.availableFrom) : Number.NEGATIVE_INFINITY;
    return (item.reminders ?? []).flatMap((reminder) => {
      const resolvedAt = reminderTime(item, reminder);
      if (!resolvedAt) return [];
      const resolvedTime = Date.parse(resolvedAt);
      const deliveryTime = Math.max(resolvedTime, Number.isFinite(availableAt) ? availableAt : Number.NEGATIVE_INFINITY);
      if (!Number.isFinite(deliveryTime) || deliveryTime <= nowTime) return [];
      return [{
        id: `utm:${workspace.workspaceId}:${item.id}:${reminder.id}`,
        itemId: item.id,
        title: item.title || 'Universal reminder',
        body: notificationItemMomentBody(workspace, item, now),
        at: new Date(deliveryTime).toISOString(),
        ...(reminder.delivery ? { delivery: reminder.delivery } : {}),
      } satisfies NativeReminderEntry];
    });
  }).sort((left, right) => Date.parse(left.at) - Date.parse(right.at)).slice(0, maximumPendingReminders);
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
  return send({ id: requestId(), kind: 'reminders.sync', workspaceId: workspace.workspaceId, items, retainedAlarmIds });
}

export function scheduleNativeTimer(timerId: string, title: string, at: string): Promise<NativeReminderStatus> {
  return send({ id: requestId(), kind: 'timer.schedule', timerId, title, at });
}

export function cancelNativeTimer(timerId: string): Promise<NativeReminderStatus> {
  return send({ id: requestId(), kind: 'timer.cancel', timerId });
}
