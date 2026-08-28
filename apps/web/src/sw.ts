/// <reference lib="WebWorker" />

import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<unknown> };

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
// Keep the app shell available when GitHub (or the LAN host) is temporarily
// unreachable. IndexedDB remains local, so the cached shell can still expose
// the sign-in Help and export the encrypted workspace recovery copy.
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith((async () => {
    try { return await fetch(event.request); }
    catch { return (await caches.match(new URL('index.html', self.registration.scope).href)) || Response.error(); }
  })());
});

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
