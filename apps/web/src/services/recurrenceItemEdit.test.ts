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
  it('updates reminders on future exceptions without erasing their other edits', () => {
    const { w, first, second, third, edited } = fixture();
    edited.reminders = [{ id: 'notice', mode: 'relative', relativeTo: 'start', offset: '-PT30M', repeatUntilAcknowledged: false }];
    const past = structuredClone(first);
    const result = editRecurringItem(w, edited, { occurrenceId: second.id, scope: 'this_and_future' }, new Date('2030-09-08T00:00:00Z'));
    expect(third.reminders).toEqual(edited.reminders);
    expect(third.bodyMarkdown).toBe('Keep override');
    expect(first).toEqual(past);
    const projected = createOccurrence(result.item, new Date('2030-09-23T10:00:00Z'), 2);
    expect(projected.reminders).toEqual(edited.reminders);
    expect(projected.recurrenceOverride).toBeUndefined();
  });
  it('updates already materialized cycles after a second future-series edit', () => {
    const { w, second, edited } = fixture();
    const now = new Date('2030-09-08T00:00:00Z');
    const split = editRecurringItem(w, edited, { occurrenceId: second.id, scope: 'this_and_future' }, now).item;
    const future = createOccurrence(split, new Date('2030-09-23T10:00:00Z'), 2);
    // Reproduce a cycle saved by older builds with the split provenance copied.
    future.recurrenceOverride = structuredClone(split.recurrenceOverride!);
    w.items[future.id] = future;
    const draft = structuredClone(itemEditorSource(w, second));
    draft.reminders = [{ id: 'new', mode: 'relative', relativeTo: 'start', offset: '-PT1H', repeatUntilAcknowledged: false }];
    editRecurringItem(w, draft, { occurrenceId: second.id, scope: 'this_and_future' }, now);
    expect(future.reminders).toEqual(draft.reminders);
    expect(future.recurrenceOverride).toBeUndefined();
  });
  it('shifts absolute reminders for future exceptions while retaining their rescheduled time', () => {
    const { w, second, third, edited } = fixture();
    third.schedule!.startAt = '2030-09-16T12:00:00Z';
    third.schedule!.endAt = '2030-09-16T13:00:00Z';
    edited.reminders = [{ id: 'absolute', mode: 'absolute', at: '2030-09-09T09:00:00Z', repeatUntilAcknowledged: false }];
    editRecurringItem(w, edited, { occurrenceId: second.id, scope: 'this_and_future' }, new Date('2030-09-08T00:00:00Z'));
    expect(third.reminders[0]?.at).toBe('2030-09-16T09:00:00.000Z');
    expect(third.schedule!.startAt).toBe('2030-09-16T12:00:00Z');
    expect(third.schedule!.endAt).toBe('2030-09-16T13:00:00Z');
  });
  it('keeps reminders local to the selected cycle with Only this occurrence', () => {
    const { w, series, first, second, third, edited } = fixture();
    edited.reminders = [{ id: 'only', mode: 'relative', relativeTo: 'start', offset: '-PT1H', repeatUntilAcknowledged: false }];
    editRecurringItem(w, edited, { occurrenceId: second.id, scope: 'this_occurrence' }, new Date('2030-09-08T00:00:00Z'));
    expect(second.reminders).toEqual(edited.reminders);
    expect([series.reminders, first.reminders, third.reminders]).toEqual([[], [], []]);
  });
  it('keeps a pending instance write while accepting a newer title for the same occurrence', () => {
    const { w, series, second, edited } = fixture();
    const pending = { kind: 'edit', eventId: 'instance', draft: { title: second.title }, attempted: true };
    second.extensions = { 'utm:googleSave': pending };
    edited.title = 'Renamed occurrence';
    editRecurringItem(w, edited, { occurrenceId: second.id, scope: 'this_occurrence' }, new Date());
    expect(second.title).toBe('Renamed occurrence');
    expect(second.extensions?.['utm:googleSave']).toEqual(pending);
    expect(series.title).toBe('Weekly');
  });
  it('does not split away a future exception with an uncertain remote write', () => {
    const { w, second, third, edited } = fixture();
    third.extensions = { 'utm:googleSave': { kind: 'edit', attempted: true } };
    const before = JSON.stringify(w);
    expect(() => editRecurringItem(w, edited, { occurrenceId: second.id, scope: 'this_and_future' }, new Date())).toThrow('pending');
    expect(JSON.stringify(w)).toBe(before);
  });
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
    expect(third.schedule?.travelDuration).toBe('PT30M');
  });
});
