import { describe, expect, it } from 'vitest';
import { createItem, createOccurrence, createWorkspace, makeSeries } from '@utm/core';
import { usesCompletionAnchoredRecurrence } from './quickCompletion';

describe('quick completion input', () => {
  it('is required for an occurrence whose series repeats after completion', () => {
    const workspace = createWorkspace('Quick completion');
    const source = createItem('Water plants');
    source.schedule = { timezone: 'UTC', dueAt: '2026-09-04T09:00:00.000Z' };
    const series = makeSeries(source, 'FREQ=WEEKLY', { anchor: 'completion' });
    const occurrence = createOccurrence(series, new Date('2026-09-04T09:00:00.000Z'), 0);
    workspace.items[series.id] = series;
    workspace.items[occurrence.id] = occurrence;
    expect(usesCompletionAnchoredRecurrence(workspace, occurrence)).toBe(true);
  });

  it('does not intercept ordinary or schedule-anchored items', () => {
    const workspace = createWorkspace('Normal completion');
    const ordinary = createItem('One-off task');
    const source = createItem('Weekly task');
    source.schedule = { timezone: 'UTC', dueAt: '2026-09-04T09:00:00.000Z' };
    const series = makeSeries(source, 'FREQ=WEEKLY', { anchor: 'schedule' });
    const occurrence = createOccurrence(series, new Date('2026-09-04T09:00:00.000Z'), 0);
    workspace.items[series.id] = series;
    expect(usesCompletionAnchoredRecurrence(workspace, ordinary)).toBe(false);
    expect(usesCompletionAnchoredRecurrence(workspace, occurrence)).toBe(false);
  });
});
