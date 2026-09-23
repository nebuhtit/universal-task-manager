import { describe, expect, it } from 'vitest';
import { createItem, createWorkspace, inspectWorkspaceIntegrity } from './index.js';

describe('non-destructive semantic audit', () => {
  it('reports nested duplicate cycles without changing data or exposing titles', () => {
    const workspace = createWorkspace(); const root = createItem('Private title'); root.role = 'series_template';
    const nested = createItem('Private title'); nested.role = 'series_template'; nested.occurrence = { seriesId: root.id, recurrenceId: '2030-01-01T00:00:00Z', sequence: 0, templateRevision: 1 };
    const child = createItem('Private title'); child.role = 'occurrence'; child.occurrence = { ...nested.occurrence, seriesId: nested.id };
    workspace.items = { [root.id]: root, [nested.id]: nested, [child.id]: child };
    const before = JSON.stringify(workspace); const report = inspectWorkspaceIntegrity(workspace);
    expect(report.map(issue => issue.code)).toEqual(['nested-series', 'duplicate-cycle']);
    expect(JSON.stringify(report)).not.toContain('Private title'); expect(JSON.stringify(workspace)).toBe(before);
  });
  it('allows a standalone estimate and an explicitly queued detachment', () => {
    const workspace = createWorkspace(); const item = createItem('Estimate');
    item.schedule = { timezone: 'UTC', estimatedDuration: 'PT45M' }; workspace.items[item.id] = item;
    expect(inspectWorkspaceIntegrity(workspace)).toEqual([]);
    item.external = { provider: 'google_calendar', calendarId: 'calendar', connectionId: 'connection', eventId: 'event', readOnly: false, sourceUrl: '', syncedAt: '' };
    expect(inspectWorkspaceIntegrity(workspace)[0]?.code).toBe('linked-without-end');
    item.extensions = { 'utm:googleSave': { kind: 'delete' } };
    expect(inspectWorkspaceIntegrity(workspace)).toEqual([]);
  });
  it('terminates on cycles and reports missing parents', () => {
    const workspace = createWorkspace(); const item = createItem('Cycle');
    item.occurrence = { seriesId: item.id, recurrenceId: '2030-01-01T00:00:00Z', sequence: 0, templateRevision: 1 };
    workspace.items[item.id] = item;
    expect(inspectWorkspaceIntegrity(workspace)[0]?.code).toBe('cyclic-series');
    item.occurrence.seriesId = 'missing';
    expect(inspectWorkspaceIntegrity(workspace)[0]?.code).toBe('missing-series');
  });
});
