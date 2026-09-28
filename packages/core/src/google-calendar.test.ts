import { describe, expect, it } from 'vitest';
import { applyGoogleCalendarSync, createItem, createWorkspace, googleCalendarEventToItem, migrateWorkspace, projectOccurrences, validateWorkspace, type GoogleCalendarEvent } from './index.js';

const syncedAt = '2026-08-31T12:00:00.000Z';

describe('Google Calendar workspace mirror', () => {
  it('indexes recurrence identity once instead of scanning the workspace per instance', () => {
    const workspace = createWorkspace();
    const series = createItem('Synthetic series'); series.role = 'series_template';
    series.schedule = { timezone: 'UTC', startAt: '2030-01-01T10:00:00Z', endAt: '2030-01-01T11:00:00Z' };
    series.recurrence = { rrule: 'FREQ=DAILY', timezone: 'UTC', anchor: 'schedule', autoRenew: true, closeAt: 'next_activation', rdates: [], exdates: [] };
    series.external = { provider: 'google_calendar', connectionId: 'c', calendarId: 'cal', eventId: 'master', readOnly: false, sourceUrl: '', syncedAt };
    workspace.items = { [series.id]: series };
    let scans = 0;
    workspace.items = new Proxy(workspace.items, { ownKeys(target) { scans++; return Reflect.ownKeys(target); } });
    const events = Array.from({ length: 100 }, (_, n) => {
      const start = new Date(Date.UTC(2030, 0, n + 1, 10)).toISOString();
      return { id: `instance-${n}`, summary: `Cycle ${n}`, recurringEventId: 'master', originalStartTime: { dateTime: start }, start: { dateTime: start }, end: { dateTime: new Date(Date.parse(start) + 3600000).toISOString() } };
    });
    applyGoogleCalendarSync(workspace, { connectionId: 'c', calendarId: 'cal', syncedAt, fullSync: false, events });
    expect(scans).toBeLessThan(30);
    expect(Object.values(workspace.items).filter(item => item.role === 'occurrence')).toHaveLength(100);
  });

  it('keeps cancelled recurring instances compact instead of materializing deleted cycles', () => {
    const workspace = createWorkspace('Compact cancellations');
    const series = createItem('Weekly'); series.role = 'series_template';
    series.schedule = { timezone: 'UTC', startAt: '2030-01-06T10:00:00Z', endAt: '2030-01-06T11:00:00Z' };
    series.recurrence = { rrule: 'FREQ=WEEKLY;INTERVAL=1', timezone: 'UTC', anchor: 'schedule', autoRenew: true, closeAt: 'next_activation', rdates: [], exdates: [] };
    series.external = { provider: 'google_calendar', connectionId: 'c', calendarId: 'cal', eventId: 'master', readOnly: false, sourceUrl: '', syncedAt };
    workspace.items[series.id] = series;
    const cancelled = Array.from({ length: 52 }, (_, index) => {
      const start = new Date(Date.UTC(2030, 0, 6 + index * 7, 10)).toISOString();
      return { id: `cancelled-${index}`, status: 'cancelled', recurringEventId: 'master', originalStartTime: { dateTime: start }, start: { dateTime: start }, end: { dateTime: new Date(Date.parse(start) + 3_600_000).toISOString() } };
    });
    applyGoogleCalendarSync(workspace, { connectionId: 'c', calendarId: 'cal', syncedAt, fullSync: false, events: cancelled });
    expect(Object.values(workspace.items).filter(item => item.role === 'occurrence')).toHaveLength(0);
    expect(series.recurrence.exdates).toHaveLength(52);
    expect(Object.keys(workspace.tombstones)).toHaveLength(0);
  });

  it('ignores cancelled instances when their recurring master was also cancelled', () => {
    const workspace = createWorkspace('Deleted master');
    const series = createItem('Moved weekly'); series.role = 'series_template';
    series.schedule = { timezone: 'UTC', startAt: '2030-01-06T10:00:00Z', endAt: '2030-01-06T11:00:00Z' };
    series.recurrence = { rrule: 'FREQ=WEEKLY;INTERVAL=1', timezone: 'UTC', anchor: 'schedule', autoRenew: true, closeAt: 'next_activation', rdates: [], exdates: [] };
    series.external = { provider: 'google_calendar', connectionId: 'c', calendarId: 'cal', eventId: 'master', readOnly: false, sourceUrl: '', syncedAt };
    workspace.items[series.id] = series;
    const start = '2030-01-06T10:00:00.000Z';
    applyGoogleCalendarSync(workspace, { connectionId: 'c', calendarId: 'cal', syncedAt, fullSync: false, events: [
      { id: 'cancelled-cycle', status: 'cancelled', recurringEventId: 'master', originalStartTime: { dateTime: start }, start: { dateTime: start }, end: { dateTime: '2030-01-06T11:00:00.000Z' } },
      { id: 'master', status: 'cancelled', start: { dateTime: start }, end: { dateTime: '2030-01-06T11:00:00.000Z' } },
    ] });
    expect(Object.values(workspace.items).filter(item => item.role === 'occurrence')).toHaveLength(0);
    expect(series.recurrence.exdates).toEqual([]);
  });
  it('maps timed and all-day events to immutable canonical items', () => {
    const timed = googleCalendarEventToItem({
      id: 'event-1', summary: 'Planning', description: 'Agenda', location: 'Room 4', htmlLink: 'https://calendar.google.com/event?eid=1',
      start: { dateTime: '2026-08-31T10:00:00+03:00', timeZone: 'Europe/Moscow' }, end: { dateTime: '2026-08-31T11:30:00+03:00' },
    }, 'primary', 'connection-1', syncedAt, 'UTC');
    expect(timed).toMatchObject({ title: 'Planning', location: 'Room 4', schedule: { timezone: 'Europe/Moscow', estimatedDuration: 'PT1H30M' }, external: { provider: 'google_calendar', readOnly: true } });

    const allDay = googleCalendarEventToItem({ id: 'event-2', start: { date: '2026-09-01' }, end: { date: '2026-09-03' } }, 'primary', 'connection-1', syncedAt, 'Europe/Moscow');
    expect(allDay).toMatchObject({ title: 'Busy', schedule: { allDay: true, timezone: 'Europe/Moscow', startAt: '2026-08-31T21:00:00.000Z', endAt: '2026-09-02T21:00:00.000Z', estimatedDuration: 'P2D' } });
  });

  it('repairs a recurring interval mistaken for event duration', () => {
    const recurring = googleCalendarEventToItem({
      id: 'weekly_20260923', recurringEventId: 'weekly', summary: 'Family meeting',
      start: { dateTime: '2026-09-23T19:30:00+03:00', timeZone: 'Europe/Moscow' },
      end: { dateTime: '2026-09-30T19:30:00+03:00' }, seriesDurationMilliseconds: 105 * 60_000,
    }, 'primary', 'connection-1', syncedAt, 'UTC');
    expect(recurring?.schedule).toMatchObject({ endAt: '2026-09-23T18:15:00.000Z', estimatedDuration: 'PT1H45M' });
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

  it('does not rewrite an unchanged event with the same Google etag', () => {
    const workspace = createWorkspace('Google unchanged');
    const event = { id: 'same-event', etag: 'etag-1', summary: 'Stable', updated: '2026-08-31T12:00:00.000Z', start: { dateTime: '2026-09-07T15:00:00.000Z' }, end: { dateTime: '2026-09-07T16:00:00.000Z' } };
    expect(applyGoogleCalendarSync(workspace, { connectionId: 'connection-1', calendarId: 'primary', events: [event], syncedAt: '2026-09-07T12:00:00.000Z', fullSync: true })).toEqual({ added: 1, updated: 0, removed: 0 });
    const before = structuredClone(workspace.items['google:primary:same-event']);

    expect(applyGoogleCalendarSync(workspace, { connectionId: 'connection-1', calendarId: 'primary', events: [event], syncedAt: '2026-09-07T12:05:00.000Z', fullSync: true })).toEqual({ added: 0, updated: 0, removed: 0 });
    expect(workspace.items['google:primary:same-event']).toEqual(before);
  });

  it('does not recreate a Google mirror while its linked UTM item is queued for deletion', () => {
    const workspace = createWorkspace('Pending deletion');
    const item = createItem('Local range');
    item.extensions = { 'utm:googleSave': { kind: 'delete', calendarId: 'primary', eventId: 'event-1', accountEmail: 'owner@example.com' } };
    workspace.items[item.id] = item;
    const event = { id: 'event-1', summary: 'Old event', start: { dateTime: '2026-08-31T10:00:00Z' }, end: { dateTime: '2026-08-31T11:00:00Z' } };
    applyGoogleCalendarSync(workspace, { connectionId: 'connection-1', calendarId: 'primary', events: [event], syncedAt, fullSync: true });
    expect(Object.values(workspace.items)).toEqual([item]);
  });

  it('repairs an already mirrored recurring item even when its Google etag is unchanged', () => {
    const workspace = createWorkspace('Google repair');
    const event = {
      id: 'weekly_20260923', recurringEventId: 'weekly', etag: 'etag-1', summary: 'Family meeting',
      start: { dateTime: '2026-09-23T19:30:00+03:00' }, end: { dateTime: '2026-09-30T19:30:00+03:00' },
    };
    applyGoogleCalendarSync(workspace, { connectionId: 'connection-1', calendarId: 'primary', events: [event], syncedAt, fullSync: true });
    expect(workspace.items['google:primary:weekly_20260923']?.schedule.estimatedDuration).toBe('P7D');

    const repaired = applyGoogleCalendarSync(workspace, {
      connectionId: 'connection-1', calendarId: 'primary',
      events: [{ ...event, seriesDurationMilliseconds: 105 * 60_000 }], syncedAt, fullSync: true,
    });

    expect(repaired).toMatchObject({ updated: 1 });
    expect(workspace.items['google:primary:weekly_20260923']?.schedule.estimatedDuration).toBe('PT1H45M');
  });

  it('repairs a stale deletion receipt and tombstone for an active writable series', () => {
    const workspace = createWorkspace('Recovered series');
    workspace.calendarPreferences.googleCalendar = {
      connectionId: 'connection', accountEmail: 'owner@example.invalid',
      calendars: [{ id: 'calendar', name: 'Calendar', selected: true }], syncTokens: {},
    };
    const series = createItem('Weekly');
    series.role = 'series_template';
    series.schedule = { timezone: 'UTC', startAt: '2026-10-04T08:00:00Z', endAt: '2026-10-04T09:30:00Z' };
    series.recurrence = { rrule: 'FREQ=WEEKLY;INTERVAL=1', timezone: 'UTC', anchor: 'schedule', closeAt: 'next_activation', autoRenew: true, rdates: [], exdates: [] };
    series.external = { provider: 'google_calendar', connectionId: 'connection', calendarId: 'calendar', eventId: 'master', sourceUrl: '', readOnly: false, syncedAt: '' };
    series.extensions = { 'utm:googleDeletionReceipts': [{ accountEmail: 'owner@example.invalid', calendarId: 'calendar', eventId: 'master', deletedAt: '2026-09-28T10:15:05Z' }] };
    workspace.items[series.id] = series;
    workspace.tombstones[series.id] = '2026-09-28T10:15:05Z';
    applyGoogleCalendarSync(workspace, {
      connectionId: 'connection', calendarId: 'calendar', syncedAt: '2026-09-28T11:30:30Z', fullSync: false,
      events: [{ id: 'master', status: 'confirmed', summary: 'Weekly', recurrence: ['RRULE:FREQ=WEEKLY;INTERVAL=1'], start: { dateTime: '2026-10-04T08:00:00Z' }, end: { dateTime: '2026-10-04T09:30:00Z' } }],
    });
    expect(workspace.tombstones[series.id]).toBeUndefined();
    expect(series.extensions?.['utm:googleDeletionReceipts']).toBeUndefined();
    expect(series.external?.eventId).toBe('master');
  });

  it('relinks a recreated master in its destination calendar without reviving the deleted source copy', () => {
    const workspace = createWorkspace('Moved recurring series');
    workspace.calendarPreferences.googleCalendar = {
      connectionId: 'connection', accountEmail: 'owner@example.invalid',
      calendars: [{ id: 'source', name: 'Source', selected: true }, { id: 'destination', name: 'Destination', selected: true }], syncTokens: {},
    };
    const series = createItem('Moved weekly');
    series.role = 'series_template';
    series.schedule = { timezone: 'UTC', startAt: '2026-10-04T08:00:00Z', endAt: '2026-10-04T09:00:00Z' };
    series.recurrence = { rrule: 'FREQ=WEEKLY;INTERVAL=1', timezone: 'UTC', anchor: 'schedule', closeAt: 'next_activation', autoRenew: true, rdates: [], exdates: [] };
    const master: GoogleCalendarEvent = { id: 'utm-master', status: 'confirmed', summary: series.title, recurrence: ['RRULE:FREQ=WEEKLY;INTERVAL=1'], start: { dateTime: series.schedule.startAt }, end: { dateTime: series.schedule.endAt } };
    series.extensions = {
      'utm:calendarOrganization': { calendarId: 'destination', areas: [], projects: [], tags: [] },
      'utm:googleSeriesEvent': master,
      'utm:googleDeletionReceipts': [{ accountEmail: 'owner@example.invalid', calendarId: 'source', eventId: master.id, deletedAt: '2026-09-28T11:42:06Z' }],
    };
    workspace.items[series.id] = series;
    workspace.tombstones[series.id] = '2026-09-28T11:42:06Z';
    applyGoogleCalendarSync(workspace, { connectionId: 'connection', calendarId: 'source', syncedAt, fullSync: false, events: [{ ...master, status: 'cancelled' }] });
    applyGoogleCalendarSync(workspace, { connectionId: 'connection', calendarId: 'destination', syncedAt, fullSync: false, events: [master] });
    expect(workspace.tombstones[series.id]).toBeUndefined();
    expect(series.external).toMatchObject({ calendarId: 'destination', eventId: master.id, readOnly: false });
    expect(series.extensions?.['utm:googleDeletionReceipts']).toEqual([expect.objectContaining({ calendarId: 'source', eventId: master.id })]);
    expect(Object.values(workspace.items).filter(item => item.external?.readOnly)).toHaveLength(0);
    expect(projectOccurrences(workspace, new Date('2026-10-04T00:00:00Z'), new Date('2026-10-05T00:00:00Z')))
      .toEqual(expect.arrayContaining([expect.objectContaining({ sourceItemId: series.id, seriesId: series.id })]));
  });

  it('scopes acknowledged deletions to the account and exact event identity', () => {
    const workspace = createWorkspace('Acknowledged deletion');
    workspace.calendarPreferences.googleCalendar = { connectionId: 'connection-1', accountEmail: 'owner@example.invalid', calendars: [], syncTokens: {} };
    const item = createItem('Local task');
    item.extensions = { 'utm:googleDeletionReceipts': [{ calendarId: 'primary', eventId: 'removed', accountEmail: 'owner@example.invalid', deletedAt: syncedAt }] };
    workspace.items[item.id] = item;
    const event = { id: 'removed', start: { dateTime: '2026-08-31T10:00:00Z' }, end: { dateTime: '2026-08-31T11:00:00Z' } };
    const batch = { connectionId: 'connection-1', calendarId: 'primary', events: [event, { ...event, id: 'unrelated' }], syncedAt, fullSync: false };
    applyGoogleCalendarSync(workspace, batch);
    expect(workspace.items['google:primary:removed']).toBeUndefined();
    expect(workspace.items['google:primary:unrelated']).toBeDefined();
    workspace.calendarPreferences.googleCalendar.accountEmail = 'another@example.invalid';
    applyGoogleCalendarSync(workspace, batch);
    expect(workspace.items['google:primary:removed']).toBeDefined();
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
