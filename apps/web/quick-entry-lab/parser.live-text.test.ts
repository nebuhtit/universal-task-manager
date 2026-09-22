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
  expect(suggest('На залив сегодня 09:00 срок 18', 'На залив сегодня 09:00 срок 18'.length, afternoon).options.map(option => option.label)).toEqual([':00', ':15', ':30', ':45']);
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

it('suggests ordered hours with localized details after a date', () => {
  const russian = suggest('Съесть завтра ', 'Съесть завтра '.length, now, 'ru');
  expect(russian.options.map(option => option.label)).toContain('18:');
  expect(russian.options[0]?.detail).toContain('сент.');
  expect(russian.options.some(option => /morning|remind/.test(option.label))).toBe(false);
  const english = suggest('Eat tomorrow ', 'Eat tomorrow '.length, now, 'en');
  expect(english.options[0]?.detail).toContain('Sep');
  expect(english.options.some(option => /утром|напомнить/.test(option.label))).toBe(false);
});

it('retains daypart recognition without suggesting dayparts', () => {
  for (const [part, hour] of [['утром', 7], ['днём', 11], ['вечером', 18], ['ночью', 21]] as const) {
    const text = `Звонок срок завтра ${part} напомнить в завтра ${part}`;
    expect(parseEntry(text, now)).toMatchObject({ title: 'Звонок', start: null, due: iso(2026, 8, 23, hour, 0), errors: [] });
    expect(parseEntry(text, now).reminders[0]?.at).toBe(iso(2026, 8, 23, hour, 0));
  }
});

it('offers every hour even for today, leaving the selected day unchanged', () => {
  const past = suggest('Встреча вторник ', 'Встреча вторник '.length, now, 'ru').options;
  expect(past).toHaveLength(24);
  expect(past.some(option => option.label === '08:')).toBe(true);
  expect(past.some(option => /напомнить|утром|evening/.test(option.label))).toBe(false);
});

it('offers only time choices once a complete date is entered', () => {
  const input = 'на залив 19.09';
  const choices = suggest(input, input.length, now, 'ru');
  expect(choices.ordered).toBe(true);
  expect(choices.options.map(option => option.label)).toEqual(Array.from({ length: 24 }, (_, index) => `${String((index + 6) % 24).padStart(2, '0')}:`));
  expect(choices.options.map(option => option.label)).not.toContain('вечером');
  expect(choices.options.map(option => option.label)).toContain('19:');
  expect(choices.options.some(option => /завтра|среда|Выбрать дату/.test(option.label))).toBe(false);
  const evening = choices.options.find(option => option.label === '19:')!;
  expect(input.slice(0, choices.start) + evening.insert + input.slice(choices.end)).toBe('на залив 19.09 19:');
});

it('rolls an elapsed month into next year and treats a bare hour as :00', () => {
  expect(parseEntry('Встреча 12.02', now).start).toBe(iso(2027, 1, 12, 9, 0));
  expect(parseEntry('Встреча 12.02 15', now).start).toBe(iso(2027, 1, 12, 15, 0));
  expect(parseEntry('Встреча завтра 15', now).start).toBe(iso(2026, 8, 23, 15, 0));
  expect(parseEntry('Встреча 19.09 15', now).start).toBe(iso(2026, 8, 19, 15, 0));
  expect(parseEntry('Встреча 12.02 вечером', now).start).toBe(iso(2027, 1, 12, 18, 0));
  expect(suggest('Встреча 12.02', 'Встреча 12.02'.length, now).options[0]!.detail).toContain('2027');
});

it('consumes the whole Russian calendar date including a two-digit year', () => {
  expect(parseEntry('13 марта 27 движ', now)).toMatchObject({ title: 'движ', start: iso(2027, 2, 13, 9, 0), errors: [] });
  expect(parseEntry('движ 13 марта 27 15', now)).toMatchObject({ title: 'движ', start: iso(2027, 2, 13, 15, 0), errors: [] });
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
