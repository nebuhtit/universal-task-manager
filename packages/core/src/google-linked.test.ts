import { describe, expect, it } from 'vitest';
import { createItem, createWorkspace } from './types.js';
import { applyGoogleCalendarSync, detachGoogleCalendar, googleCalendarProjection, mergeGoogleCalendarCopies } from './google-calendar.js';
import { createViewTimeMetricsAccumulator, viewPeriodBoundsForDates } from './view-statistics.js';
import { migrateWorkspace, validateWorkspace } from './schema.js';
import { workspaceForExport } from './export-privacy.js';
import { makeSeries, reconcileRecurrences } from './recurrence.js';

const event = { id: 'remote', summary: 'Google title', start: { dateTime: '2026-09-20T12:00:00Z' }, end: { dateTime: '2026-09-20T13:00:00Z' }, etag: 'v1' };
function fixture() {
  const workspace = createWorkspace('Linked'); const item = createItem('UTM title');
  item.schedule = { timezone: 'UTC', dueAt: '2026-09-21T10:00:00Z', estimatedDuration: 'PT20M' };
  item.tags = ['Important']; item.projects = ['Work']; item.state = 'done';
  item.actualTimeEntries = [{ id: 'time', durationSeconds: 600, source: 'manual', comment: 'Keep' }];
  item.completionEntries = [{ id: 'done', at: '2026-09-20T10:00:00Z', kind: 'manual', comment: 'Keep' }];
  item.extensions = { 'utm:googleCreate': { eventId: event.id, calendarId: 'calendar', accountEmail: 'me' } };
  workspace.items[item.id] = item;
  return { workspace, item, batch: { calendarId: 'calendar', connectionId: 'connection', events: [event], syncedAt: '2026-09-20T10:00:00Z', fullSync: false } };
}
describe('linked UTM and Google items', () => {
  it('keeps a link on the current cycle but never inherits it into the next cycle', () => {
    const { workspace, item, batch } = fixture();
    item.state = 'open'; item.schedule!.dueAt = '2026-09-20T12:00:00Z';
    delete item.extensions!['utm:googleCreate'];
    const series = makeSeries(item, 'FREQ=DAILY', { activationOffset: 'PT0S' });
    workspace.items[item.id] = series;
    reconcileRecurrences(workspace, new Date('2026-09-20T12:30:00Z'));
    const cycle = Object.values(workspace.items).find((entry) => entry.role === 'occurrence')!;
    cycle.extensions = { 'utm:googleCreate': { eventId: event.id, calendarId: 'calendar', accountEmail: 'me' } };
    applyGoogleCalendarSync(workspace, batch);
    expect(cycle.external?.readOnly).toBe(false);
    series.revision += 1;
    reconcileRecurrences(workspace, new Date('2026-09-20T12:40:00Z'));
    expect(workspace.items[cycle.id]?.external?.readOnly).toBe(false);
    reconcileRecurrences(workspace, new Date('2026-09-21T12:40:00Z'));
    expect(workspace.items[cycle.id]?.external).toBeUndefined();
    expect(workspace.items[cycle.id]?.extensions?.['utm:googleCreate']).toBeUndefined();
  });
  it('keeps one identity, preserves UTM data and uses calendar interval only for occupancy', () => {
    const { workspace, item, batch } = fixture(); applyGoogleCalendarSync(workspace, batch);
    expect(Object.keys(workspace.items)).toEqual([item.id]);
    expect(item.external?.readOnly).toBe(false); expect(item.title).toBe('Google title'); expect(item.tags).toEqual(['Important']);
    expect(item.schedule?.estimatedDuration).toBe('PT20M'); expect(item.schedule?.startAt).toBe('2026-09-20T12:00:00.000Z'); expect(item.completionEntries).toHaveLength(1);
    const accumulator = createViewTimeMetricsAccumulator(viewPeriodBoundsForDates('2026-09-20', '2026-09-20', 'UTC'));
    accumulator.add(item); accumulator.add(item); const metrics = accumulator.finish();
    expect(metrics.completedItems).toBe(1); expect(metrics.actualDurationMs).toBe(600000); expect(metrics.completionPercent).toBe(100);
    expect(metrics.freeDurationMs).toBe(23 * 3600000);
    expect(Date.parse(googleCalendarProjection(item).schedule!.startAt!)).toBe(Date.parse(event.start.dateTime));
  });
  it('imports UTM travel metadata, preserves it when Google omits the key, and clears it explicitly', () => {
    const { workspace, item, batch } = fixture(); item.schedule!.travelDuration = 'PT10M';
    applyGoogleCalendarSync(workspace, { ...batch, events: [{ ...event, extendedProperties: { private: { utmTravelDuration: 'PT25M' } } }] });
    expect(item.schedule?.travelDuration).toBe('PT25M');
    applyGoogleCalendarSync(workspace, { ...batch, events: [{ ...event, etag: 'v2' }] });
    expect(item.schedule?.travelDuration).toBe('PT25M');
    applyGoogleCalendarSync(workspace, { ...batch, events: [{ ...event, etag: 'v3', extendedProperties: { private: { utmTravelDuration: '' } } }] });
    expect(item.schedule?.travelDuration).toBeUndefined();
  });
  it('updates the link without resetting completion, comments or estimate; detach and export keep task', () => {
    const { workspace, item, batch } = fixture(); applyGoogleCalendarSync(workspace, batch);
    applyGoogleCalendarSync(workspace, { ...batch, events: [{ ...event, etag: 'v2', end: { dateTime: '2026-09-20T14:00:00Z' } }] });
    expect(item.external?.endAt).toBe('2026-09-20T14:00:00.000Z'); expect(item.state).toBe('done'); expect(item.actualTimeEntries?.[0]?.comment).toBe('Keep');
    expect(validateWorkspace(workspace).valid).toBe(true);
    const exported = workspaceForExport(workspace); expect(exported.items[item.id]?.title).toBe('Google title'); expect(exported.items[item.id]?.external).toBeUndefined();
    detachGoogleCalendar(item); expect(workspace.items[item.id]?.completionEntries).toHaveLength(1); expect(item.external).toBeUndefined();
  });
  it('migrates existing pairs exactly, merges journals and never matches names', () => {
    const { workspace, item, batch } = fixture(); const operation = item.extensions!['utm:googleCreate']; delete item.extensions!['utm:googleCreate'];
    applyGoogleCalendarSync(workspace, batch); expect(Object.keys(workspace.items)).toHaveLength(2);
    item.title = 'Google title'; mergeGoogleCalendarCopies(workspace); expect(Object.keys(workspace.items)).toHaveLength(2);
    item.extensions!['utm:googleCreate'] = operation;
    const migrated = migrateWorkspace(workspace).value;
    expect(Object.keys(migrated.items)).toEqual([item.id]); expect(migrated.items[item.id]?.schedule?.estimatedDuration).toBe('PT20M');
  });
  it('never deletes a UTM task for a missing or cancelled Google event', () => {
    const { workspace, item, batch } = fixture(); applyGoogleCalendarSync(workspace, batch);
    applyGoogleCalendarSync(workspace, { ...batch, events: [], fullSync: true }); expect(workspace.items[item.id]).toBeDefined();
    applyGoogleCalendarSync(workspace, { ...batch, events: [{ ...event, status: 'cancelled' }] });
    expect(workspace.items[item.id]?.external).toBeUndefined(); expect(item.state).toBe('done');
  });
  it('reattaches an exported task by opaque link key without creating a second item', () => {
    const { workspace, item, batch } = fixture();
    const events = [{ ...event, localHistoryKey: 'a'.repeat(64) }];
    applyGoogleCalendarSync(workspace, { ...batch, events });
    const restored = workspaceForExport(workspace);
    expect(restored.items[item.id]?.external).toBeUndefined();
    applyGoogleCalendarSync(restored, { ...batch, events });
    expect(Object.keys(restored.items)).toEqual([item.id]);
    expect(restored.items[item.id]?.external?.readOnly).toBe(false);
  });
});
