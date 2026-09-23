import { describe, expect, it } from 'vitest';
import { applyQuickEntryText, createQuickEntryItem, formatQuickEntryForEditor, quickEntrySource } from './quickEntry';

describe('quick entry presentation', () => {
  it('keeps all absolute reminders', () => {
    const now = new Date('2026-09-23T12:00:00Z');
    const item = createQuickEntryItem('Звонок н через полчаса', now);
    const text = quickEntrySource(item)!.text;
    const result = applyQuickEntryText(item, text, now);
    expect(result.draft.errors).toEqual([]);
    expect(result.item.title).toBe('Звонок');
    expect(result.item.reminders.map(value => value.at)).toEqual(item.reminders.map(value => value.at));
  });
  it('spaces reminder separators without changing quoted text or decimal values', () => {
    expect(formatQuickEntryForEditor('«Один,два» длительность 1,5ч н начало-30м,начало-60м')).toBe('«Один,два» длительность 1,5ч н начало-30м, начало-60м');
    expect(formatQuickEntryForEditor('н начало-30м,\nначало-60м')).toBe('н начало-30м,\nначало-60м');
  });
  it.each([', ', ',\n'])('round-trips reminders separated by %j', separator => {
    const now = new Date('2026-09-23T12:00:00Z');
    const item = createQuickEntryItem('Встреча завтра 17:00 н начало-30м,начало-60м', now);
    const text = quickEntrySource(item)!.text.replace(/,\s*/g, separator);
    const result = applyQuickEntryText(item, text, now).item;
    expect(result.title).toBe(item.title);
    expect(result.reminders.map(({ offset, at }) => ({ offset, at }))).toEqual(item.reminders.map(({ offset, at }) => ({ offset, at })));
  });
});
