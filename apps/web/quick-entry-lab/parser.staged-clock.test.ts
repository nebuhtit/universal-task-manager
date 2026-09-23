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

it('suggests relative and future clock reminders after н/r, with more durations after через', () => {
  const clock = new Date(2026, 8, 23, 9, 51);
  const russian = suggest('Приготовить поесть 2ч н', 'Приготовить поесть 2ч н'.length, clock, 'ru');
  expect(russian.options.map(option => option.label)).toContain('через 45м');
  expect(russian.options.map(option => option.label)).toContain('в 12:00');
  expect(russian.options.map(option => option.label)).not.toContain('в 09:00');
  const english = suggest('Cook 2h r', 'Cook 2h r'.length, clock, 'en');
  expect(english.options.map(option => option.label)).toContain('in 1h');
  expect(english.options.map(option => option.label)).toContain('at 15:00');
  const through = suggest('Приготовить поесть 2ч н через', 'Приготовить поесть 2ч н через'.length, clock, 'ru');
  expect(through.options).toHaveLength(11);
  const choice = through.options.find(option => option.label === 'через 3ч')!;
  const text = 'Приготовить поесть 2ч н через';
  const completed = text.slice(0, through.start) + choice.insert + text.slice(through.end);
  expect(completed).toBe('Приготовить поесть 2ч н через3ч ');
  expect(parseEntry(completed, clock).errors).toEqual([]);
});

it.each(['Даша чт 17 00-', 'Даша чт 17:00 -', 'Даша с чт 17:00 по ', 'Даша завтра 17:00-', 'Даша 12.06.2027 17:00-'])('orders range-end hours from the start: %s', text => {
  const options = suggest(text, text.length, now).options;
  expect(options[0]?.label).toBe('18:');
  expect(options[5]?.label).toBe('23:');
  expect(options[6]?.label).toBe('следующий день 00:');
  const withHour = choose(text, 'следующий день 00:');
  const parsed = parseEntry(choose(withHour, ':15'), now);
  expect(parsed.errors).toEqual([]);
  expect(Date.parse(parsed.end!) - Date.parse(parsed.start!)).toBe(7.25 * 3600000);
  const next = new Date(parsed.start!); next.setDate(next.getDate() + 1);
  expect(new Date(parsed.end!).getDate()).toBe(next.getDate());
});

it.each(['due ', 'до ', 'срок ', 'напомнить ', 'конец '])('reuses entered date and clock after %s', command => {
  const text = `Даша 12.06 15:00 ${command}`;
  const options = suggest(text, text.length, now).options;
  if (command !== 'конец ') {
    expect(options[0]?.label).toContain('2027-06-12 15:00');
    expect(options.every(option => option.label.endsWith('15:00'))).toBe(true);
  } else expect(options[0]?.label).toBe('16:');
});

it.each([15, 23])('starts end-hour suggestions after %s and keeps same-hour manual minutes', hour => {
  const prefix = `Даша пт ${hour}:00 -`;
  const options = suggest(prefix, prefix.length, now).options;
  expect(options[0]?.label).toBe(hour === 23 ? 'следующий день 00:' : '16:');
  expect(options.some(option => option.label === `${hour}:`)).toBe(false);
  const parsed = parseEntry(`${prefix} ${hour}:15`, now);
  expect(parsed.errors).toEqual([]);
  expect(Date.parse(parsed.end!) - Date.parse(parsed.start!)).toBe(15 * 60000);
});

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
