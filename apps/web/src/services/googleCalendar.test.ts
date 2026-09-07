import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyGoogleCalendarSync, createWorkspace, type GoogleCalendarPreferences } from '@utm/core';
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

  it('manual refresh restores missing events despite an existing incremental cursor', async () => {
    const current = preferences();
    current.calendars = [{ id: 'primary', name: 'Main', selected: true }];
    current.syncTokens = { primary: 'already-consumed' };
    current.syncWindow = { timeMin: '2025-01-01T00:00:00Z', timeMax: '2027-01-01T00:00:00Z', refreshedAt: new Date().toISOString() };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: 'primary', primary: true }] }))
      .mockResolvedValueOnce(jsonResponse({ items: [], nextPageToken: 'second-page' }))
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: 'missing', summary: 'New meeting', start: { dateTime: '2026-09-07T15:00:00Z' }, end: { dateTime: '2026-09-07T16:00:00Z' } }], nextSyncToken: 'fresh-cursor' }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await synchronizeGoogleCalendars('access-token', current, undefined, { fullSync: true });
    for (const [url, init] of fetchMock.mock.calls) {
      expect(init.cache).toBe('no-store');
      expect(new URL(String(url)).searchParams.has('syncToken')).toBe(false);
    }
    expect(new URL(String(fetchMock.mock.calls[2]![0])).searchParams.get('pageToken')).toBe('second-page');
    const workspace = createWorkspace('Sync regression');
    expect(applyGoogleCalendarSync(workspace, result.batches[0]!)).toMatchObject({ added: 1 });
    expect(Object.values(workspace.items).some((item) => item.title === 'New meeting')).toBe(true);
    expect(result.syncTokens.primary).toBe('fresh-cursor');
    expect(current.syncTokens.primary).toBe('already-consumed');
  });

  it('reports an empty calendar selection instead of claiming a successful refresh', async () => {
    const current = preferences();
    current.calendars = [{ id: 'primary', name: 'Main', selected: false }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items: [{ id: 'primary', primary: true }] })));
    await expect(synchronizeGoogleCalendars('access-token', current)).rejects.toThrow('No Google calendars are selected');
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
