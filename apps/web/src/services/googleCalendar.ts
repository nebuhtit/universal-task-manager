import type { GoogleCalendarDefinition, GoogleCalendarEvent, GoogleCalendarPreferences, GoogleCalendarSyncBatch } from '@utm/core';

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
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
function loadGoogleIdentityServices(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-utm-google-identity]');
    const script = existing ?? document.createElement('script');
    const done = () => window.google?.accounts?.oauth2 ? resolve() : reject(new Error('Google sign-in did not become available.'));
    script.addEventListener('load', done, { once: true });
    script.addEventListener('error', () => reject(new Error('Could not load Google sign-in. Check the network connection.')), { once: true });
    if (!existing) {
      script.src = 'https://accounts.google.com/gsi/client'; script.async = true; script.defer = true;
      script.dataset.utmGoogleIdentity = 'true'; document.head.append(script);
    }
  });
  return scriptPromise;
}

export async function requestGoogleCalendarToken(clientId = GOOGLE_CALENDAR_CLIENT_ID): Promise<{ accessToken: string; expiresAt: number }> {
  if (!clientId) throw new Error('Google Calendar is not configured for this build. Add VITE_GOOGLE_CLIENT_ID.');
  await loadGoogleIdentityServices();
  return new Promise((resolve, reject) => {
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2) { reject(new Error('Google sign-in is unavailable.')); return; }
    const client = oauth2.initTokenClient({
      client_id: clientId, scope: GOOGLE_SCOPE,
      callback: (response) => {
        if (!response.access_token) { reject(new Error(response.error_description || response.error || 'Google sign-in was cancelled.')); return; }
        resolve({ accessToken: response.access_token, expiresAt: Date.now() + Math.max(60, response.expires_in ?? 3_600) * 1_000 });
      },
      error_callback: () => reject(new Error('Google sign-in was cancelled.')),
    });
    client.requestAccessToken({ prompt: 'consent' });
  });
}

async function googleJson<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
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

async function listEvents(accessToken: string, calendarId: string, syncToken?: string): Promise<{ events: GoogleCalendarEvent[]; nextSyncToken: string; fullSync: boolean }> {
  const run = async (token?: string) => {
    const result: GoogleCalendarEvent[] = [];
    let pageToken = ''; let nextSyncToken = '';
    do {
      const query = new URLSearchParams({ maxResults: '2500', showDeleted: 'true', singleEvents: 'true' });
      if (token) query.set('syncToken', token);
      if (pageToken) query.set('pageToken', pageToken);
      const page = await googleJson<GoogleEventsResponse>(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${query}`, accessToken);
      result.push(...(page.items ?? [])); pageToken = page.nextPageToken ?? ''; nextSyncToken = page.nextSyncToken ?? nextSyncToken;
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
  syncedAt: string;
}

export async function synchronizeGoogleCalendars(accessToken: string, preferences: GoogleCalendarPreferences): Promise<GoogleCalendarSyncResult> {
  const rawCalendars = await listCalendars(accessToken);
  const prior = new Map(preferences.calendars.map((calendar) => [calendar.id, calendar]));
  const calendars = rawCalendars.flatMap((calendar): GoogleCalendarDefinition[] => {
    if (!calendar.id) return [];
    const previous = prior.get(calendar.id);
    return [{ id: calendar.id, name: calendar.summary?.trim() || calendar.id, ...(calendar.primary ? { primary: true } : {}), selected: previous?.selected ?? Boolean(calendar.primary || calendar.selected) }];
  });
  const syncedAt = new Date().toISOString();
  const syncTokens = { ...preferences.syncTokens };
  const batches: GoogleCalendarSyncBatch[] = [];
  for (const calendar of calendars.filter((entry) => entry.selected)) {
    const response = await listEvents(accessToken, calendar.id, syncTokens[calendar.id]);
    syncTokens[calendar.id] = response.nextSyncToken;
    batches.push({ connectionId: preferences.connectionId, calendarId: calendar.id, events: response.events, syncedAt, fullSync: response.fullSync });
  }
  for (const calendarId of Object.keys(syncTokens)) if (!calendars.some((calendar) => calendar.id === calendarId && calendar.selected)) delete syncTokens[calendarId];
  return { calendars, ...(rawCalendars.find((calendar) => calendar.primary)?.id ? { accountEmail: rawCalendars.find((calendar) => calendar.primary)!.id } : {}), batches, syncTokens, syncedAt };
}
