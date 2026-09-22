import { expect, it } from 'vitest';
import { parseEntry, suggest } from './parser';
import { materializeQuickEntryText } from '../src/features/items/quickEntry';

const now = new Date(2026, 8, 22, 13, 10);
const iso = (year: number, month: number, day: number, hour = 13, minute = 10) => new Date(year, month, day, hour, minute).toISOString();

it('keeps one suggestion for inflected reminder commands', () => {
  const options = suggest('Звонок напом', 'Звонок напом'.length, now).options;
  expect(options.map(option => option.label)).toEqual(['напомнить']);
  expect(parseEntry('Звонок завтра 15:00 напомни 30м', now).errors).toEqual([]);
});

it('resolves month and next period to the same day and time', () => {
  expect(parseEntry('Поездка октября', now)).toMatchObject({ start: iso(2026, 9, 22), title: 'Поездка', errors: [] });
  expect(parseEntry('Поездка след месяц', now)).toMatchObject({ start: iso(2026, 9, 22), title: 'Поездка', errors: [] });
  expect(parseEntry('Поездка след год', now)).toMatchObject({ start: iso(2027, 8, 22), title: 'Поездка', errors: [] });
  expect(parseEntry('Поездка октября 10:30', now)).toMatchObject({ start: iso(2026, 9, 22, 10, 30), errors: [] });
  const month = suggest('Поездка окт', 'Поездка окт'.length, now).options;
  expect(month.some(option => option.insert === 'октября ')).toBe(true);
  expect(suggest('Поездка се', 'Поездка се'.length, now).options.some(option => option.insert === 'сегодня ')).toBe(true);
  expect(parseEntry(materializeQuickEntryText('Поездка след месяц', now), now).start).toBe(iso(2026, 9, 22));
});

it('makes now a due in ten minutes', () => {
  expect(parseEntry('Звонок сейчас', now)).toMatchObject({ title: 'Звонок', due: iso(2026, 8, 22, 13, 20), start: null, durationMinutes: 10, errors: [] });
  expect(parseEntry('now', now)).toMatchObject({ title: 'Сейчас', due: iso(2026, 8, 22, 13, 20), start: null, errors: [] });
  expect(parseEntry(materializeQuickEntryText('Звонок сейчас', now), new Date(2026, 8, 24)).due).toBe(iso(2026, 8, 22, 13, 20));
});

it('treats a clock-only до as the next due time, not an event start', () => {
  const afternoon = new Date(2026, 8, 22, 14, 40);
  expect(parseEntry('Пук до 9 00', afternoon)).toMatchObject({ title: 'Пук', start: null, due: iso(2026, 8, 23, 9, 0), errors: [] });
  expect(parseEntry('Пук до 16:00', afternoon)).toMatchObject({ title: 'Пук', start: null, due: iso(2026, 8, 22, 16, 0), errors: [] });
  const frozen = materializeQuickEntryText('Пук до 9 00', afternoon);
  expect(parseEntry(frozen, new Date(2026, 8, 25))).toMatchObject({ title: 'Пук', start: null, due: iso(2026, 8, 23, 9, 0), errors: [] });
});

it('reads and suggests a clock-only срок without swallowing Enter', () => {
  const afternoon = new Date(2026, 8, 22, 14, 55);
  const text = 'На залив сегодня 09:00 срок 18:00';
  expect(parseEntry(text, afternoon)).toMatchObject({ title: 'На залив', start: iso(2026, 8, 22, 9, 0), due: iso(2026, 8, 22, 18, 0), errors: [] });
  expect(parseEntry('На залив завтра 09:00 срок 18 00', afternoon)).toMatchObject({ due: iso(2026, 8, 23, 18, 0), errors: [] });
  expect(parseEntry('На залив срок 09:00', afternoon)).toMatchObject({ start: null, due: iso(2026, 8, 23, 9, 0), errors: [] });
  expect(suggest('На залив сегодня 09:00 срок 18', 'На залив сегодня 09:00 срок 18'.length, afternoon).options.map(option => option.label)).toEqual(['срок 18:00', 'срок 18:15', 'срок 18:30', 'срок 18:45']);
  expect(suggest(text, text.length, afternoon).options.map(option => option.label)).toEqual(['срок 18:00']);
  expect(parseEntry(materializeQuickEntryText(text, afternoon), new Date(2026, 8, 29)).due).toBe(iso(2026, 8, 22, 18, 0));
});

