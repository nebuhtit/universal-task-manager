import type { GoogleCalendarDefinition, GoogleCalendarEvent, GoogleCalendarPreferences, GoogleCalendarSyncBatch } from '@utm/core';

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const GOOGLE_SCRIPT_TIMEOUT_MS = 20_000;
const GOOGLE_AUTH_TIMEOUT_MS = 90_000;
const GOOGLE_REQUEST_TIMEOUT_MS = 30_000;
const GOOGLE_SYNC_WINDOW_REFRESH_MS = 7 * 86_400_000;
const GOOGLE_EVENTS_PAGE_SIZE = '500';
export const GOOGLE_CALENDAR_SYNC_CONCURRENCY = 3;
export const GOOGLE_CALENDAR_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? '';

interface GoogleTokenResponse { access_token?: string; expires_in?: number; error?: string; error_description?: string }
interface GoogleTokenClient { requestAccessToken: (options?: { prompt?: string }) => void }
interface GoogleCalendarListEntry { id?: string; summary?: string; primary?: boolean; selected?: boolean; accessRole?: string }
interface GoogleCalendarListResponse { items?: GoogleCalendarListEntry[]; nextPageToken?: string }
interface GoogleEventsResponse { items?: GoogleCalendarEvent[]; nextPageToken?: string; nextSyncToken?: string }

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: { initTokenClient: (options: { client_id: string; scope: string; callback: (response: GoogleTokenResponse) => void; error_callback?: (error: unknown) => void }) => GoogleTokenClient } } };
  }
}

let scriptPromise: Promise<void> | null = null;
let cachedGoogleCalendarToken: { accessToken: string; expiresAt: number } | null = null;
function loadGoogleIdentityServices(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  const pending = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-utm-google-identity]');
    const script = existing ?? document.createElement('script');
    const timeout = globalThis.setTimeout(() => reject(new Error('Google sign-in took too long to load. Check Safari content blockers and the network connection.')), GOOGLE_SCRIPT_TIMEOUT_MS);
    const finish = (callback: () => void) => { globalThis.clearTimeout(timeout); callback(); };
    const done = () => finish(() => window.google?.accounts?.oauth2 ? resolve() : reject(new Error('Google sign-in did not become available.')));
    script.addEventListener('load', done, { once: true });
    script.addEventListener('error', () => finish(() => reject(new Error('Could not load Google sign-in. Check the network connection.'))), { once: true });
    if (!existing) {
      script.src = 'https://accounts.google.com/gsi/client'; script.async = true; script.defer = true;
      script.dataset.utmGoogleIdentity = 'true'; document.head.append(script);
    }
  });
  const loading = pending.catch((reason) => { scriptPromise = null; throw reason; });
  scriptPromise = loading;
  return loading;
}

export async function requestGoogleCalendarToken(clientId = GOOGLE_CALENDAR_CLIENT_ID): Promise<{ accessToken: string; expiresAt: number }> {
  if (!clientId) throw new Error('Google Calendar is not configured for this build. Add VITE_GOOGLE_CLIENT_ID.');
  if (cachedGoogleCalendarToken && cachedGoogleCalendarToken.expiresAt > Date.now() + 60_000) return cachedGoogleCalendarToken;
  await loadGoogleIdentityServices();
  return new Promise((resolve, reject) => {
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2) { reject(new Error('Google sign-in is unavailable.')); return; }
    const timeout = globalThis.setTimeout(() => reject(new Error('Google authorization timed out. Return to the app and try Connect again.')), GOOGLE_AUTH_TIMEOUT_MS);
    const finish = <T,>(callback: () => T): T => { globalThis.clearTimeout(timeout); return callback(); };
    const client = oauth2.initTokenClient({
      client_id: clientId, scope: GOOGLE_SCOPE,
      callback: (response) => {
        if (!response.access_token) { finish(() => reject(new Error(response.error_description || response.error || 'Google sign-in was cancelled.'))); return; }
        finish(() => {
          cachedGoogleCalendarToken = { accessToken: response.access_token!, expiresAt: Date.now() + Math.max(60, response.expires_in ?? 3_600) * 1_000 };
          resolve(cachedGoogleCalendarToken);
        });
      },
      error_callback: () => finish(() => reject(new Error('Google sign-in was cancelled.'))),
    });
    // Google still asks for consent when it is needed, but never force that
    // screen again for an already-authorized Google browser session.
    client.requestAccessToken({ prompt: '' });
  });
}

