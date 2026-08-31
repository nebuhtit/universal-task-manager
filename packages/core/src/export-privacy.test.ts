import { describe, expect, it } from 'vitest';
import { createItem, createWorkspace } from './types.js';
import { googleCalendarEventToItem } from './google-calendar.js';
import { workspaceForExport } from './export-privacy.js';
import { createPortablePackage, serializePortablePackage } from './portability.js';
import { toCanonicalJSON, toICS } from './interop.js';

describe('Google Calendar export privacy', () => {
  it('removes external events, connection state and their references from every core export', () => {
    const workspace = createWorkspace('Private export');
    const google = googleCalendarEventToItem({
      id: 'private-event-id', summary: 'PRIVATE GOOGLE EVENT', description: 'PRIVATE GOOGLE DESCRIPTION',
      location: 'PRIVATE GOOGLE LOCATION', htmlLink: 'https://calendar.google.com/private-link',
      start: { dateTime: '2026-08-31T10:00:00.000Z' }, end: { dateTime: '2026-08-31T11:00:00.000Z' },
    }, 'private-account@example.com', 'private-connection', '2026-08-31T09:00:00.000Z')!;
    const normal = createItem('Ordinary task');
    normal.relations = [{ id: 'relation', type: 'related', targetId: google.id }];
    normal.custom = { linked: google.id };
    workspace.items[google.id] = google;
    workspace.items[normal.id] = normal;
    workspace.tombstones['google:old-calendar:old-event'] = '2026-08-31T09:00:00.000Z';
    workspace.calendarPreferences.googleCalendar = {
      connectionId: 'private-connection', accountEmail: 'private-account@example.com',
      calendars: [{ id: 'private-account@example.com', name: 'Private calendar', selected: true }],
      syncTokens: { 'private-account@example.com': 'private-sync-token' },
    };
    const view = Object.values(workspace.views)[0]!;
    view.statistics = { showTime: true, reservedItemIds: [google.id] };
    view.extensions = { 'utm:manualOrder': [google.id, normal.id] };

    const safe = workspaceForExport(workspace);
    expect(safe.items[google.id]).toBeUndefined();
    expect(safe.items[normal.id]?.relations).toEqual([]);
    expect(safe.items[normal.id]?.custom).toEqual({});
    expect(safe.calendarPreferences.googleCalendar).toBeUndefined();
    expect(view.id && safe.views[view.id]?.statistics?.reservedItemIds).toEqual([]);
    expect(safe.views[view.id]?.extensions?.['utm:manualOrder']).toEqual([normal.id]);

    const portable = serializePortablePackage(createPortablePackage(workspace, {
      kind: 'items', items: [google, normal], dependencyItemIds: [google.id, normal.id], selection: { type: 'all_items' },
    }));
    expect(portable).toContain('Ordinary task');
    const outputs = [JSON.stringify(safe), portable, toCanonicalJSON(workspace), toICS(workspace, { includeUtmMetadata: true }).ics];
    for (const output of outputs) {
      expect(output).not.toContain('PRIVATE GOOGLE');
      expect(output).not.toContain('private-account@example.com');
      expect(output).not.toContain('private-event-id');
      expect(output).not.toContain('private-sync-token');
    }
  });
});
