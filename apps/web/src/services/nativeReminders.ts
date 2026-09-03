import { reminderTime, type WorkspaceDocument } from '@utm/core';

export interface NativeReminderEntry {
  id: string;
  itemId: string;
  title: string;
  body: string;
  at: string;
  urgency: 'normal' | 'urgent' | 'critical';
}

type NativeReminderMessage =
  | { id: string; kind: 'reminders.requestPermission' }
  | { id: string; kind: 'reminders.sync'; workspaceId: string; items: NativeReminderEntry[] };

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

export function nativeReminderSchedule(workspace: WorkspaceDocument, now = new Date()): NativeReminderEntry[] {
  const nowTime = now.getTime();
  return Object.values(workspace.items).flatMap((item) => {
    if (item.deletedAt || item.state !== 'open' || item.role === 'series_template') return [];
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
        body: reminder.urgency === 'normal' ? 'Reminder' : `Reminder · ${reminder.urgency}`,
        at: new Date(deliveryTime).toISOString(),
        urgency: reminder.urgency,
      } satisfies NativeReminderEntry];
    });
  }).sort((left, right) => Date.parse(left.at) - Date.parse(right.at)).slice(0, maximumPendingReminders);
}

export function requestNativeReminderPermission(): Promise<NativeReminderStatus> {
  return send({ id: requestId(), kind: 'reminders.requestPermission' });
}

export function syncNativeReminders(workspace: WorkspaceDocument, now = new Date()): Promise<NativeReminderStatus> {
  return send({ id: requestId(), kind: 'reminders.sync', workspaceId: workspace.workspaceId, items: nativeReminderSchedule(workspace, now) });
}
