import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GoogleCalendarPreferences } from '@utm/core';
import { GOOGLE_CALENDAR_SYNC_CONCURRENCY, synchronizeGoogleCalendars } from './googleCalendar';

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const preferences = (): GoogleCalendarPreferences => ({ connectionId: 'connection-1', calendars: [], syncTokens: {} });

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Google Calendar browser synchronization', () => {
  it('bounds the initial download to one year behind and ahead and reports page progress', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: 'primary', summary: 'Main', primary: true }] }))
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: 'event-1', summary: 'Meeting' }], nextPageToken: 'page-2' }))
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: 'event-2', summary: 'Planning' }], nextSyncToken: 'sync-1' }));
    vi.stubGlobal('fetch', fetchMock);
    const progress: string[] = [];

    const result = await synchronizeGoogleCalendars('access-token', preferences(), (entry) => progress.push(entry.message));

    const firstEventsUrl = new URL(String(fetchMock.mock.calls[1]![0]));
    expect(firstEventsUrl.searchParams.get('maxResults')).toBe('500');
    expect(firstEventsUrl.searchParams.get('timeMin')).toBe(result.syncWindow.timeMin);
    expect(firstEventsUrl.searchParams.get('timeMax')).toBe(result.syncWindow.timeMax);
    expect(firstEventsUrl.searchParams.has('syncToken')).toBe(false);
    expect(result.batches[0]?.events).toHaveLength(2);
    expect(progress).toContain('Main: page 1, 1 events…');
    expect(progress).toContain('Main: page 2, 2 events…');
  });

  it('uses the stored sync token for a recent bounded window without repeating the full download', async () => {
    const now = new Date();
    const current = preferences();
    current.calendars = [{ id: 'primary', name: 'Main', primary: true, selected: true }];
    current.syncTokens = { primary: 'sync-1' };
    current.syncWindow = { timeMin: new Date(now.getTime() - 86_400_000).toISOString(), timeMax: new Date(now.getTime() + 86_400_000).toISOString(), refreshedAt: now.toISOString() };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: 'primary', summary: 'Main', primary: true }] }))
      .mockResolvedValueOnce(jsonResponse({ items: [], nextSyncToken: 'sync-2' }));
    vi.stubGlobal('fetch', fetchMock);

    await synchronizeGoogleCalendars('access-token', current);

    const eventsUrl = new URL(String(fetchMock.mock.calls[1]![0]));
    expect(eventsUrl.searchParams.get('syncToken')).toBe('sync-1');
    expect(eventsUrl.searchParams.has('timeMin')).toBe(false);
    expect(eventsUrl.searchParams.has('timeMax')).toBe(false);
  });

  it('turns a stalled Google request into a visible timeout error', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));

    const pending = synchronizeGoogleCalendars('access-token', preferences());
    const rejection = expect(pending).rejects.toThrow('Google Calendar request timed out');
    await vi.advanceTimersByTimeAsync(30_000);

    await rejection;
  });

  it('downloads several calendars with bounded concurrency and deterministic batches', async () => {
    let active = 0;
    let peak = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/calendarList?')) return jsonResponse({ items: Array.from({ length: 5 }, (_, index) => ({ id: `calendar-${index}`, summary: `Calendar ${index}`, selected: true })) });
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      const calendarId = decodeURIComponent(url.split('/calendars/')[1]!.split('/events')[0]!);
      return jsonResponse({ items: [{ id: `event-${calendarId}` }], nextSyncToken: `sync-${calendarId}` });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await synchronizeGoogleCalendars('access-token', preferences());

    expect(peak).toBe(GOOGLE_CALENDAR_SYNC_CONCURRENCY);
    expect(result.batches.map((batch) => batch.calendarId)).toEqual(['calendar-0', 'calendar-1', 'calendar-2', 'calendar-3', 'calendar-4']);
  });
});
