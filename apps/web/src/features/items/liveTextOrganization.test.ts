import { expect, it } from 'vitest';
import { compileQuery } from '@utm/core';
import { createQuickEntryItem, applyQuickEntryText, quickEntrySource } from './quickEntry';
import { extractOrganization, organizationSuggestions } from '../../../quick-entry-lab/organization';
import { parseLiveEntry } from '../../../quick-entry-lab/parser';
const now = new Date('2026-09-22T12:00:00Z');

it('keeps dot-prefixed prose literal, with only explicit organization commands parsed', () => {
  const text = '. завтра 15:00 нап 2ч area:"Работа" project:"Новый запуск" #важно';
  const item = createQuickEntryItem(text, now, '2026-09-25');
  expect(item.title).toBe('завтра 15:00 нап 2ч');
  expect(item.isNote).toBe(true); expect(item.canBeCompleted).toBe(false);
  expect(item.createdAt).toBe(now.toISOString()); expect(item.reminders).toEqual([]);
  expect(item.schedule?.startAt).toBeUndefined(); expect(item.schedule?.plannedDate).toBeUndefined();
  expect(item.areas).toEqual(['Работа']); expect(item.projects).toEqual(['Новый запуск']); expect(item.tags).toEqual(['важно']);
  expect(applyQuickEntryText(item, quickEntrySource(item)!.text, now).item.title).toBe(item.title);
  expect(compileQuery('isNote == true')(item, now)).toBe(true);
});

it('supports нап and multiple reminders with organization', () => {
  const draft = parseLiveEntry('Встреча завтра 15:00 нап 2ч нап 1д проект:"Запуск" #важно', now);
  expect(draft.errors).toEqual([]); expect(draft.reminders).toHaveLength(2);
  expect(draft.projects).toEqual(['Запуск']); expect(draft.tags).toEqual(['важно']);
  expect(draft.title).toBe('Встреча');
});

it('protects quoted prose and suggests projects without requiring an area', () => {
  expect(extractOrganization('"проект:завтра" #"два слова"')).toMatchObject({ text: '"проект:завтра"', tags: ['два слова'], projects: [] });
  const text = '. мысль проект За';
  expect(organizationSuggestions(text, text.length, { area: [], project: ['Запуск', 'Дом'], tag: [] })?.options.map(option => option.label)).toEqual(['Запуск']);
});
