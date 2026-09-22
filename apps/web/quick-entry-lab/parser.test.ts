import { describe, expect, it } from 'vitest';
import { duration, examples, parseDate, parseEntry, suggest } from './parser';
const now = new Date(2026, 8, 21, 16, 0);
const iso = (day: number, hour: number, minute = 0) => new Date(2026, 8, day, hour, minute).toISOString();
describe('standalone quick entry', () => {
  it.each([
    ['Встреча завтра 10:00 - завтра 11:00', 'Встреча'],
    ['Встреча завтра 10:00 – завтра 11:00', 'Встреча'],
    ['Встреча завтра 10:00 — завтра 11:00', 'Встреча'],
    ['tomorrow 10:00 - tomorrow 11:00 Meeting', 'Meeting'],
    ['Meeting from tomorrow 10:00 to tomorrow 11:00', 'Meeting'],
    ['Стрижка 22.09.2026 10:00 - 22.09.2026 11:00', 'Стрижка'],
  ])('parses a date range: %s', (text, title) => {
    expect(parseEntry(text, now)).toMatchObject({ title, start: iso(22, 10), end: iso(22, 11), due: null, errors: [] });
  });
  it.each(['дорога', 'ехать', 'тт', 'tt', 'travel', 'travel time', 'drive'])('recognises travel alias %s', alias => {
    expect(parseEntry(`Meeting tomorrow 10:00 ${alias} 45m`, now)).toMatchObject({ title: 'Meeting', start: iso(22, 10), travelMinutes: 45, errors: [] });
  });
  it.each(['напомни', 'напомнить', 'напоминание', 'remind', 'reminder', 'r'])('recognises reminder alias %s', alias => {
    expect(parseEntry(`Meeting tomorrow 10:00 ${alias} 30m`, now)).toMatchObject({ title: 'Meeting', reminders: [{ at: iso(22, 9, 30) }], errors: [] });
  });
  it('keeps a title hyphen and ISO date hyphens out of the range grammar', () => {
    expect(parseEntry('Встреча - звонок 2026-09-22 10:00', now)).toMatchObject({ title: 'Встреча - звонок', start: iso(22, 10), end: iso(22, 11), errors: [] });
  });
  it.each(['Meeting tomorrow 10:00 -', 'Meeting - tomorrow 11:00'])('reports an incomplete dashed range: %s', text => {
    expect(parseEntry(text, now).errors).toContain('Для диапазона через тире укажите дату и время с обеих сторон.');
  });
  it('recognises English next weekday inside a dashed range', () => {
    expect(parseEntry('Meeting next fri 10:00 - next fri 11:00', now)).toMatchObject({ title: 'Meeting', start: new Date(2026, 9, 2, 10).toISOString(), end: new Date(2026, 9, 2, 11).toISOString(), errors: [] });
  });
  it('recognises English by as an independent due date', () => {
    expect(parseEntry('Homework by tomorrow 15:00', now)).toMatchObject({ title: 'Homework', due: iso(22, 15), start: null, end: null, durationMinutes: 10, errors: [] });
  });
  it.each(examples)('accepts the displayed example: %s', text => { expect(parseEntry(text, now).errors).toEqual([]); });
  it('resolves the requested haircut and both reminders relative to departure', () => {
    const draft = parseEntry(examples[0]!, now);
    expect(draft).toMatchObject({ title: 'Стрижка', start: iso(22, 15), travelMinutes: 45, leave: iso(22, 14, 15) });
    expect(draft.reminders.map(r => r.at)).toEqual([iso(21, 14, 15), iso(22, 12, 15)]);
    expect(draft.warnings).toHaveLength(1);
    expect(parseEntry(examples[1]!, now)).toEqual(draft);
  });
  it('recomputes departure reminders when travel changes', () => {
    const draft = parseEntry(examples[0]!.replace('45м', '1ч'), now);
    expect(draft.reminders[1]!.at).toBe(iso(22, 12));
  });
  it('distinguishes now, start and departure and computes end independently', () => {
    const draft = parseEntry('Встреча opens:tomorrow 10:00 tt:30m duration:1h r:start-15m,leave-1h,in45m', now);
    expect(draft.errors).toEqual([]); expect(draft.end).toBe(iso(22, 11));
    expect(draft.reminders.map(r => r.at)).toEqual([iso(22, 9, 45), iso(22, 8, 30), iso(21, 16, 45)]);
  });
  it('accepts command reordering', () => {
    expect(parseEntry('Стрижка r:leave-2h tt:45m opens:tomorrow 15:00', now).reminders[0]!.at).toBe(iso(22, 12, 15));
  });
  it('handles midnight, month and year rollover', () => {
    const draft = parseEntry('Поезд начало:завтра 00:15 tt:45m r:leave-2h', new Date(2026, 11, 31, 12));
    expect(draft.leave).toBe(new Date(2026, 11, 31, 23, 30).toISOString());
    expect(draft.reminders[0]!.at).toBe(new Date(2026, 11, 31, 21, 30).toISOString());
  });
  it('keeps quoted text literal and preserves emoji offsets', () => {
    const draft = parseEntry('💇 "Завтра дорога:45м" @завтра 15:00', now);
    expect(draft.title).toBe('💇 Завтра дорога:45м'); expect(draft.errors).toEqual([]); expect(draft.travelMinutes).toBeNull();
    expect(parseEntry('«Послезавтра» @завтра 15:00', now).title).toBe('Послезавтра');
  });
  it('defaults a deadline without a clock to 09:00', () => {
    expect(parseEntry('Отчёт срок:пятница', now).due).toBe(iso(25, 9));
    expect(parseEntry('Отчёт due:2026-09-25 18:00', now).due).toBe(iso(25, 18));
  });
  it('does not silently roll a past time into the future', () => {
    expect(parseEntry('Встреча @понедельник 10:00', now).due).toBe(iso(21, 10));
    expect(parseEntry('Встреча @понедельник 10:00', now).warnings.length).toBeGreaterThan(0);
  });
  it.each(['Дело @31.02.2026 15:00', 'Дело @2026-02-29 15:00', 'Дело @завтра 24:00', 'Дело @завтра 15:75', 'Дело @', 'Дело tt:-5m', 'Дело tt:0m', 'Дело r:leave-1h', 'Дело r:start-30m', 'Дело r:', 'Дело неизвестно:1ч', 'Дело @завтра 15:00 @сегодня 16:00', 'Дело напомнить за', '"Дело @завтра 15:00', ''])('reports incomplete or invalid input: %s', text => { expect(parseEntry(text, now).errors.length).toBeGreaterThan(0); });
  it('adds repeated reminder commands', () => { const parsed = parseEntry('Дело r:in1h r:in2h', now); expect(parsed.errors).toEqual([]); expect(parsed.reminders.map(r => r.minutes)).toEqual([60, 120]); });
  it.each([['45min', 45], ['1ч30м', 90], ['1h 30m', 90], ['1.5h', 90], ['2 дня', 2880], ['10xyz', null], ['-1ч', null], ['Infinityh', null], ['999999999d', null]])('parses duration %s', (text, expected) => { expect(duration(String(text))).toBe(expected); });
  it('rejects oversized input early', () => { expect(parseEntry('x'.repeat(2001), now).errors).toEqual(['Максимум 2000 символов.']); });
  it('rejects zero travel in the natural-language form', () => { expect(parseEntry('Дело завтра в 15 00 ехать 0 мин', now).errors.length).toBeGreaterThan(0); });
});
describe('completion', () => {
  it('completes Russian date prefixes', () => { expect(suggest('Дело @за', 8, now).options[0]!.insert).toBe('@завтра 16:15 '); });
  it('preserves preceding reminders when adding another', () => { expect(suggest('Дело r:выезд-1д,вы', 18).options[0]!.insert).toBe('r:выезд-1д,выезд-2ч '); });
  it('replaces the whole token at the caret without altering later commands', () => {
    const text = 'Дело дорога:45м @завтра 15:00', caret = text.indexOf(':') + 1;
    const result = suggest(text, caret); expect(text.slice(result.end)).toBe(' @завтра 15:00');
    expect(result.options[0]!.insert).toBe('дорога:15м ');
  });
  it('does not offer commands inside quoted titles', () => { expect(suggest('"Дело @за', 9).options).toEqual([]); });
});

 describe('editing regressions', () => {
  it('preserves existing time while completing a date in the middle', () => {
    const text = 'Стрижка @завт 15:10 дорога: напомнить:';
    const result = suggest(text, text.indexOf(' 15:10'));
    expect(result.options[0]!.label).toBe('@завтра 15:10');
    const completed = text.slice(0, result.start) + result.options[0]!.insert + text.slice(result.end);
    expect(completed).toBe('Стрижка @завтра 15:10 дорога: напомнить:');
  });
  it('clearing duration clears its validation and value', () => {
    const result = parseEntry('Стрижка @завтра 15:10 дорога: длительность:', now);
    expect(result.errors).toEqual([]); expect(result.travelMinutes).toBeNull(); expect(result.durationMinutes).toBe(10);
    expect(parseEntry('Стрижка @завтра 15:10 дорога:xyz', now).errors.length).toBeGreaterThan(0);
  });
  it.each(['Дело напомнить:', 'Дело дорога: напомнить:', '"выезд дорога:45м" напомнить:'])('hides departure without meaningful context: %s', text => {
    expect(suggest(text, text.length).options.some(option => option.label.startsWith('выезд'))).toBe(false);
  });
  it.each(['Дело дорога:45м напомнить:', 'Дело tt:1h r:', 'Дело ехать 45 мин напомнить:', 'Дело напомнить:выезд-1д,', 'Дело напомнить:вы'])('offers departure with explicit context: %s', text => {
    expect(suggest(text, text.length).options.some(option => option.label.startsWith('выезд'))).toBe(true);
  });
});