it('reads a compact same-day clock range after a date', () => {
  expect(parseEntry('съесть завтра 15 - 18 00', now)).toMatchObject({
    title: 'съесть', start: iso(2026, 8, 23, 15, 0), end: iso(2026, 8, 23, 18, 0), durationMinutes: 180, errors: [],
  });
  expect(parseEntry('съесть среда 17-19', now)).toMatchObject({ title: 'съесть', start: iso(2026, 8, 23, 17, 0), end: iso(2026, 8, 23, 19, 0), errors: [] });
  expect(parseEntry('съесть 19.09 15-21', now)).toMatchObject({ title: 'съесть', start: iso(2026, 8, 19, 15, 0), end: iso(2026, 8, 19, 21, 0), errors: [] });
});

it('suggests dayparts and language-matched commands after a date', () => {
  const russian = suggest('Съесть завтра ', 'Съесть завтра '.length, now, 'ru');
  expect(russian.options.map(option => option.label)).toContain('вечером');
  expect(russian.options.some(option => /напомнить/.test(option.label))).toBe(true);
  expect(russian.options.some(option => /morning|remind/.test(option.label))).toBe(false);
  const english = suggest('Eat tomorrow ', 'Eat tomorrow '.length, now, 'en');
  expect(english.options.some(option => /morning|afternoon|evening|night/.test(option.label))).toBe(true);
  expect(english.options.some(option => /утром|напомнить/.test(option.label))).toBe(false);
});

it('turns a dated reminder daypart into due and a reminder at the same time', () => {
  const input = 'Звонок завтра';
  const suggestions = suggest(input, input.length, now, 'ru');
  for (const [label, hour] of [['напомнить утром', 7], ['напомнить днём', 11], ['напомнить вечером', 18], ['напомнить ночью', 21]] as const) {
    const option = suggestions.options.find(candidate => candidate.label === label)!;
    expect(option).toBeDefined();
    const text = input.slice(0, option.replaceStart ?? suggestions.start) + option.insert + input.slice(option.replaceEnd ?? suggestions.end);
    expect(parseEntry(text, now)).toMatchObject({ title: 'Звонок', start: null, due: iso(2026, 8, 23, hour, 0), errors: [] });
    expect(parseEntry(text, now).reminders[0]?.at).toBe(iso(2026, 8, 23, hour, 0));
  }
});

it('explains reminder suggestions with the actual time and hides past reminders', () => {
  const future = suggest('Встреча завтра ', 'Встреча завтра '.length, now, 'ru').options;
  expect(future.some(option => option.label.includes('08:00') && option.detail.includes('60 мин до начала'))).toBe(true);
  const past = suggest('Встреча вторник ', 'Встреча вторник '.length, now, 'ru').options;
  expect(past.some(option => option.label.includes('08:00'))).toBe(false);
  expect(past.some(option => option.label === 'напомнить вечером')).toBe(true);
});

it('offers only time choices once a complete date is entered', () => {
  const input = 'на залив 19.09';
  const choices = suggest(input, input.length, now, 'ru');
  expect(choices.options.map(option => option.label)).toContain('вечером');
  expect(choices.options.map(option => option.label)).toContain('19:00');
  expect(choices.options.some(option => /завтра|среда|Выбрать дату/.test(option.label))).toBe(false);
  const evening = choices.options.find(option => option.label === 'вечером')!;
  expect(input.slice(0, choices.start) + evening.insert + input.slice(choices.end)).toBe('на залив 19.09 вечером ');
});

it('offers follow-up commands instead of another date after day and time are set', () => {
  for (const input of ['апваап завтра утром', 'апваап завтра утром ', 'апваап завтра 15:00']) {
    const suggestions = suggest(input, input.length, now, 'ru');
    expect(suggestions.options.map(option => option.label)).toEqual(['напомнить', 'длительность', 'дорога', 'конец', 'срок']);
    expect(suggestions.start).toBe(input.length);
    const reminder = suggestions.options[0]!;
    expect(input.slice(0, suggestions.start) + reminder.insert + input.slice(suggestions.end)).toBe(`${input.trimEnd()} напомнить `);
  }
  const english = 'Meeting tomorrow morning';
  expect(suggest(english, english.length, now, 'en').options.map(option => option.label)).toEqual(['remind', 'duration', 'travel', 'event ends', 'due']);
});

it('shows next month and year only after typing the next-period command', () => {
  expect(suggest('тест ', 'тест '.length, now, 'ru').options.map(option => option.label)).not.toContain('след месяц');
  expect(suggest('тест ', 'тест '.length, now, 'ru').options.map(option => option.label)).not.toContain('след год');
  expect(suggest('тест след м', 'тест след м'.length, now, 'ru').options.map(option => option.label)).toContain('след месяц');
  expect(suggest('тест след г', 'тест след г'.length, now, 'ru').options.map(option => option.label)).toContain('след год');
});
