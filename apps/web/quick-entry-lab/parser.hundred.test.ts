import { describe, expect, it } from 'vitest';
import { parseEntry } from './parser';

const now = new Date(2026, 8, 21, 16);
const dates: Array<[string, Date]> = [
  ['завтра 15:00', new Date(2026, 8, 22, 15)],
  ['послезавтра 15:00', new Date(2026, 8, 23, 15)],
  ['среда 15:00', new Date(2026, 8, 23, 15)],
  ['четверг 15:00', new Date(2026, 8, 24, 15)],
  ['пятница 15:00', new Date(2026, 8, 25, 15)],
  ['вс 15:00', new Date(2026, 8, 27, 15)],
  ['след пн 15:00', new Date(2026, 8, 28, 15)],
  ['след пт 15:00', new Date(2026, 9, 2, 15)],
  ['25.09.2026 15:00', new Date(2026, 8, 25, 15)],
  ['2026-09-25 15:00', new Date(2026, 8, 25, 15)],
];

const eventCases = dates.flatMap(([date, start]) => [
  { line: `Гость ${date}`, start, duration: 60 },
  { line: `${date} Гость`, start, duration: 60 },
  { line: `Гость ${date} длительность 30м`, start, duration: 30 },
  { line: `напомнить начало-15м Гость ${date}`, start, duration: 60, reminder: 'start' },
  { line: `Гость дорога 20м ${date} напомнить выезд-10м`, start, duration: 60, reminder: 'leave', travel: 20 },
]);
const dueCases = dates.flatMap(([date, due]) => [
  { line: `Домашка до ${date}`, due, duration: 10 },
  { line: `до ${date} Домашка`, due, duration: 10 },
  { line: `Домашка до ${date} длительность 25м`, due, duration: 25 },
]);
const invalid = [
  'завтра 15:00',
  'до завтра 15:00',
  'Гость завтра 15:00 начало завтра 16:00',
  'Гость завтра 15:00 пятница 16:00',
  'Домашка до завтра 15:00 срок пятница 16:00',
  'Гость начало завтра 15:00 начало завтра 16:00',
  'Гость с завтра 10:00',
  'Гость по завтра 11:00',
  'Гость с завтра 10:00 по завтра 09:00',
  'Гость с завтра 10:00 по завтра 10:00',
  'Гость завтра 15:00 конец завтра 14:00',
  'Гость завтра 15:00 конец завтра 17:00 длительность 1ч',
  'Гость до 31.02.2026 15:00',
  'Гость 31.02.2026 15:00',
  'Гость завтра 25:00',
  'Гость до завтра 25:00',
  'Гость завтра 15:00 длительность 0м',
  'Гость до завтра 15:00 длительность 0м',
  'Гость напомнить начало-15м',
  'Гость напомнить выезд-15м',
];

describe('100 start-first examples', () => {
  it.each(eventCases)('event: $line', ({ line, start, duration, reminder, travel }) => {
    const result = parseEntry(line, now);
    expect(result.errors).toEqual([]);
    expect(result.title).toBe('Гость');
    expect(result.start).toBe(start.toISOString());
    expect(result.end).toBe(new Date(start.getTime() + duration * 60_000).toISOString());
    expect(result.due).toBeNull();
    expect(result.durationMinutes).toBe(duration);
    if (travel) expect(result.travelMinutes).toBe(travel);
    if (reminder) expect(result.reminders[0]?.anchor).toBe(reminder);
  });
  it.each(dueCases)('due: $line', ({ line, due, duration }) => {
    const result = parseEntry(line, now);
    expect(result.errors).toEqual([]);
    expect(result.title).toBe('Домашка');
    expect(result.due).toBe(due.toISOString());
    expect(result.start).toBeNull();
    expect(result.end).toBeNull();
    expect(result.durationMinutes).toBe(duration);
  });
  it.each(invalid)('rejects: %s', line => expect(parseEntry(line, now).errors.length).toBeGreaterThan(0));
  it('contains 100 distinct input strings', () => {
    const lines = [...eventCases, ...dueCases].map(value => value.line).concat(invalid);
    expect(lines).toHaveLength(100);
    expect(new Set(lines).size).toBe(100);
  });
});
