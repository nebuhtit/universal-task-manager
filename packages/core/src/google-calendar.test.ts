import { describe, expect, it } from 'vitest';
import { applyGoogleCalendarSync, createItem, createWorkspace, googleCalendarEventToItem, migrateWorkspace, validateWorkspace } from './index.js';

const syncedAt = '2026-08-31T12:00:00.000Z';

describe('Google Calendar workspace mirror', () => {
  it('maps timed and all-day events to immutable canonical items', () => {
    const timed = googleCalendarEventToItem({
      id: 'event-1', summary: 'Planning', description: 'Agenda', location: 'Room 4', htmlLink: 'https://calendar.google.com/event?eid=1',
      start: { dateTime: '2026-08-31T10:00:00+03:00', timeZone: 'Europe/Moscow' }, end: { dateTime: '2026-08-31T11:30:00+03:00' },
    }, 'primary', 'connection-1', syncedAt, 'UTC');
    expect(timed).toMatchObject({ title: 'Planning', location: 'Room 4', schedule: { timezone: 'Europe/Moscow', estimatedDuration: 'PT1H30M' }, external: { provider: 'google_calendar', readOnly: true } });

    const allDay = googleCalendarEventToItem({ id: 'event-2', start: { date: '2026-09-01' }, end: { date: '2026-09-03' } }, 'primary', 'connection-1', syncedAt, 'Europe/Moscow');
    expect(allDay).toMatchObject({ title: 'Busy', schedule: { allDay: true, timezone: 'Europe/Moscow', startAt: '2026-08-31T21:00:00.000Z', endAt: '2026-09-02T21:00:00.000Z', estimatedDuration: 'P2D' } });
  });

  it('updates deterministically and removes missing or cancelled events', () => {
    const workspace = createWorkspace('Google');
    const event = { id: 'event-1', summary: 'Planning', htmlLink: 'https://calendar.google.com/event?eid=1', start: { dateTime: '2026-08-31T10:00:00.000Z' }, end: { dateTime: '2026-08-31T11:00:00.000Z' } };
    expect(applyGoogleCalendarSync(workspace, { connectionId: 'connection-1', calendarId: 'primary', events: [event], syncedAt, fullSync: true })).toEqual({ added: 1, updated: 0, removed: 0 });
    const id = Object.keys(workspace.items).find((key) => key.startsWith('google:'))!;
    expect(applyGoogleCalendarSync(workspace, { connectionId: 'connection-1', calendarId: 'primary', events: [{ ...event, summary: 'Updated' }], syncedAt: '2026-08-31T12:05:00.000Z', fullSync: false })).toEqual({ added: 0, updated: 1, removed: 0 });
    expect(workspace.items[id]?.title).toBe('Updated');
    expect(applyGoogleCalendarSync(workspace, { connectionId: 'connection-1', calendarId: 'primary', events: [], syncedAt: '2026-08-31T12:10:00.000Z', fullSync: true }).removed).toBe(1);
    expect(workspace.items[id]).toBeUndefined();
  });

  it('migrates optional Google metadata without keeping malformed credentials or provenance', () => {
    const workspace = createWorkspace('Migration');
    const item = createItem('Foreign');
    (item as unknown as { external: unknown }).external = { provider: 'google_calendar', accessToken: 'must-not-survive' };
    workspace.items[item.id] = item;
    (workspace.calendarPreferences as unknown as { googleCalendar: unknown }).googleCalendar = {
      connectionId: 'connection-1', accessToken: 'secret', calendars: [{ id: 'primary', name: 'Main' }], syncTokens: { primary: 'sync-token' },
      syncWindow: { timeMin: '2025-08-31T12:00:00.000Z', timeMax: '2027-08-31T12:00:00.000Z', refreshedAt: '2026-08-31T12:00:00.000Z', unexpected: 'drop-me' },
    };
    const migrated = migrateWorkspace(workspace).value;
    expect(migrated.items[item.id]?.external).toBeUndefined();
    expect(migrated.items[item.id]?.extensions?.quarantine).toHaveProperty('external');
    expect(migrated.calendarPreferences.googleCalendar).toMatchObject({ connectionId: 'connection-1', calendars: [{ id: 'primary', name: 'Main', selected: true }], syncTokens: { primary: 'sync-token' } });
    expect(migrated.calendarPreferences.googleCalendar?.syncWindow).toEqual({ timeMin: '2025-08-31T12:00:00.000Z', timeMax: '2027-08-31T12:00:00.000Z', refreshedAt: '2026-08-31T12:00:00.000Z' });
    expect(migrated.calendarPreferences.googleCalendar).not.toHaveProperty('accessToken');
    expect(validateWorkspace(migrated).valid).toBe(true);
  });
});
