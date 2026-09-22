import { describe, expect, it } from 'vitest';
import { parseEntry } from './parser';

const now = new Date(2026, 8, 21, 16);
const at = (day: number, hour: number, minute = 0) => new Date(2026, 8, day, hour, minute).toISOString();
type Expected = { title: string; due?: string | null; start?: string | null; end?: string | null; travelMinutes?: number; durationMinutes?: number; reminders?: number };
const valid: Array<[string, Expected]> = [
  ['Стрижка начало завтра 15:11 дорога 45м напомнить выезд-1д,выезд-2ч', { title: 'Стрижка', start: at(22, 15, 11), travelMinutes: 45, reminders: 2 }],
  ['начало завтра 15:11 дорога 45м напомнить выезд-1д,выезд-2ч стрижка', { title: 'стрижка', start: at(22, 15, 11), travelMinutes: 45, reminders: 2 }],
  ['начало завтра 15:11 стрижка дорога 45м напомнить выезд-2ч', { title: 'стрижка', start: at(22, 15, 11), travelMinutes: 45, reminders: 1 }],
  ['дорога 45м стрижка начало завтра 15:11 напомнить выезд-2ч', { title: 'стрижка', start: at(22, 15, 11), travelMinutes: 45, reminders: 1 }],
  ['напомнить выезд-2ч стрижка дорога 45м начало завтра 15:11', { title: 'стрижка', start: at(22, 15, 11), travelMinutes: 45, reminders: 1 }],
  ['Стрижка с завтра 10:00 по завтра 11:00', { title: 'Стрижка', start: at(22, 10), end: at(22, 11), due: null }],
  ['с завтра 10:00 по завтра 11:00 Стрижка', { title: 'Стрижка', start: at(22, 10), end: at(22, 11), due: null }],
  ['Стрижка срок пятница с завтра 10:00 по завтра 11:00', { title: 'Стрижка', due: at(25, 9), start: at(22, 10), end: at(22, 11) }],
  ['срок пятница Стрижка с завтра 10:00 по завтра 11:00', { title: 'Стрижка', due: at(25, 9), start: at(22, 10), end: at(22, 11) }],
  ['с завтра утром по завтра вечером Стрижка', { title: 'Стрижка', start: at(22, 7), end: at(22, 18) }],
  ['Позвонить завтра', { title: 'Позвонить', start: at(22, 9) }],
  ['завтра Позвонить', { title: 'Позвонить', start: at(22, 9) }],
  ['Позвонить сегодня 18:00', { title: 'Позвонить', start: at(21, 18) }],
  ['Позвонить послезавтра днем', { title: 'Позвонить', start: at(23, 11) }],
  ['Позвонить в след пт вечером', { title: 'Позвонить', start: new Date(2026, 9, 2, 18).toISOString() }],
  ['Отчёт срок завтра', { title: 'Отчёт', due: at(22, 9) }],
  ['срок завтра Отчёт', { title: 'Отчёт', due: at(22, 9) }],
  ['Отчёт due tomorrow 15:00', { title: 'Отчёт', due: at(22, 15) }],
  ['due tomorrow 15:00 Отчёт', { title: 'Отчёт', due: at(22, 15) }],
  ['Отчёт @завтра 15:00', { title: 'Отчёт', due: at(22, 15) }],
  ['Встреча начало завтра конец послезавтра', { title: 'Встреча', start: at(22, 9), end: at(23, 9) }],
  ['начало завтра Встреча конец послезавтра', { title: 'Встреча', start: at(22, 9), end: at(23, 9) }],
  ['Встреча event opens tomorrow 10:00 event ends tomorrow 11:00', { title: 'Встреча', start: at(22, 10), end: at(22, 11) }],
  ['event opens tomorrow 10:00 Встреча event ends tomorrow 11:00', { title: 'Встреча', start: at(22, 10), end: at(22, 11) }],
  ['Встреча с 22.09.2026 10:00 по 22.09.2026 11:00', { title: 'Встреча', start: at(22, 10), end: at(22, 11) }],
  ['Звонок начало завтра 10:00 длительность 45м', { title: 'Звонок', start: at(22, 10), end: at(22, 10, 45), durationMinutes: 45 }],
  ['длительность 45м Звонок начало завтра 10:00', { title: 'Звонок', start: at(22, 10), end: at(22, 10, 45), durationMinutes: 45 }],
  ['Звонок начало завтра 10:00 длительность 1ч30м', { title: 'Звонок', end: at(22, 11, 30), durationMinutes: 90 }],
  ['Звонок завтра 18:00 напомнить 30м', { title: 'Звонок', start: at(22, 18), reminders: 1 }],
  ['напомнить 30м Звонок завтра 18:00', { title: 'Звонок', start: at(22, 18), reminders: 1 }],
  ['Звонок начало завтра 18:00 напомнить начало-30м', { title: 'Звонок', start: at(22, 18), reminders: 1 }],
  ['напомнить начало-30м Звонок начало завтра 18:00', { title: 'Звонок', start: at(22, 18), reminders: 1 }],
  ['Звонок напомнить через45м', { title: 'Звонок', reminders: 1 }],
  ['напомнить через45м Звонок', { title: 'Звонок', reminders: 1 }],
  ['Звонок начало завтра 18:00 дорога 30м напомнить выезд-1ч', { title: 'Звонок', travelMinutes: 30, reminders: 1 }],
  ['напомнить выезд-1ч Звонок начало завтра 18:00 дорога 30м', { title: 'Звонок', travelMinutes: 30, reminders: 1 }],
  ['«С другом по работе» завтра 18:00', { title: 'С другом по работе', start: at(22, 18) }],
  ['Встреча с другом по работе завтра 18:00', { title: 'Встреча с другом по работе', start: at(22, 18) }],
  ['Купить билет пятница 15:10', { title: 'Купить билет', start: at(25, 15, 10) }],
  ['пятница 15:10 Купить билет', { title: 'Купить билет', start: at(25, 15, 10) }],
];

const invalid = [
  'Встреча с завтра 10:00',
  'Встреча по завтра 11:00',
  'Встреча с завтра 10:00 по',
  'Встреча с завтра 11:00 по завтра 10:00',
  'Встреча с завтра 10:00 по завтра 10:00',
  'Встреча с завтра 10:00 по завтра 11:00 начало завтра 09:00',
  'Стрижка дорога 45м напомнить выезд-2ч',
  'Стрижка начало завтра 10:00 напомнить выезд-2ч',
  'Стрижка начало завтра 10:00 дорога неизвестно',
  'Стрижка начало завтра 10:00 напомнить выезд-2х',
];

describe('50 varied quick-entry lines', () => {
  it.each(valid)('parses %s', (line, expected) => {
    const actual = parseEntry(line, now);
    expect(actual.errors).toEqual([]);
    const { reminders, ...fields } = expected;
    expect(actual).toMatchObject(fields);
    if (reminders !== undefined) expect(actual.reminders).toHaveLength(reminders);
  });
  it.each(invalid)('rejects %s', line => expect(parseEntry(line, now).errors.length).toBeGreaterThan(0));
  it('has exactly 50 distinct examples', () => {
    expect(valid).toHaveLength(40);
    expect(invalid).toHaveLength(10);
    expect(new Set([...valid.map(([line]) => line), ...invalid]).size).toBe(50);
  });
});
