import { describe, expect, it } from 'vitest';
import { renameTagDefinition, deleteOrganizationDefinition } from './organization.js';
import { createWorkspace, createItem, ensureAreaDefinition, ensureProjectDefinition, googleWriteLimitReached, recordGoogleWrite, reconcileCalendarOrganization, migrateWorkspace, validateWorkspace, workspaceForExport, recordCompletionTransition } from './index.js';

function fixture() {
  const workspace = createWorkspace('Calendars');
  workspace.calendarPreferences.googleCalendar = { connectionId: 'connection', accountEmail: 'owner@example.com', calendars: [{ id: 'one', name: 'Work', selected: true, color: '#345678', areas: ['Office'], projects: ['Release'], tags: ['Focus'] }], syncTokens: {} };
  ensureAreaDefinition(workspace, 'Office'); ensureProjectDefinition(workspace, 'Release');
  const item = createItem('Meeting');
  item.areas = ['Personal'];
  item.external = { provider: 'google_calendar', connectionId: 'connection', calendarId: 'one', eventId: 'event', sourceUrl: 'https://calendar.google.com/event?eid=test', readOnly: false, syncedAt: new Date().toISOString() };
  workspace.items[item.id] = item;
  return { workspace, item, calendar: workspace.calendarPreferences.googleCalendar.calendars[0]! };
}
describe('Calendar organization and durable local data', () => {
  it('removes only the managed calendar tag when deletion is queued, even offline', () => {
    const { workspace, item } = fixture();
    reconcileCalendarOrganization(workspace);
    item.tags.push('Manual');
    delete item.external;
    item.extensions!['utm:googleSave'] = { kind: 'delete' };
    delete workspace.calendarPreferences.googleCalendar;
    reconcileCalendarOrganization(workspace);
    expect(item.tags).toEqual(['Manual']);
    expect(item.areas).toEqual(['Personal', 'Office']);
    expect(item.extensions!['utm:googleSave']).toEqual({ kind: 'delete' });
    reconcileCalendarOrganization(workspace);
    expect(item.tags).toEqual(['Manual']);
  });
  it('does not erase a calendar tag merely because a backup omits the external cache', () => {
    const { workspace, item } = fixture(); reconcileCalendarOrganization(workspace);
    delete item.external;
    reconcileCalendarOrganization(workspace);
    expect(item.tags).toEqual(['Focus']);
  });
  it('updates colors and names without losing manual memberships, then removes only automatic assignments', () => {
    const { workspace, item, calendar } = fixture();
    reconcileCalendarOrganization(workspace);
    expect(item.tags).toEqual(['Focus']); expect(item.areas).toEqual(['Personal', 'Office']); expect(item.projects).toEqual(['Release']);
    calendar.name = 'Team'; calendar.color = '#abcdef'; reconcileCalendarOrganization(workspace);
    expect(item.tags).toEqual(['Focus']); expect(workspace.organizationPreferences.tagAccents['Focus']).toBeUndefined();
    calendar.areas = []; calendar.projects = []; calendar.tags = []; reconcileCalendarOrganization(workspace);
    expect(item.areas).toEqual(['Personal']); expect(item.projects).toEqual([]);
    const validation = validateWorkspace(migrateWorkspace(workspace).value); expect(validation.valid, JSON.stringify(validation)).toBe(true);
  });
  it('preserves overlapping manual tags when the mapping is removed', () => {
    const { workspace, item, calendar } = fixture();
    item.tags = ['Focus', 'C.Manual'];
    reconcileCalendarOrganization(workspace);
    calendar.tags = [];
    reconcileCalendarOrganization(workspace);
    expect(item.tags).toEqual(['Focus', 'C.Manual']);
    expect(calendar.managedTag).toBeUndefined();
  });
  it('retires recorded legacy tags even without an external cache', () => {
    const { workspace, item, calendar } = fixture();
    calendar.managedTag = 'C.Work'; item.tags = ['C.Work', 'C.Manual'];
    workspace.organizationPreferences.tagOrder.push('C.Work');
    item.extensions = { 'utm:calendarOrganization': { calendarId: 'one', tag: 'C.Work', areas: [], projects: [] } };
    delete item.external;
    reconcileCalendarOrganization(workspace);
    expect(item.tags).toEqual(['C.Manual']);
    expect(workspace.organizationPreferences.tagOrder).not.toContain('C.Work');
    expect(calendar.managedTag).toBeUndefined();
  });
  it('does not rewrite every mirrored item when a sync changes nothing', () => {
    const { workspace, item } = fixture();
    reconcileCalendarOrganization(workspace);
    const before = { tags: item.tags, areas: item.areas, projects: item.projects, source: item.extensions?.['utm:calendarOrganization'], order: workspace.organizationPreferences.tagOrder };
    reconcileCalendarOrganization(workspace);
    expect(item.tags).toBe(before.tags);
    expect(item.areas).toBe(before.areas);
    expect(item.projects).toBe(before.projects);
    expect(item.extensions?.['utm:calendarOrganization']).toBe(before.source);
    expect(workspace.organizationPreferences.tagOrder).toBe(before.order);
  });
  it('keeps tag mappings in sync with renaming and deletion', () => {
    const { workspace, item, calendar } = fixture();
    reconcileCalendarOrganization(workspace);
    expect(renameTagDefinition(workspace, 'Focus', 'Deep work')).toBe(true);
    expect(calendar.tags).toEqual(['Deep work']);
    reconcileCalendarOrganization(workspace);
    expect(item.tags).toEqual(['Deep work']);
    deleteOrganizationDefinition(workspace, 'tag', 'Deep work');
    reconcileCalendarOrganization(workspace);
    expect(calendar.tags).toEqual([]);
    expect(item.tags).toEqual([]);
  });
  it('cleans legacy generated tags on workspace opening', () => {
    const { workspace, item, calendar } = fixture();
    calendar.managedTag = 'C.Work'; item.tags = ['C.Work', 'Manual'];
    const opened = migrateWorkspace(workspace).value;
    expect(opened.items[item.id]!.tags).toEqual(['Manual']);
    expect(opened.calendarPreferences.googleCalendar!.calendars[0]!.tags).toEqual(['Focus']);
  });
  it('removes managed tags and automatic PARA assignments while a calendar is inactive', () => {
    const { workspace, item, calendar } = fixture(); reconcileCalendarOrganization(workspace);
    calendar.selected = false; reconcileCalendarOrganization(workspace);
    expect(item.tags).not.toContain('Focus'); expect(item.areas).toEqual(['Personal']); expect(item.projects).toEqual([]);
    expect(calendar.areas).toEqual(['Office']); expect(calendar.projects).toEqual(['Release']);
    expect(item.extensions?.['utm:calendarOrganization']).toBeUndefined();
    expect(workspace.organizationPreferences.tagOrder).toContain('Focus');
    calendar.selected = true; reconcileCalendarOrganization(workspace);
    expect(item.tags).toContain('Focus'); expect(item.areas).toEqual(['Personal', 'Office']); expect(item.projects).toEqual(['Release']);
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
