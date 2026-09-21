import { describe, expect, it } from 'vitest';
import { createWorkspace, createItem, ensureAreaDefinition, ensureProjectDefinition, googleWriteLimitReached, recordGoogleWrite, reconcileCalendarOrganization, migrateWorkspace, validateWorkspace, workspaceForExport, recordCompletionTransition } from './index.js';

function fixture() {
  const workspace = createWorkspace('Calendars');
  workspace.calendarPreferences.googleCalendar = { connectionId: 'connection', accountEmail: 'owner@example.com', calendars: [{ id: 'one', name: 'Work', selected: true, color: '#345678', areas: ['Office'], projects: ['Release'] }], syncTokens: {} };
  ensureAreaDefinition(workspace, 'Office'); ensureProjectDefinition(workspace, 'Release');
  const item = createItem('Meeting');
  item.areas = ['Personal'];
  item.external = { provider: 'google_calendar', connectionId: 'connection', calendarId: 'one', eventId: 'event', sourceUrl: 'https://calendar.google.com/event?eid=test', readOnly: false, syncedAt: new Date().toISOString() };
  workspace.items[item.id] = item;
  return { workspace, item, calendar: workspace.calendarPreferences.googleCalendar.calendars[0]! };
}
describe('Calendar organization and durable local data', () => {
  it('updates colors and names without losing manual memberships, then removes only automatic assignments', () => {
    const { workspace, item, calendar } = fixture();
    reconcileCalendarOrganization(workspace);
    expect(item.tags).toEqual(['C.Work']); expect(item.areas).toEqual(['Personal', 'Office']); expect(item.projects).toEqual(['Release']);
    calendar.name = 'Team'; calendar.color = '#abcdef'; reconcileCalendarOrganization(workspace);
    expect(item.tags).toEqual(['C.Team']); expect(workspace.organizationPreferences.tagAccents['C.Team']).toBe('#abcdef');
    calendar.areas = []; calendar.projects = []; reconcileCalendarOrganization(workspace);
    expect(item.areas).toEqual(['Personal']); expect(item.projects).toEqual([]);
    const validation = validateWorkspace(migrateWorkspace(workspace).value); expect(validation.valid, JSON.stringify(validation)).toBe(true);
  });
  it('keeps manual assignments that overlap the calendar and distinguishes colliding tags', () => {
    const { workspace, item, calendar } = fixture(); item.areas.push('Office'); item.tags.push('C.Work');
    workspace.calendarPreferences.googleCalendar!.calendars.push({ id: 'two', name: 'Work', selected: true });
    reconcileCalendarOrganization(workspace); const tag = calendar.managedTag;
    expect(tag).toBe('C.Work (2)'); expect(workspace.calendarPreferences.googleCalendar!.calendars[1]!.managedTag).toBe('C.Work (3)');
    reconcileCalendarOrganization(workspace); expect(calendar.managedTag).toBe(tag);
    calendar.areas = []; reconcileCalendarOrganization(workspace); expect(item.areas).toContain('Office');
  });
  it('removes managed tags and automatic PARA assignments while a calendar is inactive', () => {
    const { workspace, item, calendar } = fixture(); reconcileCalendarOrganization(workspace);
    calendar.selected = false; reconcileCalendarOrganization(workspace);
    expect(item.tags).not.toContain('C.Work'); expect(item.areas).toEqual(['Personal']); expect(item.projects).toEqual([]);
    expect(calendar.areas).toEqual(['Office']); expect(calendar.projects).toEqual(['Release']);
    expect(item.extensions?.['utm:calendarOrganization']).toBeUndefined();
    expect(workspace.organizationPreferences.tagOrder).not.toContain('C.Work');
    calendar.selected = true; reconcileCalendarOrganization(workspace);
    expect(item.tags).toContain('C.Work'); expect(item.areas).toEqual(['Personal', 'Office']); expect(item.projects).toEqual(['Release']);
  });
  it('counts only successful writes from the rolling 24-hour safety window', () => {
    const { workspace } = fixture(); const google = workspace.calendarPreferences.googleCalendar!;
    google.writeDailyLimit = 2; google.writeTimestamps = ['2026-09-19T11:00:00.000Z', '2026-09-20T12:00:00.000Z'];
    expect(googleWriteLimitReached(google, Date.parse('2026-09-21T11:59:00.000Z'))).toBe(false);
    recordGoogleWrite(google, new Date('2026-09-21T11:59:00.000Z'));
    expect(googleWriteLimitReached(google, Date.parse('2026-09-21T12:00:00.000Z'))).toBe(true);
  });
  it('exports the local item and pending operation, but no injected access token', () => {
    const { workspace, item } = fixture();
    item.extensions = { 'utm:googleSave': { kind: 'create', calendarId: 'one', destination: 'one', accountEmail: 'owner@example.com', eventId: 'stable-id', accessToken: 'SECRET', draft: { title: 'Meeting', start: '2030-01-01T12:00:00Z', end: '2030-01-01T13:00:00Z', allDay: false, timeZone: 'UTC', busy: true, description: '', location: '' } } };
    const backup = workspaceForExport(workspace);
    expect(backup.items[item.id]!.extensions!['utm:googleSave']).toMatchObject({ eventId: 'stable-id' });
    expect(JSON.stringify(backup)).not.toContain('SECRET'); expect(backup.items[item.id]!.external).toBeUndefined();
  });
  it('links actual time to completion without changing expected duration', () => {
    const { item } = fixture(); delete item.external;
    item.schedule = { timezone: 'UTC', estimatedDuration: 'PT1H' };
    item.actualTimeEntries = [{ id: 'time', durationSeconds: 600, comment: '', source: 'manual' }];
    item.state = 'done'; recordCompletionTransition(item, 'open', '2030-01-01T12:00:00Z');
    expect(item.actualTimeEntries[0]!.completionId).toBe(item.completionEntries![0]!.id);
    expect(item.schedule.estimatedDuration).toBe('PT1H');
  });
});
