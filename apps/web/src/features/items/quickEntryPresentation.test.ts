import { describe, expect, it } from 'vitest';
import { applyQuickEntryEditorText } from './quickEntry';
import { applyQuickEntryText, createQuickEntryItem, formatQuickEntryForEditor, quickEntrySource, syncQuickEntrySource } from './quickEntry';

describe('quick entry presentation', () => {
  it.each([
    ['Встреча начало 24.09.2026 18:00 длительность 1ч дорога 30м обратно 30м напомнить начало-30м', 'Встреча начало 24.09.2026 18:00 дл 1ч тт 30м тб 30м н начало-30м'],
    ['Meeting event opens 24.09.2026 18:00 duration 1h travel time 30m travel back 30m remind start-30m', 'Meeting start 24.09.2026 18:00 dr 1h tt 30m tb 30m r start-30m'],
  ])('compacts recognized commands without changing their data: %s', (source, compact) => {
    expect(formatQuickEntryForEditor(source)).toBe(compact);
    const now = new Date(2026, 8, 24, 8);
    const before = createQuickEntryItem(source, now);
    const after = applyQuickEntryEditorText(before, formatQuickEntryForEditor(quickEntrySource(before)!.text), now).item;
    expect(after.title).toBe(before.title);
    expect(after.schedule).toEqual(before.schedule);
    expect(after.reminders.map(({ id, ...r }) => r)).toEqual(before.reminders.map(({ id, ...r }) => r));
    expect(formatQuickEntryForEditor(compact)).toBe(compact);
  });
  it('does not shorten ordinary or quoted title words', () => {
    expect(formatQuickEntryForEditor('«дорога обратно длительность напомнить»')).toBe('«дорога обратно длительность напомнить»');
    expect(formatQuickEntryForEditor('Дорога домой')).toBe('Дорога домой');
  });
  it('hides the default start reminder pair but retains it when editing the title', () => {
    const now = new Date('2026-09-23T12:00:00Z');
    const item = createQuickEntryItem('Встреча завтра 17:00 напомнить начало-120м, начало-1440м', now);
    const text = formatQuickEntryForEditor(quickEntrySource(item)!.text);
    expect(text).not.toContain('начало-');
    const saved = applyQuickEntryEditorText(item, text.replace('Встреча', 'Звонок'), now).item;
    expect(saved.title).toBe('Звонок');
    expect(saved.reminders.map(r => r.offset)).toEqual(item.reminders.map(r => r.offset));
    expect(formatQuickEntryForEditor(quickEntrySource(saved)!.text)).not.toContain('начало-');
    const cleared = syncQuickEntrySource(saved, { ...saved, reminders: [] });
    expect(applyQuickEntryEditorText(cleared, formatQuickEntryForEditor(quickEntrySource(cleared)!.text), now).item.reminders).toEqual([]);
  });
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
