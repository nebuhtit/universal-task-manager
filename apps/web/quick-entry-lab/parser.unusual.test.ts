import { describe, expect, it } from 'vitest';
import { parseEntry } from './parser';

const now = new Date(2026, 8, 21, 16);
const tomorrow = (hour: number, minute = 0) => new Date(2026, 8, 22, hour, minute).toISOString();
const valid = [
  ['начало завтра 15:00 стрижка у Маши дорога 45м', { title: 'стрижка у Маши', start: tomorrow(15), travelMinutes: 45 }],
  ['дорога 45м стрижка у Маши начало завтра 15:00', { title: 'стрижка у Маши', start: tomorrow(15), travelMinutes: 45 }],
  ['напомнить выезд-2ч забрать посылку из пункта дорога 30м начало завтра 18:00', { title: 'забрать посылку из пункта', start: tomorrow(18), travelMinutes: 30 }],
  ['срок завтра 18:00 купить подарок для мамы напомнить 2ч', { title: 'купить подарок для мамы', due: tomorrow(18) }],
  ['начало завтра 15:00 «встреча с завтра по сегодня» конец завтра 16:00', { title: 'встреча с завтра по сегодня', start: tomorrow(15), end: tomorrow(16) }],
  ['«дорога 45м» срок завтра', { title: 'дорога 45м', due: tomorrow(9) }],
  ['💇 стрижка ✂️ начало завтра 15:00', { title: '💇 стрижка ✂️', start: tomorrow(15) }],
  ['СТРИЖКА НАЧАЛО ЗАВТРА 15:00 ДОРОГА 45М', { title: 'СТРИЖКА', start: tomorrow(15), travelMinutes: 45 }],
  ['стрижка\nначало завтра 15:00\nдорога 45м', { title: 'стрижка', start: tomorrow(15), travelMinutes: 45 }],
  ['стрижка\u00a0начало\u00a0завтра 15:00', { title: 'стрижка', start: tomorrow(15) }],
  ['встреча с завтра 10:00 по завтра 11:00 срок завтра 18:00', { title: 'встреча', start: tomorrow(10), end: tomorrow(11), due: tomorrow(18) }],
  ['с завтра 10:00 по завтра 11:00 встреча с врачом срок завтра 18:00', { title: 'встреча с врачом', start: tomorrow(10), end: tomorrow(11), due: tomorrow(18) }],
  ['встреча с завтра утром по завтра вечером', { title: 'встреча', start: tomorrow(7), end: tomorrow(18) }],
  ['встреча с 2026-09-22 10:00 по 2026-09-22 11:00', { title: 'встреча', start: tomorrow(10), end: tomorrow(11) }],
  ['встреча с вт 22.09.2026 10:00 по вт 22.09.2026 11:00', { title: 'встреча', start: tomorrow(10), end: tomorrow(11) }],
  ['встреча начало завтра 23:30 длительность 1ч30м', { title: 'встреча', start: tomorrow(23, 30), end: new Date(2026, 8, 23, 1).toISOString() }],
  ['встреча начало завтра 15:00 длительность 1 ч 30 м', { title: 'встреча', start: tomorrow(15), end: tomorrow(16, 30) }],
  ['напомнить через45м оплатить счёт', { title: 'оплатить счёт', reminders: 1 }],
  ['напомнить в завтра 18:00 оплатить счёт', { title: 'оплатить счёт', reminders: 1 }],
  ['оплатить счёт до завтра 18:00 напомнить срок-2ч', { title: 'оплатить счёт', due: tomorrow(18), reminders: 1 }],
  ['начало завтра 15:00 дорога 45м напомнить выезд-2ч стрижка', { title: 'стрижка', start: tomorrow(15), travelMinutes: 45, reminders: 1 }],
  ['стрижка завтра 18:00 напомнить 1д,2ч', { title: 'стрижка', start: tomorrow(18), reminders: 2 }],
  ['срок завтра 18:00 Отчёт для банка', { title: 'Отчёт для банка', due: tomorrow(18) }],
  ['отчёт срок завтра вечером', { title: 'отчёт', due: tomorrow(18) }],
  ['позвонить в следующий вторник 15:00', { title: 'позвонить', start: new Date(2026, 8, 29, 15).toISOString() }],
  ['позвонить 15:10 пятница', { title: 'позвонить', start: new Date(2026, 8, 25, 15, 10).toISOString() }],
  ['позвонить 25 сентября 2026 в 15:10', { title: 'позвонить', start: new Date(2026, 8, 25, 15, 10).toISOString() }],
  ['встреча с другом по работе', { title: 'встреча с другом по работе', start: null, end: null }],
  ['начало завтра 10:00 позвонить в офис конец завтра 11:00', { title: 'позвонить в офис', start: tomorrow(10), end: tomorrow(11) }],
  ['напомнить через45м «пятница 15:00»', { title: 'пятница 15:00', due: null, reminders: 1 }],
] as const;

const invalid = [
  'с завтра 10:00 встреча',
  'встреча по завтра 11:00',
  'встреча с завтра 10:00 по завтра 09:00',
  'встреча с завтра 10:00 по завтра 10:00',
  'встреча с завтра 10:00 по завтра 11:00 конец завтра 12:00',
  'встреча начало завтра 15:00 конец завтра 16:00 длительность 2ч',
  'встреча начало завтра 24:00',
  'встреча срок 31.02.2026',
  'встреча напомнить выезд-2ч',
  'встреча дорога 45м',
  'встреча начало завтра 10:00 дорога 45м напомнить выезд-2х',
  'встреча срок завтра срок послезавтра',
  'встреча напомнить через0м',
  'встреча «незакрытая кавычка',
  'начало завтра 10:00 конец завтра 11:00',
] as const;

const punctuation = [
  ['Стрижка; начало завтра 15:00; дорога 45м', 'Стрижка'],
  ['начало завтра 15:00; Стрижка; дорога 45м', 'Стрижка'],
  ['Стрижка — начало завтра 15:00 — дорога 45м', 'Стрижка'],
  ['Стрижка, начало завтра 15:00, дорога 45м', 'Стрижка'],
  ['начало завтра 15:00, Стрижка, дорога 45м', 'Стрижка'],
] as const;

describe('unusual quick-entry lines', () => {
  it.each(valid)('parses %s', (line, expected) => {
    const actual = parseEntry(line, now);
    expect(actual.errors).toEqual([]);
    const { reminders, ...fields } = expected as typeof expected & { reminders?: number };
    expect(actual).toMatchObject(fields);
    if (reminders !== undefined) expect(actual.reminders).toHaveLength(reminders);
  });
  it.each(invalid)('rejects %s', line => expect(parseEntry(line, now).errors.length).toBeGreaterThan(0));
  it.each(punctuation)('accepts separators in %s', (line, title) => {
    expect(parseEntry(line, now)).toMatchObject({ title, start: tomorrow(15), travelMinutes: 45, errors: [] });
  });
  it('keeps a comma inside the title and inside reminder lists', () => {
    expect(parseEntry('Купить молоко, хлеб завтра', now)).toMatchObject({ title: 'Купить молоко, хлеб', start: tomorrow(9), errors: [] });
    expect(parseEntry('Стрижка начало завтра 15:00 дорога 45м напомнить выезд-1д,выезд-2ч', now).reminders).toHaveLength(2);
  });
  it('covers 50 different strings', () => expect(new Set([...valid.map(([line]) => line), ...invalid, ...punctuation.map(([line]) => line)]).size).toBe(50));
});
