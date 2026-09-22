import { describe, expect, it } from 'vitest';
import { parseLiveEntry } from '../../../quick-entry-lab/parser';
import { applyQuickEntryText, createQuickEntryItem, quickEntrySource } from './quickEntry';

const now = new Date('2026-09-22T12:00:00Z');
describe('creation defaults and recognized commands', () => {
  it('adds ten minutes only on creation without explicit scheduling', () => {
    for (const date of [undefined, '2026-09-25']) {
      const item = createQuickEntryItem('Купить хлеб', now, date);
      expect(item.schedule?.estimatedDuration).toBe('PT10M');
      expect(item.schedule?.plannedDate).toBe(date);
      expect(applyQuickEntryText(item, quickEntrySource(item)!.text, now).item.schedule).toEqual(item.schedule);
      expect(applyQuickEntryText(item, 'Купить хлеб', now).item.schedule?.estimatedDuration).toBeUndefined();
    }
    expect(createQuickEntryItem('Хлеб завтра', now).schedule?.estimatedDuration).toBeUndefined();
    expect(createQuickEntryItem('. Просто текст', now).schedule?.estimatedDuration).toBeUndefined();
  });
  it('no-date flags disable defaults, not explicit values', () => {
    for (const flag of ['бд', 'nd', 'ND']) {
      const item = createQuickEntryItem(`Хлеб ${flag}`, now, '2026-09-25');
      expect(item.title).toBe('Хлеб'); expect(item.schedule?.plannedDate).toBeUndefined();
      expect(item.schedule?.estimatedDuration).toBeUndefined();
      const explicit = createQuickEntryItem(`Хлеб завтра ${flag} 20 мин`, now, '2026-09-25');
      expect(explicit.schedule?.plannedDate).toBeTruthy(); expect(explicit.schedule?.estimatedDuration).toBe('PT20M');
    }
  });
  it('бн suppresses defaults but retains explicit reminders and survives reparse', () => {
    const item = createQuickEntryItem('Встреча завтра 15:00 дорога 30м бн нап 30м', now);
    expect(item.reminders).toHaveLength(1);
    expect(item.title).toBe('Встреча');
    expect(applyQuickEntryText(item, quickEntrySource(item)!.text, now).item.reminders).toHaveLength(1);
    expect(createQuickEntryItem('Встреча завтра 15:00 бн', now).reminders).toHaveLength(0);
    expect(createQuickEntryItem('Встреча завтра 15:00', now).reminders).toHaveLength(2);
  });
  it('reports original command offsets, excluding quoted prose and note commands', () => {
    const text = '  Хлеб area:"Работа" завтра длительность 20м бн';
    const parsed = parseLiveEntry(text, now);
    expect(parsed.errors).toEqual([]);
    expect(parsed.commandSpans?.map(s => text.slice(s.start, s.end))).toEqual(['area', 'завтра', 'длительность', 'бн']);
    const note = '. завтра нап 30м бн project:"Работа"';
    expect(parseLiveEntry(note, now).commandSpans?.map(s => note.slice(s.start, s.end))).toEqual(['project']);
    expect(parseLiveEntry('"завтра бн"', now).commandSpans).toEqual([]);
    expect(parseLiveEntry('Текст нап', now).commandSpans).toEqual([]);
    const short = 'Хлеб area:Дом 20м';
    expect(parseLiveEntry(short, now).commandSpans?.map(s => short.slice(s.start, s.end))).toEqual(['area']);
  });
});
