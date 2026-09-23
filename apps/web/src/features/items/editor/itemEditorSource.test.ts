import { describe, expect, it } from 'vitest';
import { createItem, createWorkspace, googleCalendarProjection } from '@utm/core';
import { googleActionItem } from './itemEditorSource';
import { normalizeItemForSave } from './itemEditorModel';
import { scheduleWithLinkedEnd } from '../../../utils/durations';

describe('Google action identity', () => {
  it('keeps the linked legacy nested template when clearing its end', () => {
    const workspace = createWorkspace();
    const source = createItem('Active range');
    source.role = 'series_template';
    source.occurrence = { seriesId: 'parent', recurrenceId: '2030-09-20T12:00:00Z', sequence: 0, templateRevision: 1 };
    source.schedule = { timezone: 'UTC', startAt: '2030-09-20T12:00:00Z', endAt: '2030-09-20T12:45:00Z', dueAt: '2030-09-24T12:00:00Z', estimatedDuration: 'PT45M' };
    source.external = { provider: 'google_calendar', connectionId: 'conn', calendarId: 'cal', eventId: 'event', sourceUrl: '', syncedAt: '2030-09-20T12:00:00Z', readOnly: false, startAt: source.schedule.startAt!, endAt: source.schedule.endAt! };
    const child = createItem('Old nested child');
    child.role = 'occurrence';
    child.occurrence = { ...source.occurrence, seriesId: source.id };
    workspace.items[source.id] = source; workspace.items[child.id] = child;
    const draft = structuredClone(googleCalendarProjection(source));
    draft.schedule = scheduleWithLinkedEnd(draft.schedule!, '');
    const normalized = normalizeItemForSave({ item: draft, workspace, tags: '', contexts: '', isTemplate: false, recurring: true, activeRange: true, repeatFrequency: 'WEEKLY', repeatIntervalDraft: '1', repeatDays: [] });
    const target = googleActionItem(workspace, normalized);
    expect(target.id).toBe(source.id);
    expect(Boolean(target.external && !normalized.schedule?.endAt)).toBe(true);
    expect(normalized.schedule?.estimatedDuration).toBe('PT45M');
    // After queuing deletion, subsequent action resolution must not select the child.
    delete normalized.external;
    normalized.extensions = { 'utm:googleSave': { kind: 'delete' } };
    workspace.items[source.id] = normalized;
    expect(googleActionItem(workspace, normalized).id).toBe(source.id);
    expect(googleCalendarProjection(normalized).schedule?.endAt).toBeUndefined();
  });

  it('still resolves an unlinked template to its live occurrence', () => {
    const workspace = createWorkspace(); const source = createItem('Series'); source.role = 'series_template';
    const child = createItem('Cycle'); child.occurrence = { seriesId: source.id, recurrenceId: '2030-01-01T00:00:00Z', sequence: 0, templateRevision: 1 };
    workspace.items[source.id] = source; workspace.items[child.id] = child;
    expect(googleActionItem(workspace, source).id).toBe(child.id);
  });
});
