import { expect, it } from 'vitest';
import { parseEntry, suggest } from './parser';

const now = new Date(2026, 8, 22, 12);
const hours = Array.from({ length: 24 }, (_, index) => `${String((index + 6) % 24).padStart(2, '0')}:`);
function choose(text: string, label: string, caret = text.length) {
  const result = suggest(text, caret, now);
  const option = result.options.find(value => value.label === label);
  expect(option, `${text} should offer ${label}`).toBeDefined();
  return text.slice(0, result.start) + option!.insert + text.slice(result.end);
}

it.each(['сегодня', 'завтра', 'вторник', 'среда', '18.09', '12.02', 'след пятница', '13 марта 27', 'tomorrow', 'next friday'])('uses two stages for %s', day => {
  const text = `Встреча ${day}`;
  expect(suggest(text, text.length, now).options.map(value => value.label)).toEqual(hours);
  const withHour = choose(text, '15:');
  expect(withHour).toBe(`${text} 15:`);
  expect(suggest(withHour, withHour.length, now).options.map(value => value.label)).toEqual([':00', ':15', ':30', ':45']);
  const completed = choose(withHour, ':30');
  const parsed = parseEntry(completed, now);
  expect(parsed.errors).toEqual([]);
  expect(new Date(parsed.start!).getHours()).toBe(15);
  expect(new Date(parsed.start!).getMinutes()).toBe(30);
});

it.each(['до завтра', 'срок завтра', 'начало завтра', 'конец завтра', 'напомнить завтра', 'remind tomorrow', 'напомнить в завтра'])('uses the same clock picker after %s', command => {
  const text = `Задача ${command}`;
  const completed = choose(choose(text, '18:'), ':45');
  const parsed = parseEntry(completed, now);
  expect(parsed.errors).toEqual([]);
  const value = parsed.start ?? parsed.due ?? parsed.end ?? parsed.reminders[0]?.at;
  expect(new Date(value!).getHours()).toBe(18);
  expect(new Date(value!).getMinutes()).toBe(45);
});

it.each(['Задача до 18:', 'Задача срок 18:', 'Задача начало 18:', 'Задача конец 18:', 'Задача напомнить 18:', 'Задача завтра 15:00 - 18:', 'Задача с завтра 15:00 по 18:'])('completes clock-only values and ranges: %s', text => {
  const completed = choose(text, ':15');
  expect(parseEntry(completed, now).errors).toEqual([]);
  expect(completed).toBe(text + '15 ');
});

it('preserves subsequent commands and supports manually typed arbitrary minutes', () => {
  const text = 'Встреча завтра 15:3 дорога 20м';
  expect(choose(text, ':30', text.indexOf(' дорога'))).toBe('Встреча завтра 15:30 дорога 20м');
  expect(parseEntry('Встреча завтра 15:37', now).errors).toEqual([]);
  expect(new Date(parseEntry('Встреча завтра 15:37', now).start!).getMinutes()).toBe(37);
});