describe('start-first scheduling', () => {
  it('maps bare dates to event opens and explicit @ to due', () => {
    expect(parseEntry('Дело завтра в 15 10', now)).toMatchObject({ start: iso(22, 15, 10), end: iso(22, 16, 10), due: null });
    expect(parseEntry('Дело @завтра 15:10', now)).toMatchObject({ due: iso(22, 15, 10), start: null, end: null });
  });
  it('keeps due, event opens and event ends independent', () => {
    const draft = parseEntry('Дело @завтра 18:00 event opens:завтра 15:00 event ends:завтра 16:00 r:30m', now);
    expect(draft.errors).toEqual([]);
    expect(draft).toMatchObject({ due: iso(22, 18), start: iso(22, 15), end: iso(22, 16) });
    expect(draft.reminders[0]).toMatchObject({ anchor: 'start', automatic: true, at: iso(22, 14, 30) });
  });
  it('switches default reminders as opens is added and removed regardless of order', () => {
    const text = 'Дело r:30m @завтра 18:00';
    expect(parseEntry(text, now).reminders[0]).toMatchObject({ anchor: 'due', at: iso(22, 17, 30) });
    expect(parseEntry(text + ' начало:завтра 15:00', now).reminders[0]).toMatchObject({ anchor: 'start', at: iso(22, 14, 30) });
    expect(parseEntry(text, now).reminders[0]).toMatchObject({ anchor: 'due', at: iso(22, 17, 30) });
  });
  it('does not override explicitly anchored reminders', () => {
    const draft = parseEntry('Дело @завтра 18:00 opens:завтра 15:00 r:due-30m,start-1h', now);
    expect(draft.errors).toEqual([]); expect(draft.reminders.map(r => r.at)).toEqual([iso(22, 17, 30), iso(22, 14)]);
  });
  it('uses 09:00 for a date without a clock, including reminders', () => {
    expect(parseEntry('Дело @завтра', now)).toMatchObject({ due: iso(22, 9), errors: [] });
    expect(parseEntry('Дело @завтра r:30m', now).reminders[0]?.at).toBe(iso(22, 8, 30));
  });
  it('supports aliases and validates conflicting end/duration', () => {
    expect(parseEntry('Дело начало:завтра 15:00 конец:завтра 16:00', now).errors).toEqual([]);
    expect(parseEntry('Дело opens:завтра 15:00 ends:завтра 14:00', now).errors.length).toBeGreaterThan(0);
    expect(parseEntry('Дело opens:завтра 15:00 ends:завтра 16:00 duration:2h', now).errors.length).toBeGreaterThan(0);
  });
  it('offers labelled dates and explains the current default anchor', () => {
    const text = 'Дело event opens:за'; expect(suggest(text, text.length, now).options[0]!.insert).toBe('event opens:завтра 16:15 ');
    for (const [text, anchor] of [['Дело @завтра 18:00 r:', 'due'], ['Дело начало:завтра 15:00 r:', 'event opens']]) {
      expect(suggest(text!, text!.length).options.find(o => o.label === '30м')!.detail).toContain(anchor);
    }
  });
});

