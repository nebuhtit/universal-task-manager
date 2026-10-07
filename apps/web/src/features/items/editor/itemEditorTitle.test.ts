import { describe, expect, it } from 'vitest';
import { createItem } from '@utm/core';
import { applyEditorTitleDraft } from './itemEditorTitle';
import { createQuickEntryItem, formatQuickEntryForEditor, quickEntrySource } from '../quickEntry';

describe('item editor title draft', () => {
  it('keeps a compact weekday anchored to its stored date after reopening on a later week', () => {
    const created = new Date(2026, 9, 5, 8);
    const item = createQuickEntryItem('Meeting начало 05.10.2026 12:00 дл 1ч ттб 45м', created);
    const text = formatQuickEntryForEditor(quickEntrySource(item)!.text).replace('05.10.2026', 'пн');
    // Canonical weekday form is how relative input is materialized by capture.
    item.extensions!['utm:quickEntrySource'] = { text: quickEntrySource(item)!.text.replace('05.10.2026', 'пн 05.10.2026'), timezone: item.schedule!.timezone, grammarVersion: 2 };
    const result = applyEditorTitleDraft(item, structuredClone(item), text.replace('Meeting', 'Updated'), '', new Date(2026, 9, 13, 8));
    expect(result.title).toBe('Updated');
    expect(result.schedule).toEqual(item.schedule);
    expect(result.reminders.map(({ id, ...rest }) => rest)).toEqual(item.reminders.map(({ id, ...rest }) => rest));
  });

  it('rejects travel with missing bounds without mutating a new item', () => {
    const item = createItem('');
    const before = structuredClone(item);
    expect(() => applyEditorTitleDraft(item, before, 'Test ttb 45m', '', new Date())).toThrow('Для дороги нужно время начала.');
    expect(item).toEqual(before);
  });

  it('uses form dates for hidden departure reminders when the replacement title has travel only', () => {
    const now = new Date(2026, 9, 5, 8);
    const item = createQuickEntryItem('Meeting начало 05.10.2026 12:00 дл 1ч ттб 45м', now);
    const result = applyEditorTitleDraft(item, structuredClone(item), 'Updated ttb 30m', '', now);
    expect(result.title).toBe('Updated');
    expect(result.schedule).toMatchObject({ startAt: item.schedule!.startAt, endAt: item.schedule!.endAt, travelDuration: 'PT30M', travelBackDuration: 'PT30M' });
    expect(result.reminders.map(r => r.at)).toEqual([new Date(2026, 9, 5, 9, 30).toISOString(), new Date(2026, 9, 4, 11, 30).toISOString()]);
  });
  it('commits plain title text without clearing dates or reminders', () => {
    const item = createItem('Before');
    item.schedule = { timezone: 'UTC', startAt: '2030-09-20T12:00:00Z', endAt: '2030-09-20T13:00:00Z' };
    item.reminders = [{ id: 'r', mode: 'relative', relativeTo: 'start', offset: '-PT10M', repeatUntilAcknowledged: false }];
    const result = applyEditorTitleDraft(item, structuredClone(item), 'After', '', new Date('2030-09-01T00:00:00Z'));
    expect(result.title).toBe('After');
    expect(result.schedule).toEqual(item.schedule);
    expect(result.reminders).toEqual(item.reminders);
  });

  it('applies a title command exactly when the draft is committed', () => {
    const item = createItem('Before');
    item.schedule = { timezone: 'UTC', startAt: '2030-09-20T12:00:00Z', endAt: '2030-09-20T13:00:00Z' };
    const result = applyEditorTitleDraft(item, structuredClone(item), 'After длительность 30м', '', new Date('2030-09-01T00:00:00Z'));
    expect(result.title).toBe('After');
    expect(result.schedule?.estimatedDuration).toBe('PT30M');
    expect(result.schedule?.startAt).toBe(item.schedule.startAt);
  });

  it.each(['Updated ттб 45м', 'Updated ttb 45m'])('uses existing event bounds for both travel legs in %s', text => {
    const item = createItem('Before');
    item.schedule = { timezone: 'UTC', startAt: '2030-09-20T12:00:00Z', endAt: '2030-09-20T13:00:00Z' };
    const result = applyEditorTitleDraft(item, structuredClone(item), text, '', new Date('2030-09-01T00:00:00Z'));
    expect(result.title).toBe('Updated');
    expect(result.schedule).toMatchObject({
      startAt: item.schedule.startAt,
      endAt: item.schedule.endAt,
      travelDuration: 'PT45M',
      travelBackDuration: 'PT45M',
    });
  });
});
