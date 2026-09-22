import { expect, it } from 'vitest';
import { createItem } from '@utm/core';
import { createItemSearchIndex, searchItems } from './itemSearch';

it('ranks title ahead of other fields and accepts case, ё and a small typo', () => {
  const title = createItem('Подготовка отчёта');
  const body = createItem('Письмо'); body.bodyMarkdown = 'Подготовка отчета';
  const tag = createItem('Звонок'); tag.tags = ['отчет'];
  const index = createItemSearchIndex([body, tag, title]);
  expect(searchItems(index, 'ОТЧЕТ').map(item => item.id)).toEqual([title.id, ...searchItems(createItemSearchIndex([body, tag]), 'отчет').map(item => item.id)]);
  expect(searchItems(index, 'подготвка').map(item => item.id)).toEqual([title.id]);
  expect(searchItems(index, 'ничего')).toEqual([]);
});

it('matches words across user fields, including note creation date without changing items', () => {
  const note = createItem('Идея', 'task', new Date('2026-09-22T10:00:00Z'));
  note.isNote = true; note.areas = ['Работа']; note.projects = ['Запуск'];
  const before = JSON.stringify(note);
  const index = createItemSearchIndex([note]);
  expect(searchItems(index, 'идея запуск 2026-09-22')).toEqual([note]);
  expect(JSON.stringify(note)).toBe(before);
});