async function googleJson<T>(url: string, accessToken: string): Promise<T> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), GOOGLE_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: controller.signal });
  } catch (reason) {
    if (controller.signal.aborted) throw new Error('Google Calendar request timed out. Check the connection and try again.');
    throw reason;
  } finally { globalThis.clearTimeout(timeout); }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const error = new Error(response.status === 401 ? 'Google access expired. Connect again.' : `Google Calendar request failed (${response.status}).`);
    Object.assign(error, { status: response.status, details: body.slice(0, 500) });
    throw error;
  }
  return response.json() as Promise<T>;
}

async function listCalendars(accessToken: string): Promise<GoogleCalendarListEntry[]> {
  const result: GoogleCalendarListEntry[] = [];
  let pageToken = '';
  do {
    const query = new URLSearchParams({ maxResults: '250' });
    if (pageToken) query.set('pageToken', pageToken);
    const page = await googleJson<GoogleCalendarListResponse>(`https://www.googleapis.com/calendar/v3/users/me/calendarList?${query}`, accessToken);
    result.push(...(page.items ?? [])); pageToken = page.nextPageToken ?? '';
  } while (pageToken);
  return result;
}

type GoogleSyncWindow = NonNullable<GoogleCalendarPreferences['syncWindow']>;

function freshSyncWindow(now = new Date()): GoogleSyncWindow {
  const timeMin = new Date(now); timeMin.setUTCFullYear(timeMin.getUTCFullYear() - 1);
  const timeMax = new Date(now); timeMax.setUTCFullYear(timeMax.getUTCFullYear() + 1);
  return { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), refreshedAt: now.toISOString() };
}

function reusableSyncWindow(preferences: GoogleCalendarPreferences, now = new Date()): GoogleSyncWindow | undefined {
  const window = preferences.syncWindow;
  if (!window || !Number.isFinite(Date.parse(window.refreshedAt)) || now.getTime() - Date.parse(window.refreshedAt) >= GOOGLE_SYNC_WINDOW_REFRESH_MS) return undefined;
  return window;
}

