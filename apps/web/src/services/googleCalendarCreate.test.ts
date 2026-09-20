import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSingleGoogleEvent, googleCreationId, googleEventBody, type GoogleCreateOperation } from './googleCalendarCreate';
import { forgetGoogleCalendarAuthorization, requestGoogleCalendarToken } from './googleCalendar';

const operation: GoogleCreateOperation = {
  eventId: 'utm1234567890abcdef', calendarId: 'work@example.com', accountEmail: 'me@example.com',
  draft: { title: 'Meeting', description: 'Agenda', location: '', start: '2026-09-23T19:30:00+03:00', end: '2026-09-23T21:15:00+03:00', allDay: false, busy: true, timeZone: 'Europe/Moscow' },
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const calendars = { items: [{ id: 'me@example.com', primary: true, accessRole: 'owner' }, { id: 'work@example.com', accessRole: 'writer' }] };
afterEach(() => { forgetGoogleCalendarAuthorization(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Single Google event creation', () => {
  it('keeps the same identifier across reloads but separates workspaces and items', async () => {
    const id = await googleCreationId('workspace', 'item');
    expect(id).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(await googleCreationId('workspace', 'item')).toBe(id);
    expect(await googleCreationId('workspace-2', 'item')).not.toBe(id);
    expect(await googleCreationId('workspace', 'item-2')).not.toBe(id);
  });
  it('sends exactly one insert with explicit times and no guests or recurrence', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(calendars)).mockResolvedValueOnce(response({ id: operation.eventId }));
    vi.stubGlobal('fetch', fetch);
    await createSingleGoogleEvent('token', operation);
    const [url, init] = fetch.mock.calls[1]!;
    expect(url).toContain('work%40example.com/events?sendUpdates=none');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.start.dateTime).toBe('2026-09-23T16:30:00.000Z');
    expect(body.end.dateTime).toBe('2026-09-23T18:15:00.000Z');
    expect(body).not.toHaveProperty('attendees'); expect(body).not.toHaveProperty('recurrence');
  });
  it('recovers the same event on a retry without modifying it', async () => {
    const event = { id: operation.eventId, extendedProperties: { private: { utmCreateOperation: operation.eventId } } };
    const fetch = vi.fn().mockResolvedValueOnce(response(calendars)).mockResolvedValueOnce(response({}, 409)).mockResolvedValueOnce(response(event));
    vi.stubGlobal('fetch', fetch);
    expect(await createSingleGoogleEvent('token', operation)).toEqual(event);
    expect(fetch.mock.calls[2]![0]).toContain(`/events/${operation.eventId}`);
    expect(fetch.mock.calls[2]![1].method).toBeUndefined();
  });
  it('does not treat another event with the same identifier as our success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(calendars)).mockResolvedValueOnce(response({}, 409)).mockResolvedValueOnce(response({ id: operation.eventId })));
    await expect(createSingleGoogleEvent('token', operation)).rejects.toThrow('already in use');
  });
  it('blocks sending to a different account or a read-only calendar', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ items: [{ id: 'other@example.com', primary: true, accessRole: 'owner' }] }));
    vi.stubGlobal('fetch', fetch);
    await expect(createSingleGoogleEvent('token', operation)).rejects.toThrow('account connected');
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValue(response({ items: [{ id: operation.accountEmail, primary: true }, { id: operation.calendarId, accessRole: 'reader' }] }));
    await expect(createSingleGoogleEvent('token', operation)).rejects.toThrow('not writable');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('validates dates before the network and preserves exclusive all-day ends', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(createSingleGoogleEvent('token', { ...operation, draft: { ...operation.draft, end: operation.draft.start } })).rejects.toThrow('after');
    expect(fetch).not.toHaveBeenCalled();
    const body = googleEventBody({ ...operation, draft: { ...operation.draft, allDay: true, start: '2026-09-23', end: '2026-09-24' } });
    expect(body.start).toEqual({ date: '2026-09-23' }); expect(body.end).toEqual({ date: '2026-09-24' });
    expect(() => googleEventBody({ ...operation, draft: { ...operation.draft, allDay: true, start: '2026-02-30', end: '2026-03-03' } })).toThrow('valid dates');
  });
  it('requests write permission separately and rejects partial consent', async () => {
    let allowWrite = false;
    const initTokenClient = vi.fn((options) => ({ requestAccessToken: () => options.callback({ access_token: 'token', scope: allowWrite ? options.scope : 'https://www.googleapis.com/auth/calendar.readonly', expires_in: 3600 }) }));
    vi.stubGlobal('window', { google: { accounts: { oauth2: { initTokenClient } } } });
    await requestGoogleCalendarToken('client');
    await expect(requestGoogleCalendarToken('client', 'create')).rejects.toThrow('not granted');
    allowWrite = true;
    await requestGoogleCalendarToken('client', 'create');
    await requestGoogleCalendarToken('client', 'create');
    expect(initTokenClient).toHaveBeenCalledTimes(3);
    expect(initTokenClient.mock.calls[1]![0].scope).toBe('https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly');
    await requestGoogleCalendarToken('client');
    expect(initTokenClient).toHaveBeenCalledTimes(3);
  });
});
