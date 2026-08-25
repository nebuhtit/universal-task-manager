import { createId, createOccurrence, durationToMs, projectOccurrences, type Reminder, type UniversalItem, type WorkspaceDocument } from '@utm/core';

/** The public Worker endpoint. It contains no workspace password or decryption key. */
export const PUSH_SERVICE_URL = (import.meta.env.VITE_PUSH_SERVICE_URL || 'https://universal-task-manager-push.const-perfect.workers.dev').replace(/\/$/, '');

type PushSubscriptionJSON = { endpoint: string; expirationTime?: number | null; keys?: { p256dh?: string; auth?: string } };
type PushIdentity = { deviceId: string; deviceSecret: string; serviceUrl: string };
export type BackgroundPushStatus = { subscriptionUpdatedAt?: string; syncedAt?: string; jobCount?: number };

function base64UrlBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function identity(workspace: WorkspaceDocument): PushIdentity {
  const preferences = workspace.pushPreferences;
  if (!preferences.deviceId || !preferences.deviceSecret) throw new Error('Background notification identity is missing. Enable it again.');
  return { deviceId: preferences.deviceId, deviceSecret: preferences.deviceSecret, serviceUrl: preferences.serviceUrl || PUSH_SERVICE_URL };
}

async function responseError(response: Response): Promise<never> {
  const message = await response.text().catch(() => '');
  throw new Error(message || `Background notification service returned ${response.status}`);
}

async function getPublicKey(serviceUrl: string): Promise<Uint8Array> {
  const response = await fetch(`${serviceUrl}/v1/public-key`);
  if (!response.ok) return responseError(response);
  const data = await response.json() as { publicKey?: string };
  if (!data.publicKey) throw new Error('Background notification service did not provide a public key.');
  return base64UrlBytes(data.publicKey);
}

/** Requests user-visible permission and connects this encrypted workspace copy to Web Push. */
export async function subscribeBackgroundPush(workspace: WorkspaceDocument, accessCode: string): Promise<BackgroundPushStatus> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('This browser does not support background push notifications.');
  const settings = identity(workspace);
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');
  const registration = await navigator.serviceWorker.ready;
  const publicKey = await getPublicKey(settings.serviceUrl);
  const applicationServerKey = new Uint8Array(publicKey.byteLength); applicationServerKey.set(publicKey);
  const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
  const response = await fetch(`${settings.serviceUrl}/v1/subscriptions`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId: settings.deviceId, deviceSecret: settings.deviceSecret, accessCode, subscription: subscription.toJSON() }),
  });
  if (!response.ok) return responseError(response);
  return await response.json() as BackgroundPushStatus;
}

function reminderTime(item: UniversalItem, reminder: Reminder): string | undefined {
  if (reminder.acknowledgedAt) return undefined;
  if (reminder.mode === 'absolute') return reminder.at;
  const base = reminder.relativeTo === 'available' ? item.schedule?.availableFrom
    : reminder.relativeTo === 'start' ? item.schedule?.startAt
      : reminder.relativeTo === 'end' ? item.schedule?.endAt : item.schedule?.dueAt;
  if (!base) return undefined;
  const delta = reminder.offset ? durationToMs(reminder.offset) : 0;
  return new Date(new Date(base).getTime() + delta).toISOString();
}

function jobItems(workspace: WorkspaceDocument, until: Date): UniversalItem[] {
  const current = new Date();
  const rangeStart = new Date(current.getTime() - 86_400_000);
  const projected = projectOccurrences(workspace, rangeStart, until);
  return projected.map((row) => {
    if (!row.virtual) return workspace.items[row.materializedItemId ?? row.sourceItemId];
    const series = workspace.items[row.sourceItemId];
    return series && row.recurrenceId ? createOccurrence(series, new Date(row.recurrenceId), 0) : undefined;
  }).filter((item): item is UniversalItem => Boolean(item));
}

/** Mirrors up to 45 days of future, open reminders. The user chooses whether the push body is generic or detailed. */
export async function syncBackgroundPush(workspace: WorkspaceDocument): Promise<BackgroundPushStatus | undefined> {
  if (!workspace.pushPreferences.enabled || Notification.permission !== 'granted') return undefined;
  const settings = identity(workspace);
  const now = Date.now(); const until = new Date(now + 45 * 86_400_000);
  const jobs = jobItems(workspace, until).flatMap((item) => {
    if (item.deletedAt || item.state !== 'open' || item.role === 'series_template') return [];
    if (item.schedule?.availableFrom && new Date(item.schedule.availableFrom).getTime() > until.getTime()) return [];
    return item.reminders.flatMap((reminder) => {
      const at = reminderTime(item, reminder); const timestamp = at ? new Date(at).getTime() : Number.NaN;
      if (!at || !Number.isFinite(timestamp) || timestamp < now - 60_000 || timestamp > until.getTime()) return [];
      const detailed = workspace.pushPreferences.contentMode === 'detailed';
      const schedule = item.schedule;
      const timing = [schedule?.startAt && `Start: ${new Date(schedule.startAt).toLocaleString('ru-RU', { hourCycle: 'h23' })}`, schedule?.dueAt && `Deadline: ${new Date(schedule.dueAt).toLocaleString('ru-RU', { hourCycle: 'h23' })}`].filter(Boolean).join(' · ');
      return [{
        id: `reminder:${item.id}:${reminder.id}:${at}`,
        at,
        title: detailed ? (item.title || 'Universal reminder') : 'Universal reminder',
        body: detailed ? [`Reminder${reminder.urgency ? ` · ${reminder.urgency}` : ''}`, timing].filter(Boolean).join(' · ') : 'Open Universal to view your reminder.',
        url: `${location.origin}${import.meta.env.BASE_URL}?item=${encodeURIComponent(item.id)}`,
        urgency: reminder.urgency,
      }];
    });
  });
  const response = await fetch(`${settings.serviceUrl}/v1/jobs`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId: settings.deviceId, deviceSecret: settings.deviceSecret, jobs }),
  });
  if (!response.ok) return responseError(response);
  return await response.json() as BackgroundPushStatus;
}

export function createPushPreferences(_contentMode: WorkspaceDocument['pushPreferences']['contentMode'] = 'detailed'): WorkspaceDocument['pushPreferences'] {
  return { enabled: true, serviceUrl: PUSH_SERVICE_URL, deviceId: createId(), deviceSecret: `${createId()}${createId()}`, contentMode: 'detailed' };
}

export async function unsubscribeBackgroundPush(workspace: WorkspaceDocument): Promise<void> {
  const settings = identity(workspace);
  const registration = await navigator.serviceWorker?.ready;
  const subscription = await registration?.pushManager.getSubscription();
  await subscription?.unsubscribe();
  await fetch(`${settings.serviceUrl}/v1/subscriptions`, {
    method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings),
  }).catch(() => undefined);
}