describe('contextual date completion', () => {
  it('offers only quarter-hour minutes after the hour', () => {
    const expected = [':00', ':15', ':30', ':45'];
    for (const input of ['Дело @завтра 15:', 'Дело завтра 15:', 'Дело начало завтра 15:']) {
      const labels = suggest(input, input.length, now).options.map(option => option.label);
      expect(labels).toEqual(expected);
    }
  });
  it('treats a bare hour as :00 when the caret is after a space', () => {
    const morning = new Date(2026, 8, 21, 10, 26);
    for (const input of ['Дело сегодня 14 ', 'Дело завтра 14 ', 'Дело начало завтра 14 ']) {
      const result = suggest(input, input.length, morning);
      expect(parseEntry(input, morning).start).toBe(parseDate(input.replace(/^Дело (?:начало )?/, '').trim(), morning)!.iso);
      expect(new Date(parseEntry(input, morning).start!).getMinutes()).toBe(0);
      expect(result.options.map(option => option.label)).not.toContain('14:15');
    }
  });
  it('offers tomorrow, future today and weekday choices preserving the time', () => {
    const text = 'Дело @завтра 15:10 r:'; const caret = text.indexOf(' 15:10');
    const early = suggest(text, caret, new Date(2026, 8, 21, 14));
    expect(early.options.map(o => o.label)).toContain('@сегодня 15:10');
    expect(early.options.map(o => o.label)).toContain('@вторник 15:10');
    expect(suggest(text, caret, now).options.map(o => o.label)).not.toContain('@сегодня 15:10');
  });
  it('completes partial minutes without damaging the following command', () => {
    const text = 'Дело @завтра 15:1 напомнить:'; const caret = text.indexOf(' напомнить:');
    const result = suggest(text, caret, now);
    expect(result.options.map(o => o.label)).toEqual([':15']);
    expect(text.slice(0, result.start) + result.options[0]!.insert + text.slice(result.end)).toBe('Дело @завтра 15:15 напомнить:');
  });
  it('completes missing time and empty commands followed by whitespace', () => {
    const text = 'Дело @сегодня ';
    expect(suggest(text, text.length, now).options[0]!.label).toBe('06:');
    expect(suggest('Дело r: ', 8, now).options[0]!.label).toBe('30м');
  });
  it('offers calendar insertion preserving time and target field', () => {
    const text = 'Дело event ends:завтра 15:10';
    const option = suggest(text, text.indexOf(' 15:10'), now).options.find(o => o.calendar)!;
    expect(option.insert).toBe('event ends:__DATE__ 15:10 ');
  });
});

