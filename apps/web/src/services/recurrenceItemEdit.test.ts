import { describe, expect, it } from 'vitest';
import { createItem, createWorkspace, createOccurrence, buildRecurrenceRule } from '@utm/core';
import { editRecurringItem } from './recurrenceItemEdit';
import { itemEditorSource } from '../features/items/editor/itemEditorSource';

function fixture() {
  const w = createWorkspace(); const series = createItem('Weekly');
  series.role = 'series_template';
  series.schedule = { timezone: 'UTC', startAt: '2030-09-02T10:00:00Z', endAt: '2030-09-02T11:00:00Z', travelDuration: 'PT10M' };
  series.recurrence = { rrule: 'FREQ=WEEKLY;COUNT=4', timezone: 'UTC', anchor: 'schedule', closeAt: 'next_activation', autoRenew: true, activationOffset: 'PT0M', rdates: [], exdates: [] };
  const first = createOccurrence(series, new Date(series.schedule.startAt!), 0);
  const second = createOccurrence(series, new Date('2030-09-09T10:00:00Z'), 1);
  const third = createOccurrence(series, new Date('2030-09-16T10:00:00Z'), 2);
  third.bodyMarkdown = 'Keep override'; third.recurrenceOverride = { kind: 'this_occurrence', sourceSeriesId: series.id, recurrenceId: third.occurrence!.recurrenceId };
  w.items = { [series.id]: series, [first.id]: first, [second.id]: second, [third.id]: third };
  const edited = structuredClone(itemEditorSource(w, second)); edited.schedule!.travelDuration = 'PT30M';
  return { w, series, first, second, third, edited };
}
describe('recurrence editor scope', () => {
  it('updates from the first cycle without creating an empty old series', () => {
    const { w, series, first } = fixture();
    const edited = structuredClone(itemEditorSource(w, first)); edited.title = 'All future';
    const result = editRecurringItem(w, edited, { occurrenceId: first.id, scope: 'this_and_future' }, new Date());
    expect(result.item.id).toBe(series.id); expect(result.previousSeries).toBeUndefined();
    expect(buildRecurrenceRule(result.item).all()).toHaveLength(4);
    expect(first.title).toBe('All future');
  });
  it('removes obsolete default slots when changing future frequency, retaining explicit exceptions', () => {
    const { w, first, second, third } = fixture();
    const edited = structuredClone(itemEditorSource(w, first)); edited.recurrence!.rrule = 'FREQ=MONTHLY;COUNT=4';
    const result = editRecurringItem(w, edited, { occurrenceId: first.id, scope: 'this_and_future' }, new Date());
    expect(second.deletedAt).toBeTruthy();
    expect(third.deletedAt).toBeUndefined();
    expect(result.item.recurrence!.rdates).toContain(third.occurrence!.recurrenceId);
  });
  it('changes travel for one occurrence without touching the rule or other cycles', () => {
    const { w, series, first, second, third, edited } = fixture();
    const before = JSON.stringify([series, first, third]);
    edited.recurrence!.rrule += ';INTERVAL=1'; // Editor normalization is not a rule change.
    editRecurringItem(w, edited, { occurrenceId: second.id, scope: 'this_occurrence' }, new Date());
    expect(second.schedule?.travelDuration).toBe('PT30M');
    expect(second.recurrenceOverride?.kind).toBe('this_occurrence');
    expect(JSON.stringify([series, first, third])).toBe(before);
  });
  it('splits future cycles, keeps COUNT and past history, and preserves individual overrides', () => {
    const { w, series, first, second, third, edited } = fixture();
    const before = JSON.stringify(first);
    edited.recurrence!.rrule += ';INTERVAL=1';
    const result = editRecurringItem(w, edited, { occurrenceId: second.id, scope: 'this_and_future' }, new Date());
    expect(JSON.stringify(first)).toBe(before);
    expect(buildRecurrenceRule(series).all()).toHaveLength(1);
    expect(buildRecurrenceRule(result.item).all()).toHaveLength(3);
    expect(result.item.schedule?.travelDuration).toBe('PT30M');
    expect(second.occurrence?.seriesId).toBe(result.item.id);
    expect(second.schedule?.travelDuration).toBe('PT30M');
    expect(third.bodyMarkdown).toBe('Keep override');
    expect(third.schedule?.travelDuration).toBe('PT10M');
  });
});