async function listEvents(accessToken: string, calendarId: string, syncWindow: GoogleSyncWindow, syncToken?: string, onPage?: (page: number, eventCount: number) => void): Promise<{ events: GoogleCalendarEvent[]; nextSyncToken: string; fullSync: boolean }> {
  const run = async (token?: string) => {
    const result: GoogleCalendarEvent[] = [];
    let pageToken = ''; let nextSyncToken = ''; let pageNumber = 0;
    do {
      const query = new URLSearchParams({ maxResults: GOOGLE_EVENTS_PAGE_SIZE, showDeleted: 'true', singleEvents: 'true' });
      if (token) query.set('syncToken', token);
      else { query.set('timeMin', syncWindow.timeMin); query.set('timeMax', syncWindow.timeMax); }
      if (pageToken) query.set('pageToken', pageToken);
      const page = await googleJson<GoogleEventsResponse>(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${query}`, accessToken);
      result.push(...(page.items ?? [])); pageToken = page.nextPageToken ?? ''; nextSyncToken = page.nextSyncToken ?? nextSyncToken; pageNumber += 1;
      onPage?.(pageNumber, result.length);
    } while (pageToken);
    if (!nextSyncToken) throw new Error(`Google did not return a sync token for ${calendarId}.`);
    return { events: result, nextSyncToken };
  };
  try { const result = await run(syncToken); return { ...result, fullSync: !syncToken }; }
  catch (reason) {
    if (syncToken && (reason as { status?: number }).status === 410) { const result = await run(); return { ...result, fullSync: true }; }
    throw reason;
  }
}

export interface GoogleCalendarSyncResult {
  calendars: GoogleCalendarDefinition[];
  accountEmail?: string;
  batches: GoogleCalendarSyncBatch[];
  syncTokens: Record<string, string>;
  syncWindow: GoogleSyncWindow;
  syncedAt: string;
}

export interface GoogleCalendarSyncProgress {
  stage: 'calendar-list' | 'events' | 'complete';
  message: string;
  completedCalendars: number;
  totalCalendars: number;
  eventCount: number;
  page?: number;
  fullSync?: boolean;
}

export async function synchronizeGoogleCalendars(accessToken: string, preferences: GoogleCalendarPreferences, onProgress?: (progress: GoogleCalendarSyncProgress) => void): Promise<GoogleCalendarSyncResult> {
  onProgress?.({ stage: 'calendar-list', message: 'Loading Google calendar list…', completedCalendars: 0, totalCalendars: 0, eventCount: 0 });
  const rawCalendars = await listCalendars(accessToken);
  const prior = new Map(preferences.calendars.map((calendar) => [calendar.id, calendar]));
  const calendars = rawCalendars.flatMap((calendar): GoogleCalendarDefinition[] => {
    if (!calendar.id) return [];
    const previous = prior.get(calendar.id);
    return [{ id: calendar.id, name: calendar.summary?.trim() || calendar.id, ...(calendar.primary ? { primary: true } : {}), selected: previous?.selected ?? Boolean(calendar.primary || calendar.selected) }];
  });
  const syncedAt = new Date().toISOString();
  const priorWindow = reusableSyncWindow(preferences);
  const syncWindow = priorWindow ?? freshSyncWindow();
  const syncTokens = priorWindow ? { ...preferences.syncTokens } : {};
  const batches: GoogleCalendarSyncBatch[] = [];
  const selectedCalendars = calendars.filter((entry) => entry.selected);
  let eventCount = 0;
  let nextCalendarIndex = 0;
  let completedCalendars = 0;
  const partialCounts = new Map<number, number>();
  const results = new Array<{ response: Awaited<ReturnType<typeof listEvents>>; calendar: GoogleCalendarDefinition } | undefined>(selectedCalendars.length);
  const worker = async () => {
    while (true) {
      const index = nextCalendarIndex++;
      const calendar = selectedCalendars[index];
      if (!calendar) return;
      const existingToken = syncTokens[calendar.id];
      onProgress?.({ stage: 'events', message: `${existingToken ? 'Updating' : 'Loading'} ${calendar.name} (${index + 1}/${selectedCalendars.length})…`, completedCalendars, totalCalendars: selectedCalendars.length, eventCount, fullSync: !existingToken });
      const response = await listEvents(accessToken, calendar.id, syncWindow, existingToken, (page, calendarEventCount) => {
        partialCounts.set(index, calendarEventCount);
        const inFlightEvents = [...partialCounts.values()].reduce((total, count) => total + count, 0);
        onProgress?.({ stage: 'events', message: `${calendar.name}: page ${page}, ${calendarEventCount} events…`, completedCalendars, totalCalendars: selectedCalendars.length, eventCount: eventCount + inFlightEvents, page, fullSync: !existingToken });
      });
      partialCounts.delete(index);
      results[index] = { response, calendar };
      eventCount += response.events.length;
      completedCalendars += 1;
      onProgress?.({ stage: 'events', message: `${calendar.name}: ${response.events.length} events loaded.`, completedCalendars, totalCalendars: selectedCalendars.length, eventCount });
    }
  };
  await Promise.all(Array.from({ length: Math.min(GOOGLE_CALENDAR_SYNC_CONCURRENCY, selectedCalendars.length) }, () => worker()));
  for (const result of results) {
    if (!result) continue;
    syncTokens[result.calendar.id] = result.response.nextSyncToken;
    batches.push({ connectionId: preferences.connectionId, calendarId: result.calendar.id, events: result.response.events, syncedAt, fullSync: result.response.fullSync });
  }
  for (const calendarId of Object.keys(syncTokens)) if (!calendars.some((calendar) => calendar.id === calendarId && calendar.selected)) delete syncTokens[calendarId];
  onProgress?.({ stage: 'complete', message: `Google download complete: ${eventCount} events.`, completedCalendars: selectedCalendars.length, totalCalendars: selectedCalendars.length, eventCount });
  return { calendars, ...(rawCalendars.find((calendar) => calendar.primary)?.id ? { accountEmail: rawCalendars.find((calendar) => calendar.primary)!.id } : {}), batches, syncTokens, syncWindow, syncedAt };
}
