import { describe, expect, it } from 'vitest';
import { createItem } from '@utm/core';
import { applyEditorTitleDraft } from './itemEditorTitle';

describe('item editor title draft', () => {
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