describe('reminder cursor context', () => {
  it.each(['напомнить:', 'напомнить: ', 'напомнить: 1', 'напомнить: 1 день', 'напомнить: 1 день '])('keeps duration options inside %s', command => {
    const text = 'футбол @чт 15 00 ' + command;
    const result = suggest(text, text.length, now);
    expect(result.options.length).toBeGreaterThan(0);
    expect(result.options.every(o => o.insert.startsWith('напомнить:') && !o.calendar)).toBe(true);
    expect(result.start).toBe(text.indexOf('напомнить:'));
  });
  it('replaces a spaced reminder without changing other commands or later reminders', () => {
    const text = 'футбол @чт 15 00 напомнить: 1 день,2ч дорога:';
    const result = suggest(text, text.indexOf(' день'), now);
    const option = result.options.find(o => o.label === '1ч')!;
    expect(text.slice(0, result.start) + option.insert + text.slice(result.end)).toBe('футбол @чт 15 00 напомнить:1ч,2ч  дорога:');
  });
});

describe('relaxed syntax', () => {
  it('parses a paired event range without setting due', () => {
    expect(parseEntry('Встреча с завтра 10:00 по завтра 11:00', now)).toMatchObject({
      title: 'Встреча', start: iso(22, 10), end: iso(22, 11), due: null, errors: [],
    });
    expect(parseEntry('Встреча срок пятница с завтра утром по завтра вечером', now)).toMatchObject({
      title: 'Встреча', due: iso(25, 9), start: iso(22, 7), end: iso(22, 18), errors: [],
    });
  });
  it('offers context dates for both range boundaries', () => {
    const opens = 'Встреча с ';
    expect(suggest(opens, opens.length, now).options[0]?.label).toBe('с сегодня 09:00');
    const ends = 'Встреча с завтра 10:00 по ';
    expect(suggest(ends, ends.length, now).options[0]?.label).toBe('11:');
    expect(suggest('Встреча с другом', 'Встреча с другом'.length, now).options).toEqual([]);
  });
  it.each(['Встреча с завтра', 'Встреча по пятницу', 'Встреча с завтра по', 'Встреча с завтра по завтра'])('requires a complete and ordered range: %s', value => {
    expect(parseEntry(value, now).errors.length).toBeGreaterThan(0);
  });
  it('rejects reversed and duplicate boundaries but leaves ordinary prose intact', () => {
    expect(parseEntry('Встреча с завтра 11:00 по завтра 10:00', now).errors).toContain('Event ends должен быть позже event opens.');
    expect(parseEntry('Встреча с завтра 10:00 по завтра 11:00 начало завтра 09:00', now).errors).toContain('Параметр «start» указан несколько раз.');
    expect(parseEntry('Встреча с другом по работе', now)).toMatchObject({ title: 'Встреча с другом по работе', start: null, end: null, errors: [] });
  });
  it('understands the deadline phrase from the screenshot', () => {
    const tuesday = new Date(2026, 8, 22, 8, 51);
    expect(parseEntry('позвонить в срок в след пт', tuesday)).toMatchObject({ title: 'позвонить', due: new Date(2026, 9, 2, 9).toISOString(), errors: [] });
    expect(parseEntry('позвонить длительность 45м в срок в след пт вечером начало сегодня 09:00', tuesday)).toMatchObject({
      title: 'позвонить', durationMinutes: 45,
      due: new Date(2026, 9, 2, 18).toISOString(),
      start: new Date(2026, 8, 22, 9).toISOString(),
      end: new Date(2026, 8, 22, 9, 45).toISOString(), errors: [],
    });
  });
  it.each([
    ['Дело завтра', 9], ['Дело завтра утром', 7], ['Дело завтра днем', 11],
    ['Дело завтра днём', 11], ['Дело завтра вечером', 18], ['Дело завтра ночью', 21],
  ])('uses the requested time for %s', (text, hour) => {
    expect(parseEntry(text, now)).toMatchObject({ title: 'Дело', start: iso(22, hour), end: iso(22, hour + 1), due: null, errors: [] });
  });
  it('applies the same defaults to event boundaries and the next calendar week', () => {
    expect(parseEntry('Дело начало завтра утром конец завтра вечером', now)).toMatchObject({ start: iso(22, 7), end: iso(22, 18), errors: [] });
    const tuesday = new Date(2026, 8, 22, 8, 51);
    expect(parseEntry('Дело след пн ночью', tuesday).start).toBe(new Date(2026, 8, 28, 21).toISOString());
    expect(parseEntry('Дело след пт 14 22', tuesday).start).toBe(new Date(2026, 9, 2, 14, 22).toISOString());
  });
  it.each([
    ['Встреча 25 сентября 2026 в 15:10', iso(25, 15, 10)],
    ['Встреча в следующую пятницу 15:10', new Date(2026, 9, 2, 15, 10).toISOString()],
    ['Встреча 15:10 пятница', iso(25, 15, 10)],
    ['Встреча Friday 15:10', iso(25, 15, 10)],
  ])('uses Chrono for broader natural dates: %s', (text, start) => {
    expect(parseEntry(text, now)).toMatchObject({ start });
  });
  it('preserves time written before a day or date', () => {
    expect(parseEntry('Футбол 15 00 пятница', now)).toMatchObject({ start: iso(25, 15) });
    expect(parseEntry('Футбол 15:10 25.09.2026', now)).toMatchObject({ start: iso(25, 15, 10) });
    expect(parseEntry('Встреча начало 15 00 пятница', now)).toMatchObject({ start: iso(25, 15) });
  });
  it('consumes the entire “next weekday” Russian phrase', () => {
    const draft = parseEntry('в следующий чт 17 32', now);
    expect(draft).toMatchObject({ title: '', start: new Date(2026, 9, 1, 17, 32).toISOString() });
    expect(draft.errors).toContain('Добавьте название.');
  });
  it('consumes “в следующий” after a task title', () => {
    const draft = parseEntry('в магаз в следующий пт 14 22', now);
    expect(draft).toMatchObject({ title: 'в магаз', start: new Date(2026, 9, 2, 14, 22).toISOString() });
    const typo = parseEntry('в магаз в следущий пт 14 22', now);
    expect(typo).toMatchObject({ title: 'в магаз', start: new Date(2026, 9, 2, 14, 22).toISOString() });
  });
  it('moves “next weekday” to the next calendar week', () => {
    const thursday = new Date(2026, 8, 24, 12);
    expect(parseEntry('Дело в следующий четверг 17:32', thursday).start).toBe(new Date(2026, 9, 1, 17, 32).toISOString());
  });
  it.each(['завтра', 'среда', 'ср', '23.09.2026', '2026-09-23'])('understands a bare date %s', date => {
    const result = parseEntry(`Дело ${date}`, now); expect(result.errors).toEqual([]); expect(result.start).not.toBeNull(); expect(result.title).toBe('Дело');
  });
  it('parses labels and default reminders without punctuation', () => {
    const result = parseEntry('футбол до чт 15 00 начало чт 14:00 конец чт 16:00 напоминание за 1 день и 2 часа', now);
    expect(result.errors).toEqual([]); expect(result.title).toBe('футбол'); expect(result.reminders).toHaveLength(2); expect(result.reminders[0]!.anchor).toBe('start');
  });
  it('keeps travel and departure reminders without colons', () => {
    const result = parseEntry('Стрижка начало завтра 15:00 дорога 45 мин напомнить за день и 2 ч до выезда', now);
    expect(result.errors).toEqual([]); expect(result.leave).toBe(iso(22, 14, 15)); expect(result.reminders[1]!.at).toBe(iso(22, 12, 15));
  });
  it('preserves quoted literal labels and dates', () => {
    const result = parseEntry('"начало завтра конец среда" срок пятница', now);
    expect(result.errors).toEqual([]); expect(result.title).toBe('начало завтра конец среда');
  });
  it('offers reminders without colons and bare-date completion', () => {
    const text = 'Дело завтра 15:10 напомнить 1 день';
    expect(suggest(text, text.length, now).options[0]!.insert).toMatch(/^напомнить /);
    const result = suggest(text, text.indexOf(' 15:10'), now);
    expect(result.options[0]!.insert).toBe('завтра 15:10');
    expect(text.slice(0, result.start) + result.options[0]!.insert + text.slice(result.end)).toBe(text);
  });
  it('keeps time-first order in weekday completion', () => {
    const text = 'Футбол 15 00 пятница';
    const result = suggest(text, text.length, now);
    expect(result.options[0]!.label).toBe('15:00 пятница');
    expect(result.options[0]!.insert).toBe('15:00 пятница ');
  });
  it('keeps next-weekday meaning in completion', () => {
    const text = 'в магаз в следущий пт 14 22';
    const result = suggest(text, text.length, now);
    expect(result.options[0]).toMatchObject({ label: 'пт 14:22', detail: '2 октября · следующая неделя' });
    expect(parseEntry(text.slice(0, result.start) + result.options[0]!.insert + text.slice(result.end), now)).toMatchObject({ title: 'в магаз', start: new Date(2026, 9, 2, 14, 22).toISOString() });
  });
  it('expands short Russian dates and commands without colons', () => {
    for (const [partial, expected] of [['с', 'сегодня'], ['се', 'сегодня'], ['з', 'завтра'], ['зав', 'завтра'], ['сро', 'срок'], ['нап', 'напомнить'], ['след', 'след']]) {
      const input = `Дело ${partial}`;
      expect(suggest(input, input.length, now).options.map(option => option.label)).toContain(expected);
    }
    expect(suggest('Дело след ', 'Дело след '.length, now).options.find(option => option.label === 'след пт')?.detail).toBe('2 октября');
    expect(parseEntry('в магаз в след пт 14 22', now)).toMatchObject({ title: 'в магаз', start: new Date(2026, 9, 2, 14, 22).toISOString() });
    expect(suggest('Дело срок ', 'Дело срок '.length, now).options[0]?.insert).not.toContain('срок:');
    expect(suggest('Дело напомнить ', 'Дело напомнить '.length, now).options[0]?.insert).not.toContain('напомнить:');
  });
});
