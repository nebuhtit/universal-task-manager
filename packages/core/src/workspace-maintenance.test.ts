import { describe, expect, it } from 'vitest';
import { createItem, createOccurrence, createWorkspace, pruneTechnicalDeletedOccurrences } from './index.js';

describe('workspace maintenance', () => {
  it('removes empty deleted generated cycles but retains their tombstones', () => {
    const workspace = createWorkspace('Cleanup');
    const series = createItem('Weekly');
    series.role = 'series_template';
    series.schedule = { timezone: 'UTC', startAt: '2030-01-06T10:00:00Z', endAt: '2030-01-06T11:00:00Z' };
    series.recurrence = { rrule: 'FREQ=WEEKLY', timezone: 'UTC', anchor: 'schedule', autoRenew: true, closeAt: 'next_activation', rdates: [], exdates: [] };
    const cycle = createOccurrence(series, new Date('2034-12-31T10:00:00Z'), 260);
    cycle.deletedAt = '2030-01-01T00:00:00Z';
    workspace.items[series.id] = series; workspace.items[cycle.id] = cycle;
    workspace.tombstones[cycle.id] = cycle.deletedAt;
    expect(pruneTechnicalDeletedOccurrences(workspace)).toBe(1);
    expect(workspace.items[cycle.id]).toBeUndefined();
    expect(workspace.tombstones[cycle.id]).toBe(cycle.deletedAt);
  });

  it('retains completed, edited, or otherwise historical deleted cycles', () => {
    const workspace = createWorkspace('Preserve history');
    const series = createItem('Weekly');
    series.role = 'series_template';
    series.schedule = { timezone: 'UTC', startAt: '2030-01-06T10:00:00Z', endAt: '2030-01-06T11:00:00Z' };
    series.recurrence = { rrule: 'FREQ=WEEKLY', timezone: 'UTC', anchor: 'schedule', autoRenew: true, closeAt: 'next_activation', rdates: [], exdates: [] };
    const completed = createOccurrence(series, new Date('2030-01-13T10:00:00Z'), 1);
    completed.deletedAt = '2030-01-14T00:00:00Z'; completed.state = 'done'; completed.completionEntries = [{ id: 'done', at: '2030-01-13T11:00:00Z', kind: 'manual' }];
    const edited = createOccurrence(series, new Date('2030-01-20T10:00:00Z'), 2);
    edited.deletedAt = '2030-01-21T00:00:00Z'; edited.title = 'Personal edit';
    workspace.items[series.id] = series;
    for (const item of [completed, edited]) { workspace.items[item.id] = item; workspace.tombstones[item.id] = item.deletedAt!; }
    expect(pruneTechnicalDeletedOccurrences(workspace)).toBe(0);
    expect(workspace.items[completed.id]).toBeDefined();
    expect(workspace.items[edited.id]).toBeDefined();
  });

  it('retains an explicit user-deleted recurrence exception for Trash recovery', () => {
    const workspace = createWorkspace('Preserve deletion');
    const series = createItem('Weekly');
    series.role = 'series_template';
    series.schedule = { timezone: 'UTC', startAt: '2030-01-06T10:00:00Z', endAt: '2030-01-06T11:00:00Z' };
    series.recurrence = { rrule: 'FREQ=WEEKLY', timezone: 'UTC', anchor: 'schedule', autoRenew: true, closeAt: 'next_activation', rdates: [], exdates: [] };
    const cycle = createOccurrence(series, new Date('2030-01-13T10:00:00Z'), 1);
    cycle.deletedAt = '2030-01-14T00:00:00Z'; series.recurrence.exdates.push(cycle.occurrence!.recurrenceId);
    workspace.items[series.id] = series; workspace.items[cycle.id] = cycle; workspace.tombstones[cycle.id] = cycle.deletedAt;
    expect(pruneTechnicalDeletedOccurrences(workspace)).toBe(0);
    expect(workspace.items[cycle.id]).toBeDefined();
  });
});
