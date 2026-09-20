import { afterEach, describe, expect, it, vi } from 'vitest';
import { canEditGoogleEvent, googleEventChanges, googleEventDraft, GoogleEditConflict, updateSingleGoogleEvent, type GoogleEditOperation } from './googleCalendarEdit';

const event = { id: 'instance', etag: 'v1', summary: 'Meeting', recurringEventId: 'master', start: { dateTime: '2026-09-20T12:00:00Z', timeZone: 'UTC' }, end: { dateTime: '2026-09-20T13:00:00Z', timeZone: 'UTC' } };
const operation = (): GoogleEditOperation => ({ eventId: event.id, calendarId: 'calendar', accountEmail: 'me@example.com', baseline: event, draft: { ...googleEventDraft(event, 'UTC'), title: 'Updated' } });
const now = () => Date.parse('2026-09-20T15:00:00Z');
afterEach(() => vi.unstubAllGlobals());
function mockRemote(remote = event, accessRole = 'owner', patchStatus = 200) {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { requests.push({ url, ...(init ? { init } : {}) }); if (url.includes('calendarList')) return new Response(JSON.stringify({ items: [{ id: 'me@example.com', primary: true }, { id: 'calendar', accessRole, timeZone: 'UTC' }] })); if (init?.method === 'PATCH') return new Response(JSON.stringify({ ...remote, summary: 'Updated', etag: 'v2' }), { status: patchStatus }); return new Response(JSON.stringify(remote)); }));
  return requests;
}
describe('Google event editing', () => {
  it('allows old occurrences only with the explicit beta switch and retains access checks', async () => {
    const later = () => Date.parse('2030-01-01T12:00:00Z');
    mockRemote();
    await expect(updateSingleGoogleEvent('token', operation(), later)).rejects.toThrow('3 hours');
    await expect(updateSingleGoogleEvent('token', operation(), later, true)).resolves.toMatchObject({ summary: 'Updated' });
    mockRemote(event, 'reader');
    await expect(updateSingleGoogleEvent('token', operation(), later, true)).rejects.toThrow('not writable');
  });
  it('includes exactly 3 hours and excludes one millisecond later, masters, and cancelled events', () => {
    expect(canEditGoogleEvent(event, 'UTC', Date.parse('2026-09-20T16:00:00Z'))).toBe(true);
    expect(canEditGoogleEvent(event, 'UTC', Date.parse('2026-09-20T16:00:00.001Z'))).toBe(false);
    expect(canEditGoogleEvent({ ...event, recurrence: ['FREQ=DAILY'] }, 'UTC', now())).toBe(false);
    expect(canEditGoogleEvent({ ...event, status: 'cancelled' }, 'UTC', now())).toBe(false);
    expect(canEditGoogleEvent(event, 'UTC', Date.parse('2026-09-19T12:00:00Z'))).toBe(true);
  });
  it('uses exclusive all-day end in the calendar timezone, including DST', () => {
    const allDay = { id: 'all', start: { date: '2026-03-29' }, end: { date: '2026-03-30' } };
    expect(canEditGoogleEvent(allDay, 'Europe/Berlin', Date.parse('2026-03-30T01:00:00Z'))).toBe(true);
    expect(canEditGoogleEvent(allDay, 'Europe/Berlin', Date.parse('2026-03-30T01:00:00.001Z'))).toBe(false);
  });
  it('PATCHes only changed fields on the specific instance using If-Match', async () => {
    const requests = mockRemote(); await updateSingleGoogleEvent('token', operation(), now);
    const patch = requests.find((request) => request.init?.method === 'PATCH')!;
    expect(patch.url).toContain('/events/instance?'); expect(JSON.parse(String(patch.init?.body))).toEqual({ summary: 'Updated' }); expect(patch.init?.headers).toMatchObject({ 'If-Match': 'v1' });
  });
  it('cannot bypass the age check by moving draft end into the future', async () => {
    const requests = mockRemote(); const op = operation(); op.draft.end = '2027-01-01T00:00:00Z';
    await expect(updateSingleGoogleEvent('token', op, () => Date.parse('2026-09-21T00:00:00Z'))).rejects.toThrow('3 hours'); expect(requests.some((request) => request.init?.method === 'PATCH')).toBe(false);
  });
  it('blocks stale ETags and permission errors without writing', async () => {
    let requests = mockRemote({ ...event, etag: 'changed' }); await expect(updateSingleGoogleEvent('token', operation(), now)).rejects.toBeInstanceOf(GoogleEditConflict); expect(requests.some((request) => request.init?.method === 'PATCH')).toBe(false);
    requests = mockRemote(event, 'reader'); await expect(updateSingleGoogleEvent('token', operation(), now)).rejects.toThrow('not writable'); expect(requests.some((request) => request.init?.method === 'PATCH')).toBe(false);
  });
  it('recovers a lost response by reading back, including after the edit window', async () => {
    const requests = mockRemote({ ...event, etag: 'v2', summary: 'Updated' }); const op = { ...operation(), attempted: true };
    expect((await updateSingleGoogleEvent('token', op, () => Date.parse('2026-09-21T00:00:00Z'))).summary).toBe('Updated'); expect(requests.some((request) => request.init?.method === 'PATCH')).toBe(false);
  });
  it('handles concurrent write conflicts and invalid drafts', async () => {
    mockRemote(event, 'owner', 412); await expect(updateSingleGoogleEvent('token', operation(), now)).rejects.toBeInstanceOf(GoogleEditConflict);
    expect(() => googleEventChanges({ ...operation(), draft: { ...operation().draft, end: 'bad' } })).toThrow();
  });
});
