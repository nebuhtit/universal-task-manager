/// <reference lib="WebWorker" />

import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<unknown> };

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

type PushPayload = { title?: string; body?: string; url?: string; tag?: string; urgency?: 'normal' | 'urgent' | 'critical' };

self.addEventListener('push', (event) => {
  const payload = (() => { try { return event.data?.json() as PushPayload; } catch { return {}; } })();
  const title = payload.title || 'Universal reminder';
  event.waitUntil(self.registration.showNotification(title, {
    body: payload.body || 'Open Universal to view your reminder.',
    tag: payload.tag || 'universal-reminder',
    data: { url: payload.url || self.registration.scope },
    renotify: true,
    requireInteraction: payload.urgency === 'critical',
  } as NotificationOptions));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = String((event.notification.data as { url?: string } | undefined)?.url || self.registration.scope);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => client.url.startsWith(self.registration.scope));
    if (existing) return existing.focus();
    return self.clients.openWindow(url);
  })());
});
