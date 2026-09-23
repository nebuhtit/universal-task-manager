/** Standalone experiment. No UTM imports, storage, network or execution of input. */
import { en, ru } from 'chrono-node';
import { extractOrganization } from './organization';
export type Anchor = 'due' | 'start' | 'leave' | 'now';
export interface ReminderDraft { anchor: Anchor; minutes: number; at: string | null; automatic?: boolean }
export interface Draft {
  noDateDefaults?: boolean;
  noDefaultReminders?: boolean;
  commandSpans?: Array<{ start: number; end: number }>;
  isNote?: boolean;
  areas?: string[];
  projects?: string[];
  tags?: string[];
  plannedDate?: string;
  dateOnlyStart?: boolean;
  title: string; start: string | null; due: string | null; end: string | null;
  travelMinutes: number | null; travelBackMinutes?: number; durationMinutes: number | null; leave: string | null;
  reminders: ReminderDraft[]; errors: string[]; warnings: string[];
}
export const examples = [
  'Стрижка начало завтра 15:00 дорога 45м напомнить выезд-1д,выезд-2ч',
  'Стрижка начало завтра в 15 00 ехать 45 мин напомнить за день и 2 ч до выезда',
  'Встреча event opens tomorrow 10:00 tt 30m duration 1h r start-15m,leave-1h',
  'Позвонить напомнить через45м',
  'Отчёт завтра 15:10 напомнить 30м',
  'Встреча до завтра 18:00 event opens завтра 15:00 event ends завтра 16:00 напомнить 30м',
  '"Посмотреть Послезавтра" суббота 20:00',
  'Даша вс 15 00',
  'Домашнее задание до вс 15 00',
];
const weekdays: Record<string, number> = {
  вс: 0, воскресенье: 0, sunday: 0, sun: 0, пн: 1, понедельник: 1, monday: 1, mon: 1,
  вт: 2, вторник: 2, tuesday: 2, tue: 2, ср: 3, среда: 3, среду: 3, wednesday: 3, wed: 3,
  чт: 4, четверг: 4, thursday: 4, thu: 4, пт: 5, пятница: 5, friday: 5, fri: 5,
  сб: 6, суббота: 6, субботу: 6, saturday: 6, sat: 6, пятницу: 5,
};
const relativeDays: Record<string, number> = { сегодня: 0, today: 0, завтра: 1, tomorrow: 1, послезавтра: 2 };
const months = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const monthForms = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const monthAliases = Object.fromEntries(months.flatMap((name, index) => [[name, index], [monthForms[index]!, index]])) as Record<string, number>;
const monthPattern = Object.keys(monthAliases).sort((a, b) => b.length - a.length).join('|');
const dayPattern = [...Object.keys(relativeDays), ...Object.keys(weekdays)].sort((a, b) => b.length - a.length).join('|');
const weekdayPattern = Object.keys(weekdays).sort((a, b) => b.length - a.length).join('|');
const numericDateExpression = '(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\.\\d{1,2}(?:\\.\\d{4})?)';
const dayExpression = `(?:(?:${weekdayPattern})\\s+${numericDateExpression}|${dayPattern}|${numericDateExpression}|${monthPattern})`;
const nextDayExpression = `(?:след|следу(?:ю)?щ(?:ий|ую|ая|ем)|next)\\s+(?:${weekdayPattern}|месяц|месяце|год|году)`;
const dayPartPattern = 'утром|днём|днем|вечером|ночью|morning|afternoon|evening|night';
export const dateValueExpression = `(?:${dayExpression}|${nextDayExpression})(?:\\s+(?:в\\s+)?(?:${dayPartPattern}))?(?:(?:\\s+в)?\\s+\\d{1,2}(?:(?::|\\s)\\d{2})?)?`;
const dayPartHours: Record<string, number> = { утром: 7, днём: 11, днем: 11, вечером: 18, ночью: 21, morning: 7, afternoon: 11, evening: 18, night: 21 };
const addMinutes = (date: string, minutes: number) => new Date(new Date(date).getTime() + minutes * 60_000).toISOString();

export function duration(value: string): number | null {
  const units: Record<string, number> = { m: 1, min: 1, minute: 1, minutes: 1, м: 1, мин: 1, минут: 1, минута: 1, минуты: 1, h: 60, hour: 60, hours: 60, ч: 60, час: 60, часа: 60, часов: 60, d: 1440, day: 1440, days: 1440, д: 1440, день: 1440, дня: 1440, дней: 1440, w: 10080, week: 10080, weeks: 10080, н: 10080, нед: 10080, неделя: 10080, неделю: 10080, недели: 10080, недель: 10080 };
  const source = value.toLowerCase().trim()
    .replace(/полтора\s+часа|an?\s+hour\s+and\s+a\s+half/g, '90m')
    .replace(/полчаса|half\s+an?\s+hour/g, '30m')
    .replace(/^(?:сутки|суток|a\s+day)$/, '1d')
    .replace(/^(?:час|an?\s+hour)$/, '1h')
    .replace(/^(?:день)$/, '1d')
    .replace(/^(?:неделю|неделя|a\s+week)$/, '1w')
    .replace(/\s/g, '');
  const matches = [...source.matchAll(/(\d+(?:[.,]\d+)?)([a-zа-я]+)/g)];
  if (!matches.length || matches.map(m => m[0]).join('') !== source) return null;
  let minutes = 0;
  for (const m of matches) { const unit = units[m[2]!]; if (!unit) return null; minutes += Number(m[1]!.replace(',', '.')) * unit; }
  return Number.isFinite(minutes) && minutes > 0 && minutes <= 5256000 ? minutes : null;
}

export function parseDate(value: string, now: Date): { iso: string; timed: boolean; explicitClock: boolean } | null {
  const reversed = new RegExp(`^(\\d{1,2})(?::|\\s)(\\d{2})\\s+(${dayExpression}|${nextDayExpression})$`, 'i').exec(value.trim());
  if (reversed) return parseDate(`${reversed[3]} ${reversed[1]}:${reversed[2]}`, now);
  const match = new RegExp(`^(?:в\\s+)?(${dayExpression}|${nextDayExpression})(?:\\s+(?:в\\s+)?(${dayPartPattern}))?(?:\\s+(?:в\\s+)?(\\d{1,2})(?:(?::|\\s)(\\d{2}))?)?$`, 'i').exec(value.trim());
  if (!match) return null;
  const token = match[1]!.toLowerCase();
  const date = new Date(now); date.setHours(0, 0, 0, 0);
  if (token in relativeDays) date.setDate(date.getDate() + relativeDays[token]!);
  else if (token in monthAliases) {
    const month = monthAliases[token]!;
    date.setFullYear(now.getFullYear() + (month < now.getMonth() ? 1 : 0), month, Math.min(now.getDate(), new Date(now.getFullYear() + (month < now.getMonth() ? 1 : 0), month + 1, 0).getDate()));
  }
  else if (token in weekdays) date.setDate(date.getDate() + (weekdays[token]! - date.getDay() + 7) % 7);
  else if (/^(?:след|следу(?:ю)?щ(?:ий|ую|ая|ем)|next)\s+/i.test(token)) {
    const weekday = token.split(/\s+/).at(-1)!;
    if (['месяц', 'месяце'].includes(weekday)) { const day = now.getDate(); date.setDate(1); date.setMonth(date.getMonth() + 1); date.setDate(Math.min(day, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate())); }
    else if (['год', 'году'].includes(weekday)) { const day = now.getDate(); date.setDate(1); date.setFullYear(date.getFullYear() + 1); date.setDate(Math.min(day, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate())); }
    else {
    if (!(weekday in weekdays)) return null;
    date.setDate(date.getDate() + 8 - (date.getDay() || 7) + (weekdays[weekday]! + 6) % 7);
    }
  }
  else {
    const parts = token.split(/\s+/);
    const dateToken = parts.length === 2 ? parts[1]! : token;
    if (parts.length === 2 && !(parts[0]! in weekdays)) return null;
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateToken);
    const dot = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/.exec(dateToken);
    if (!iso && !dot) return null;
    const month = Number(iso ? iso[2] : dot?.[2]); const day = Number(iso ? iso[3] : dot?.[1]);
    const year = iso ? Number(iso[1]) : dot?.[3] ? Number(dot[3]) : now.getFullYear() + (month < now.getMonth() + 1 ? 1 : 0);
    date.setFullYear(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    if (parts.length === 2 && date.getDay() !== weekdays[parts[0]!]) return null;
  }
  const sameTime = token in monthAliases || /(?:месяц|месяце|год|году)$/.test(token);
  const hours = Number(match[3] ?? dayPartHours[match[2]?.toLowerCase() ?? ''] ?? (sameTime ? now.getHours() : 9)), minutes = Number(match[4] ?? (match[3] ? 0 : sameTime ? now.getMinutes() : 0));
  if (hours > 23 || minutes > 59) return null;
  date.setHours(hours, minutes, 0, 0);
  if (date.getHours() !== hours || date.getMinutes() !== minutes) return null;
  return { iso: date.toISOString(), timed: true, explicitClock: Boolean(match[2] || match[3]) };
}

function nextClock(value: string, now: Date, anchor?: string | null): string | null {
  const match = /^(\d{1,2})(?::|\s)(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]), minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  const base = anchor ? new Date(anchor) : new Date(now);
  base.setHours(hour, minute, 0, 0);
  if (!anchor && base.getTime() <= now.getTime()) base.setDate(base.getDate() + 1);
  return base.getHours() === hour && base.getMinutes() === minute ? base.toISOString() : null;
}

/** Replace only the separator after a known command; offsets stay unchanged. */
function relaxedCommands(input: string): string {
  const masked = input.replace(/"([^"\n]*)"|«([^»\n]*)»/g, value => ' '.repeat(value.length));
  const chars = input.split('');
  // Same-length alias keeps native-input source coordinates intact.
  for (const alias of masked.matchAll(/(^|\s)н(?=\s|:)/gi)) {
    const at = alias.index! + alias[1]!.length;
    chars[at] = 'r';
    if (chars[at + 1] !== ':') chars[at + 1] = ':';
  }
  const labels = /(^|\s)(туда\s+и\s+обратно(?:\s+по)?|travel\s+back|remind\s+me|event\s+(?:opens|ends)|travel\s+time|ттб|ttb|тб|tb|обратно|дл|dr|начало|конец|срок|напомнить|нап|напомни|напоминание|напоминания|напомянание|reminder|remind|дорога|ехать|тт|travel|drive|длительность|due|start|end|opens|ends|duration|tt|r)(?=\s)/gi;
  for (const m of masked.matchAll(labels)) chars[m.index! + m[0].length] = ':';
  // “в срок” introduces a due command; the preposition must not become the
  // preceding command's value (e.g. “длительность 45м в срок ...”).
  return chars.join('').replace(/(^|\s)в(?=\s+(?:срок|due):)/gi, match => ' '.repeat(match.length));
}

/** Ignore punctuation used only to separate a value, title and next command. */
function normalizeSeparators(input: string): string {
  const masked = input.replace(/"([^"\n]*)"|«([^»\n]*)»/g, value => ' '.repeat(value.length));
  const chars = input.split('');
  const nextCommand = /^(?:event\s+(?:opens|ends)|travel\s+time|начало|конец|срок|напомнить|нап|напомни|напоминание|напоминания|напомянание|reminder|remind|дорога|ехать|тт|travel|drive|длительность|due|start|end|opens|ends|duration|tt|r)(?=\s|:|$)/i;
  for (let index = 0; index < masked.length; index++) {
    const separator = masked[index]!;
    if (!/[;,—]/.test(separator)) continue;
    const before = masked.slice(0, index).trimEnd();
    const after = masked.slice(index + 1).trimStart();
    const afterCommand = nextCommand.test(after);
    const afterValue = /(?:\d{1,2}:\d{2}|\d{1,2}\s\d{2}|\d+(?:[.,]\d+)?\s*(?:м|мин|ч|час|h|m|d|д)|сегодня|завтра|послезавтра)$/i.test(before);
    if (separator === ',' && !afterCommand && !/\s/.test(masked[index + 1] ?? '')) continue;
    if (separator === '—' && /^\s/.test(masked[index - 1] ?? '') && /^\s/.test(masked[index + 1] ?? '') && new RegExp(`^${dateValueExpression}(?=\\s|$)`, 'i').test(after)) continue;
    if (afterCommand || afterValue) chars[index] = ' ';
  }
  return chars.join('');
}

export function parseEntry(input: string, now: Date, defaults = true): Draft {
  input = relaxedCommands(normalizeSeparators(input));
  const result: Draft = { title: '', start: null, due: null, end: null, travelMinutes: null, durationMinutes: null, leave: null, reminders: [], errors: [], warnings: [] };
  if (input.length > 2000) { result.errors.push('Максимум 2000 символов.'); return result; }
  if (!Number.isFinite(now.getTime())) { result.errors.push('Некорректное опорное время.'); return result; }
  // Mask quoted spans with whitespace; keep original offsets for lossless title recovery.
  const consumed = new Uint8Array(input.length);
  let text = input.replace(/"([^"\n]*)"|«([^»\n]*)»|(?:^|\s)\.[#\p{L}][\p{L}\p{N}_-]*/gu, match => ' '.repeat(match.length));
  const quoteCheck = input.replace(/"([^"\n]*)"|«([^»\n]*)»/g, '');
  if (/["«»]/.test(quoteCheck)) result.errors.push('Закройте кавычки в названии.');
  function consume(start: number, length: number) { consumed.fill(1, start, start + length); text = text.slice(0, start) + ' '.repeat(length) + text.slice(start + length); }
  const seen = new Set<string>();
  let clockRange: RegExpExecArray | null = null;
  function once(key: string) { if (seen.has(key)) result.errors.push(`Параметр «${key}» указан несколько раз.`); seen.add(key); }
  const pending: Array<{ anchor: Anchor | 'auto'; minutes: number; preferDeparture?: boolean }> = [];
  const absoluteReminders: string[] = [];
  function reminders(value: string) {
    // Reminder commands are additive; unlike start/due they may repeat.
    const anchorPhrase = /\s+(?:до|before)\s+(выезда|начала|срока|departure|start|due)\s*$/i.exec(value);
    if (anchorPhrase) value = value.slice(0, anchorPhrase.index);
    const preferDeparture = /^за\s+/i.test(value);
    const separateOffsets = preferDeparture || Boolean(anchorPhrase);
    value = value.replace(/^за\s+/i, '').split(separateOffsets ? /\s+(?:и|and)\s+(?!a\s+half)|,|\s+(?=\d)/ : /\s+и\s+|\s+and\s+(?!a\s+half)|,/).map(part => {
      const amount = part.trim().replace(/^день$/i, '1д').replace(/^час$/i, '1ч');
      return anchorPhrase ? `${['выезда', 'departure'].includes(anchorPhrase[1]!.toLowerCase()) ? 'выезд' : ['начала', 'start'].includes(anchorPhrase[1]!.toLowerCase()) ? 'начало' : 'срок'}-${amount}` : amount;
    }).join(',');
    for (const part of value.toLowerCase().split(',').map(v => v.trim())) {
      const absolute = /^(?:в|at)\s+(.+)$/.exec(part);
      const absoluteValue = absolute?.[1] ?? part;
      const fixed = parseDate(absoluteValue, now)?.iso ?? nextClock(absoluteValue, now);
      if (fixed) { absoluteReminders.push(fixed); continue; }
      const m = /^(due|срок|start|начало|leave|выезд)([-+])(.+)$/.exec(part);
      const future = /^(?:через|in)\s*(.+)$/.exec(part);
      const amount = duration(m?.[3] ?? future?.[1] ?? part.replace(/^(?:за\s*|-)/, ''));
      if (amount === null) result.errors.push(`Не разобрано напоминание «${part}». Пример: начало-30м или через45м.`);
      else pending.push({ anchor: future ? 'now' : !m ? 'auto' : ['leave', 'выезд'].includes(m[1]!) ? 'leave' : ['due', 'срок'].includes(m[1]!) ? 'due' : 'start', minutes: future || m?.[2] === '+' ? amount : -amount, ...(preferDeparture ? { preferDeparture: true } : {}) });
    }
  }
  // A command may precede the title: "начало завтра 15:00 стрижка".
  // Keep the longest valid value and leave the remaining words as title text.
  function validReminderValue(value: string): boolean {
    const anchor = /\s+(?:до|before)\s+(выезда|начала|срока|departure|start|due)\s*$/i.exec(value);
    const body = (anchor ? value.slice(0, anchor.index) : value).replace(/^за\s+/i, '');
    return body.split(/\s+и\s+|\s+and\s+(?!a\s+half)|,/).every(part => {
      const token = part.trim().replace(/^день$/i, '1д').replace(/^час$/i, '1ч');
      const absolute = /^(?:в|at)\s+(.+)$/i.exec(token);
      const absoluteValue = absolute?.[1] ?? token;
      if (parseDate(absoluteValue, now) || nextClock(absoluteValue, now)) return true;
      const anchored = /^(?:due|срок|start|начало|leave|выезд)[-+](.+)$/i.exec(token);
      const future = /^(?:через|in)\s*(.+)$/i.exec(token);
      return duration(anchored?.[1] ?? future?.[1] ?? token.replace(/^(?:за\s*|-)/i, '')) !== null;
    });
  }
  function commandValuePrefix(value: string, key: string): string {
    const valid = (candidate: string) => ['@', 'срок', 'due', 'начало', 'start', 'opens', 'event opens', 'конец', 'end', 'ends', 'event ends'].includes(key)
      ? Boolean(parseDate(candidate, now) || nextClock(candidate, now))
      : ['дорога', 'ехать', 'тт', 'tt', 'travel', 'travel time', 'drive', 'длительность', 'duration', 'travel back', 'both travel'].includes(key)
        ? duration(candidate) !== null
        : ['напомнить', 'нап', 'напомни', 'напоминание', 'напоминания', 'напомянание', 'remind', 'reminder', 'r'].includes(key)
          ? validReminderValue(candidate) : false;
    if (valid(value)) return value;
    for (let end = value.length - 1; end > 0; end--) {
      if (!/\s/.test(value[end]!)) continue;
      const candidate = value.slice(0, end).trimEnd();
      // A numeric suffix belongs to an attempted time/duration; do not
      // silently turn an invalid "24:00" into part of the title.
      const suffix = value.slice(end).trimStart();
      const beginsNumericDate = /^(?:\d{1,2}\.\d{1,2}|\d{4}-\d{2}-\d{2})/.test(suffix);
      if (valid(candidate) && (!/^\d/.test(suffix) || beginsNumericDate)) return candidate;
    }
    return value;
  }
  // A small, documented natural-language grammar; no broad NLP guesses.
  const naturalReminder = /(?:^|\s)(?:напомнить|нап|напомни|напоминание|remind|reminder)\s+за\s+(.+?)\s+до\s+(выезда|начала)(?=\s|$)/i.exec(text);
  if (naturalReminder) {
    const amounts = naturalReminder[1]!.split(/\s+и\s+|,/).map(v => v.trim().replace(/^день$/, '1д').replace(/^час$/, '1ч'));
    reminders(amounts.map(v => `${naturalReminder[2]!.toLowerCase() === 'выезда' ? 'выезд' : 'начало'}-${v}`).join(','));
    consume(naturalReminder.index, naturalReminder[0].length);
  }
  const naturalTravel = /(?:^|\s)ехать\s+(\d+(?:[.,]\d+)?\s*(?:минут(?:ы|а)?|мин|час(?:а|ов)?|ч|м))(?=\s|$)/i.exec(text);
  if (naturalTravel) {
    once('дорога'); result.travelMinutes = duration(naturalTravel[1]!);
    if (result.travelMinutes === null) result.errors.push('Время дороги должно быть положительной длительностью.');
    consume(naturalTravel.index, naturalTravel[0].length);
  }
  // “до <date>” is a due deadline. Ordinary prose with “до” remains a title.
  const duePhrase = new RegExp(`(?:^|\\s)(?:до|by)\\s+(${dateValueExpression})(?=\\s|$)`, 'gi');
  for (const match of [...text.matchAll(duePhrase)]) {
    once('due');
    const parsed = parseDate(match[1]!, now);
    if (parsed) result.due = parsed.iso;
    else result.errors.push(`Не разобрана дата «${match[1]}».`);
    consume(match.index!, match[0].length);
  }
  // A due clock without a date means the next occurrence of that clock.
  // Keep it distinct from Event opens: “до 9 00” at 14:00 is tomorrow 09:00.
  const clockOnlyDue = /(?:^|\s)(?:до|by)\s+(\d{1,2})(?::|\s)(\d{2})(?=\s|$)/gi;
  for (const match of [...text.matchAll(clockOnlyDue)]) {
    if (/(?:^|\s)\d{1,2}(?::\d{2})?\s*$/.test(text.slice(0, match.index!))) continue;
    once('due');
    result.due = nextClock(`${match[1]}:${match[2]}`, now);
    if (!result.due) result.errors.push(`Некорректное время срока «${match[1]}:${match[2]}».`);
    consume(match.index!, match[0].length);
  }
  // A date followed by a compact clock range shares the same day on both sides:
  // “завтра 15 - 18 00” means 15:00–18:00, not a 09:00 default event.
  const compactClockRange = new RegExp(`(?:^|\\s)(?:(?:с|from)\\s+)?(${nextDayExpression}|${dayExpression})\\s+(\\d{1,2})(?:(?::|\\s)(\\d{2}))?\\s*(?:[-–—]|по|to)\\s*(\\d{1,2})(?:(?::|\\s)(\\d{2}))?(?=\\s|$)`, 'gi');
  for (const match of [...text.matchAll(compactClockRange)]) {
    if (consumed.slice(match.index!, match.index! + match[0].length).some(Boolean)) continue;
    once('start'); once('end');
    const day = match[1]!;
    const opens = parseDate(`${day} ${match[2]}:${match[3] ?? '00'}`, now);
    const ends = parseDate(`${day} ${match[4]}:${match[5] ?? '00'}`, now);
    if (!opens || !ends) result.errors.push(`Не разобран диапазон «${match[0].trim()}».`);
    else {
      const end = new Date(ends.iso);
      if (end.getTime() < Date.parse(opens.iso)) end.setDate(end.getDate() + 1);
      result.start = opens.iso; result.end = end.toISOString();
    }
    consume(match.index!, match[0].length);
  }
  // A paired “с … по …” sets event boundaries, independently of due.
  const ranges = [
    new RegExp(`(?:^|\\s)(?:с|from)\\s+(${dateValueExpression})\\s+(?:по|to)\\s+(${dateValueExpression})(?=\\s|$)`, 'gi'),
    new RegExp(`(?:^|\\s)(${dateValueExpression})\\s+[-–—]\\s+(${dateValueExpression})(?=\\s|$)`, 'gi'),
  ];
  for (const match of ranges.flatMap(range => [...text.matchAll(range)])) {
    if (consumed.slice(match.index!, match.index! + match[0].length).some(Boolean)) continue;
    once('start'); once('end');
    const opens = parseDate(match[1]!, now), ends = parseDate(match[2]!, now);
    if (!opens || !ends) result.errors.push(`Не разобран диапазон «${match[0].trim()}».`);
    else { result.start = opens.iso; result.end = ends.iso; }
    consume(match.index!, match[0].length);
  }
  const incompleteDash = [
    new RegExp(`(?:^|\\s)${dateValueExpression}\\s+[-–—](?=\\s|$)`, 'gi'),
    new RegExp(`(?:^|\\s)[-–—]\\s+${dateValueExpression}(?=\\s|$)`, 'gi'),
  ];
  for (const pattern of incompleteDash) for (const match of [...text.matchAll(pattern)]) {
    result.errors.push('Для диапазона через тире укажите дату и время с обеих сторон.');
    consume(match.index!, match[0].length);
  }
  const incompleteRange = new RegExp(`(?:^|\\s)(?:с|по|from|to)\\s+${dateValueExpression}(?=\\s|$)`, 'gi');
  for (const match of [...text.matchAll(incompleteRange)]) {
    result.errors.push('Для диапазона укажите обе границы: с <дата> по <дата>.');
    consume(match.index!, match[0].length);
  }
  // Explicit command boundaries prevent an unfinished value from swallowing the next command.
  const markers = [...text.matchAll(/(^|\s)(@[a-zа-яё0-9.]\S*|@|(?:туда\s+и\s+обратно(?:\s+по)?|remind\s+me|event\s+(?:opens|ends)|travel\s+(?:time|back)):|[a-zа-яё]+:)/gi)];
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i]!, start = m.index! + m[1]!.length;
    const end = i + 1 < markers.length ? markers[i + 1]!.index! : text.length;
    const segment = text.slice(start, end).trim();
    const isDate = segment.startsWith('@');
    const colon = segment.indexOf(':');
    const rawKey = isDate ? '@' : segment.slice(0, colon).toLowerCase().replace(/\s+/g, ' ');
    const key = ['дл', 'dr'].includes(rawKey) ? 'duration' : ['тб', 'tb', 'обратно'].includes(rawKey) ? 'travel back' : ['ттб', 'ttb', 'туда и обратно', 'туда и обратно по'].includes(rawKey) ? 'both travel' : rawKey === 'remind me' ? 'remind' : rawKey;
    const rawValue = isDate ? segment.slice(1) : segment.slice(colon + 1).trim();
    const value = commandValuePrefix(rawValue, key);
    const consumedLength = segment.length - rawValue.length + value.length;
    if (['срок', 'due'].includes(key)) {
      const preposition = /(?:^|\s)в\s+$/.exec(text.slice(0, start));
      if (preposition) consume(preposition.index, preposition[0].length);
    }
    if (['@', 'срок', 'due', 'начало', 'start', 'opens', 'event opens', 'конец', 'end', 'ends', 'event ends'].includes(key)) {
      const field = ['начало', 'start', 'opens', 'event opens'].includes(key) ? 'start' : ['конец', 'end', 'ends', 'event ends'].includes(key) ? 'end' : 'due';
      once(field);
      const parsed = parseDate(value, now);
      const clockValue = !parsed ? nextClock(value, now, result.start ?? parseEntry(text.slice(0, start), now).start) : null;
      if (clockValue) result[field] = clockValue;
      else if (!parsed) result.errors.push(`Не разобрана дата «${value}». Пример: завтра 15:00.`);
      else {
        if (parsed.timed || field === 'due') result[field] = parsed.iso;
        if (!parsed.timed && field !== 'due') result.errors.push('Для event opens / ends укажите дату и время.');
        if (!parsed.timed && field === 'due') result.due = `${new Date(parsed.iso).getFullYear()}-${String(new Date(parsed.iso).getMonth() + 1).padStart(2, '0')}-${String(new Date(parsed.iso).getDate()).padStart(2, '0')}`;
      }
    } else if (['дорога', 'ехать', 'тт', 'tt', 'travel', 'travel time', 'drive', 'длительность', 'duration', 'travel back', 'both travel'].includes(key)) {
      // An emptied optional duration is absent, not an invalid value.
      if (!value) { consume(start, end - start); continue; }
      const travel = ['дорога', 'ехать', 'тт', 'tt', 'travel', 'travel time', 'drive', 'both travel'].includes(key);
      const back = ['travel back', 'both travel'].includes(key);
      if (back) once('обратно');
      if (travel || !back) once(travel ? 'дорога' : 'длительность');
      const amount = duration(value);
      if (amount === null) result.errors.push(`Некорректная длительность «${value}». Пример: 45м или 1ч30м.`);
      else {
        if (back) result.travelBackMinutes = amount;
        if (travel || !back) result[travel ? 'travelMinutes' : 'durationMinutes'] = amount;
      }
    } else if (['напомнить', 'нап', 'напомни', 'напоминание', 'напоминания', 'напомянание', 'remind', 'reminder', 'r'].includes(key)) reminders(value);
    else result.errors.push(`Неизвестная команда «${key}:». Для буквального текста используйте кавычки.`);
    consume(start, consumedLength);
  }
  const timeBeforeDate = new RegExp(`(?:^|\\s)(\\d{1,2})(?::|\\s)(\\d{2})\\s+(${dayExpression})(?=\\s|$)`, 'gi');
  for (const m of [...text.matchAll(timeBeforeDate)]) {
    once('start'); const parsed = parseDate(`${m[1]}:${m[2]} ${m[3]}`, now);
    if (parsed) result.start = parsed.iso;
    else result.errors.push(`Некорректная дата «${m[0].trim()}».`);
    consume(m.index!, m[0].length);
  }
  for (const m of [...text.matchAll(/(?:^|\s)(?:сейчас|now)(?=\s|$)/gi)]) {
    once('due'); result.due = addMinutes(now.toISOString(), 10);
    consume(m.index!, m[0].length);
  }
  // Russian “в следующий чт” is one date phrase. Without this pass the
  // weekday is parsed but “в следующий” leaks into the item title.
  const nextWeekday = new RegExp(`(?:^|\\s)(?:в\\s+)?(?:след|следу(?:ю)?щ(?:ий|ую|ая|ем))\\s+(${weekdayPattern}|месяц|месяце|год|году)(?:\\s+(?:в\\s+)?(?:${dayPartPattern}))?(?:(?:\\s+в)?\\s+\\d{1,2}(?::|\\s)\\d{2})?(?=\\s|$)`, 'gi');
  for (const m of [...text.matchAll(nextWeekday)]) {
    once('start');
    const parsed = parseDate(m[0].trim(), now);
    if (!parsed) { result.errors.push(`Некорректная дата «${m[0].trim()}».`); consume(m.index!, m[0].length); continue; }
    result.start = parsed.iso; result.dateOnlyStart = !parsed.explicitClock;
    consume(m.index!, m[0].length);
  }
  // Consume the entire Russian calendar date, including its short year. Chrono
  // otherwise understands the year but can leave it behind in the title.
  const russianCalendarDate = new RegExp(`(?:^|\\s)(\\d{1,2})\\s+(${monthPattern})(?:\\s+(\\d{2}|\\d{4}))?(?:\\s+(?:в\\s+)?(\\d{1,2})(?:(?::|\\s)(\\d{2}))?)?(?=\\s|$)`, 'gi');
  for (const m of [...text.matchAll(russianCalendarDate)]) {
    if (consumed.slice(m.index!, m.index! + m[0].length).some(Boolean)) continue;
    const duePrefix = /(?:^|\s)до\s*$/i.exec(text.slice(0, m.index! + (m[0].startsWith(' ') ? 1 : 0)));
    const month = monthAliases[m[2]!.toLowerCase()]! + 1;
    const year = m[3] ? String(Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3])) : '';
    const clock = m[4] ? ` ${m[4]}:${m[5] ?? '00'}` : '';
    once(duePrefix ? 'due' : 'start');
    const parsed = parseDate(`${m[1]}.${month}${year ? `.${year}` : ''}${clock}`, now);
    if (parsed) { result[duePrefix ? 'due' : 'start'] = parsed.iso; if (!duePrefix) result.dateOnlyStart = !parsed.explicitClock; }
    else result.errors.push(`Некорректная дата «${m[0].trim()}».`);
    if (duePrefix) consume(duePrefix.index, m.index! - duePrefix.index);
    consume(m.index!, m[0].length);
  }
  const naturalDate = new RegExp(`(?:^|\\s)(${dateValueExpression})(?=\\s|$)`, 'gi');
  for (const m of [...text.matchAll(naturalDate)]) {
    if (consumed.slice(m.index!, m.index! + m[0].length).some(Boolean)) continue;
    const before = text.slice(0, m.index).trimEnd();
    const after = text.slice(m.index! + m[0].length).trimStart();
    if (m[1]!.toLowerCase() in monthAliases && (/\d{1,2}$/.test(before) || /^\d{2,4}(?=\s|$)/.test(after))) continue;
    once('start'); const parsed = parseDate(m[0].trim(), now);
    if (parsed) {
      result.start = parsed.iso; result.dateOnlyStart = !parsed.explicitClock;
    } else result.errors.push(`Некорректная дата «${m[0].trim()}».`);
    consume(m.index!, m[0].length);
  }
  clockRange = /(?:^|\s)(?:(?:с|from)\s+)?(\d{1,2})(?::(\d{2}))?\s*(?:[–—-]|до|to)\s*(\d{1,2})(?::(\d{2}))?(?=\s|$)/i.exec(text);
  if (clockRange) consume(clockRange.index, clockRange[0].length);
  const separateClock = /(?:^|\s)(?:в|at)\s+(\d{1,2})(?::(\d{2}))?(?=\s|$)/i.exec(text);
  if (separateClock || clockRange) {
    const match = clockRange ?? separateClock!;
    const hour = Number(match[1]), minute = Number(match[2] ?? 0);
    const base = result.start ? new Date(result.start) : new Date(now);
    if (hour > 23 || minute > 59) result.errors.push('Некорректное время начала.');
    else {
      base.setHours(hour, minute, 0, 0); result.start = base.toISOString(); result.dateOnlyStart = false;
      if (clockRange) {
        const endHour = Number(clockRange[3]), endMinute = Number(clockRange[4] ?? 0);
        if (endHour > 23 || endMinute > 59) result.errors.push('Некорректное время конца.');
        else { const end = new Date(base); end.setHours(endHour, endMinute, 0, 0); if (end < base) end.setDate(end.getDate() + 1); result.end = end.toISOString(); }
      }
    }
    if (separateClock) consume(separateClock.index, separateClock[0].length);
  }
  // Chrono is a maintained, MIT-licensed dependency. We call its public API;
  // no third-party source is copied into this project. It supplements the
  // explicit UTM grammar only when no date has already been understood.
  if (!result.start) for (const parser of [ru, en]) {
    const [match] = parser.parse(text, now, { forwardDate: true });
    if (!match) continue;
    const date = match.start.date();
    if (!match.start.isCertain('hour')) date.setHours(9, 0, 0, 0);
    const duePrefix = /(?:^|\s)до\s+$/i.exec(text.slice(0, match.index));
    if (duePrefix) {
      once('due'); result.due = date.toISOString();
      consume(duePrefix.index, match.index + match.text.length - duePrefix.index);
    } else {
      result.start = date.toISOString(); result.dateOnlyStart = !match.start.isCertain('hour');
      consume(match.index, match.text.length);
    }
    break;
  }
  if (/(?:^|\s)(?:напомнить|нап|ехать|завтра|сегодня|послезавтра)(?=\s|$)/i.test(text)) result.errors.push('Незавершённая фраза. Используйте команды или заключите буквальный текст в кавычки.');
  result.commandSpans = [...input.matchAll(/[a-zа-яё]+/gi)].filter(match => {
    const word = match[0].toLowerCase();
    return consumed.slice(match.index!, match.index! + word.length).every(Boolean)
      && (word in weekdays || word in relativeDays || word in dayPartHours || /^(event|opens|ends|travel|time|back|me|начало|конец|срок|напомнить|нап|напомни|напоминание|напоминания|напомянание|reminder|remind|дорога|ехать|тт|drive|длительность|due|до|start|end|duration|tt|r|дл|dr|тб|tb|ттб|ttb|обратно|туда|по|за|через|in|before)$/.test(word));
  }).map(match => ({ start: match.index!, end: match.index! + match[0].length }));
  // Older generated quick-entry strings may contain bare departure offsets.
  // Interpret them as reminders instead of silently merging them into Title.
  for (const match of [...text.matchAll(/(?:^|\s)((?:выезд|leave)-\d+(?:[a-zа-яё]+)(?:,(?:выезд|leave)-\d+(?:[a-zа-яё]+))*)(?=\s|$)/gi)]) {
    reminders(match[1]!);
    consume(match.index! + match[0].length - match[1]!.length, match[1]!.length);
  }
  result.title = input.split('').map((char, i) => consumed[i] ? ' ' : char).join('').replace(/"([^"\n]*)"|«([^»\n]*)»/g, (_, a, b) => a ?? b).replace(/\s+/g, ' ').trim();
  if (!result.title && /^(?:сейчас|now)\s*$/i.test(input.trim())) result.title = 'Сейчас';
  if (!result.title) result.errors.push('Добавьте название.');
  if (result.travelMinutes !== null && !result.start) result.errors.push('Для дороги нужно время начала.');
  if (result.start) {
    if (result.travelMinutes !== null) result.leave = addMinutes(result.start, -result.travelMinutes);
    if (defaults && result.durationMinutes === null && !result.end) result.durationMinutes = 60;
    if (result.durationMinutes !== null) {
      const computedEnd = addMinutes(result.start, result.durationMinutes);
      if (result.end && result.end !== computedEnd) result.errors.push('Event ends не совпадает с началом плюс длительность.');
      else result.end = computedEnd;
    }
    if (result.end && result.durationMinutes === null) result.durationMinutes = (new Date(result.end).getTime() - new Date(result.start).getTime()) / 60_000;
    if (new Date(result.start) < now) result.warnings.push('Начало уже в прошлом. Дата не перенесена автоматически.');
  }
  if (defaults && result.due && !result.start && result.durationMinutes === null) result.durationMinutes = 10;
  if (result.travelBackMinutes !== undefined && !result.end) result.errors.push('Для дороги обратно нужно время конца события.');
  if (result.start && result.end && result.end <= result.start) result.errors.push('Event ends должен быть позже event opens.');
  if (result.due && result.due.includes('T') && new Date(result.due) < now) result.warnings.push('Due уже в прошлом. Дата не перенесена автоматически.');
  for (const reminder of pending) {
    const anchor = reminder.anchor === 'auto' ? result.start ? reminder.preferDeparture && result.leave ? 'leave' : 'start' : result.due ? 'due' : 'now' : reminder.anchor;
    const base = anchor === 'now' ? now.toISOString() : anchor === 'leave' ? result.leave : anchor === 'due' ? result.due?.includes('T') ? result.due : null : result.start;
    const minutes = reminder.anchor === 'auto' && anchor === 'now' ? Math.abs(reminder.minutes) : reminder.minutes;
    const at = base ? addMinutes(base, minutes) : null;
    if (!at) result.errors.push(anchor === 'leave' ? 'Для напоминания до выезда нужны event opens и дорога.' : anchor === 'due' ? 'Для напоминания от due укажите дату и время due.' : 'Для напоминания до начала нужно время event opens.');
    if (at && new Date(at) < now) result.warnings.push('Есть напоминание в прошлом. Оно не будет перенесено автоматически.');
    const { preferDeparture: _preferDeparture, ...publicReminder } = reminder;
    result.reminders.push({ ...publicReminder, minutes, anchor, at, ...(reminder.anchor === 'auto' ? { automatic: true } : {}) });
  }
  for (const at of absoluteReminders) {
    if (new Date(at) < now) result.warnings.push('Есть напоминание в прошлом. Оно не будет перенесено автоматически.');
    result.reminders.push({ anchor: 'now', minutes: 0, at });
  }
  result.errors = [...new Set(result.errors)]; result.warnings = [...new Set(result.warnings)];
  return result;
}

export interface Suggestion { label: string; insert: string; detail: string; calendar?: boolean; replaceStart?: number; replaceEnd?: number }
const commandVariants: Record<string, string[]> = {
  напомнить: ['нап', 'напомни', 'напоминание', 'напоминания', 'напомянание'],
  дорога: ['ехать', 'тт', 'travel', 'drive'],
  начало: ['start', 'opens', 'event opens'],
  конец: ['end', 'ends', 'event ends'],
  срок: ['due'], длительность: ['duration'],
};
const commands: Suggestion[] = [
  { label: 'н', insert: 'н ', detail: 'Напоминание' },
  { label: 'r', insert: 'r ', detail: 'Reminder' },
  { label: 'remind me', insert: 'remind me ', detail: 'Reminder: in 30m, at 09:00' },
  { label: 'дл', insert: 'дл ', detail: 'Длительность' },
  { label: 'dr', insert: 'dr ', detail: 'Duration' },
  { label: 'тб', insert: 'тб ', detail: 'Дорога обратно' },
  { label: 'tb', insert: 'tb ', detail: 'Travel back' },
  { label: 'ттб', insert: 'ттб ', detail: 'Дорога туда и обратно: одинаковое время' },
  { label: 'ttb', insert: 'ttb ', detail: 'Same duration each way' },
  { label: 'бд / nd', insert: 'бд ', detail: 'Без автоматической даты и длительности' },
  { label: 'бн', insert: 'бн ', detail: 'Без автоматических напоминаний' },
  { label: 'area', insert: 'area:', detail: 'Выбрать Area' },
  { label: 'эриа', insert: 'area:', detail: 'Выбрать Area' },
  { label: 'project', insert: 'project:', detail: 'Выбрать проект, с Area или без неё' },
  { label: 'проект', insert: 'project:', detail: 'Выбрать проект, с Area или без неё' },
  { label: 'тег', insert: '#', detail: 'Выбрать тег' },
  { label: 'тэг', insert: '#', detail: 'Выбрать тег' },
  { label: 'сегодня', insert: 'сегодня ', detail: 'Начало сегодня' },
  { label: 'today', insert: 'today ', detail: 'Event opens today' },
  { label: 'завтра', insert: 'завтра ', detail: 'Начало завтра' },
  { label: 'tomorrow', insert: 'tomorrow ', detail: 'Event opens tomorrow' },
  { label: 'послезавтра', insert: 'послезавтра ', detail: 'Начало послезавтра' },
  { label: 'след', insert: 'след ', detail: 'Следующая календарная неделя: след пт' },
  { label: 'след месяц', insert: 'след месяц ', detail: 'Тот же день и время следующего месяца' },
  { label: 'след год', insert: 'след год ', detail: 'Тот же день и время следующего года' },
  { label: 'сейчас', insert: 'сейчас ', detail: 'Due через 10 минут' },
  { label: 'now', insert: 'now ', detail: 'Due in 10 minutes' },
  { label: 'до', insert: 'до ', detail: 'Due: срок без начала события' },
  { label: 'by', insert: 'by ', detail: 'Due date' },
  { label: 'с', insert: 'с ', detail: 'Event opens в диапазоне «с … по …»' },
  { label: 'from', insert: 'from ', detail: 'Event opens in a range' },
  { label: 'по', insert: 'по ', detail: 'Event ends в диапазоне «с … по …»' },
  { label: 'to', insert: 'to ', detail: 'Event ends in a range' },
  { label: 'event opens', insert: 'event opens ', detail: 'Дата и время начала события' },
  { label: 'event ends', insert: 'event ends ', detail: 'Дата и время окончания события' },
  { label: 'начало', insert: 'начало ', detail: 'Event opens — начало события' },
  { label: 'конец', insert: 'конец ', detail: 'Event ends — окончание события' },
  { label: 'дорога', insert: 'дорога ', detail: 'Например 45м или 1ч30м' },
  { label: 'ехать', insert: 'ехать ', detail: 'Время дороги' },
  { label: 'тт', insert: 'тт ', detail: 'Время дороги' },
  { label: 'travel', insert: 'travel ', detail: 'Travel time' },
  { label: 'drive', insert: 'drive ', detail: 'Travel time' },
  { label: 'длительность', insert: 'длительность ', detail: 'Продолжительность события' },
  { label: 'duration', insert: 'duration ', detail: 'Event duration' },
  { label: 'напомнить', insert: 'напомнить ', detail: 'До начала события или due' },
  { label: 'нап', insert: 'нап ', detail: 'Напомнить' },
  { label: 'напомни', insert: 'напомни ', detail: 'Напоминание' },
  { label: 'напоминание', insert: 'напоминание ', detail: 'Напоминание' },
  { label: 'remind', insert: 'remind ', detail: 'Reminder' },
  { label: 'reminder', insert: 'reminder ', detail: 'Reminder' },
  { label: 'срок', insert: 'срок ', detail: 'Дедлайн отдельно от начала' },
  { label: 'due', insert: 'due ', detail: 'Deadline without event boundaries' },
];
const dateKeys = /^(?:@|(?:срок|due|начало|start|opens|event opens|конец|end|ends|event ends):)$/i;
const russianWeekdays = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const englishWeekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
function dateSuggestions(input: string, caret: number, now: Date, language: 'ru' | 'en') {
  const masked = input.replace(/"([^"\n]*)"|«([^»\n]*)»/g, value => ' '.repeat(value.length));
  const markers = [...masked.matchAll(/(^|\s)(@|(?:event\s+(?:opens|ends)|travel\s+time):|[a-zа-яё]+:)/gi)];
  let index = -1; markers.forEach((m, i) => { if (m.index! + m[1]!.length <= caret) index = i; });
  if (index < 0) return null;
  const marker = markers[index]!, key = marker[2]!;
  if (!dateKeys.test(key)) return null;
  const start = marker.index! + marker[1]!.length;
  const boundary = index + 1 < markers.length ? markers[index + 1]!.index! : input.length;
  if (caret > boundary) return null;
  const raw = input.slice(start + key.length, boundary);
  const value = raw.trim();
  if (/^(?:срок|due):$/i.test(key)) {
    const clockOnly = /^(\d{1,2})(?:(?::|\s)(\d{0,2}))?$/.exec(value);
    if (clockOnly && Number(clockOnly[1]) <= 23) {
      const hour = clockOnly[1]!.padStart(2, '0');
      const minutes = clockOnly[2] ?? '';
      const choices = ['00', '15', '30', '45'].filter(part => !minutes || part.startsWith(minutes));
      const anchor = parseEntry(input.slice(0, start), now).start;
      return { start, end: boundary, timeOnly: true, options: choices.flatMap(part => {
        const at = nextClock(`${hour}:${part}`, now, anchor);
        return at ? [{ label: `${key.replace(':', ' ')}${hour}:${part}`, insert: `${key}${hour}:${part} `, detail: new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'long' }).format(new Date(at)) } as Suggestion] : [];
      }) };
    }
  }
  const match = /^(\S*)(?:\s+(?:в\s+)?(\d{0,2}(?::\d{0,2}|\s\d{1,2})?))?$/.exec(value);
  if (!match) return null;
  const day = match[1]!.toLowerCase(), clock = (match[2] ?? '').replace(' ', ':');
  const dayEnd = start + key.length + raw.indexOf(match[1]!) + day.length;
  const editingTime = caret > dayEnd && Boolean(day);
  const prefix = key;
  const end = boundary;
  const make = (date: string, time: string, detail: string): Suggestion => {
    const label = `${prefix}${date} ${time}`;
    return { label, insert: label + (input.slice(end).startsWith(' ') ? '' : ' '), detail };
  };
  const nearest = new Date(Math.ceil((now.getTime() + 1) / 900000) * 900000);
  const timeOf = (date: Date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const future = (date: string, time: string) => { const parsed = parseDate(`${date} ${time}`, now); return parsed && new Date(parsed.iso) > now; };
  const options: Suggestion[] = [];
  // A partially typed clock is completed in-place, preserving its date and later commands.
  if (editingTime && clock && !/^\d{1,2}:\d{2}$/.test(clock)) {
    const times: string[] = [];
    const minuteOrder = [0, 15, 30, 45, 5, 10, 20, 25, 35, 40, 50, 55];
    for (let hour = 0; hour < 24; hour++) for (const minute of minuteOrder) {
      const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      if ((time.startsWith(clock) || time.replace(/^0/, '').startsWith(clock)) && future(day, time)) times.push(time);
    }
    return { start, end, options: times.slice(0, 12).map(time => make(day, time, language === 'ru' ? 'Дозаполнить время' : 'Complete time')) };
  }
  const completeClock = /^\d{1,2}:\d{2}$/.test(clock) ? clock : null;
  if (!clock && caret >= dayEnd && parseDate(day, now)) {
    if (new RegExp(`^${numericDateExpression}$`).test(day)) {
      const dateLabel = new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(parseDate(day, now)!.iso));
      const hours = Array.from({ length: 24 }, (_, index) => (index + 6) % 24);
      const hourOptions: Suggestion[] = hours.map(hour => ({ label: `${String(hour).padStart(2, '0')}:00`, insert: ` ${String(hour).padStart(2, '0')}:00 `, detail: dateLabel }));
      return { start: dayEnd, end, options: hourOptions, timeOnly: true, ordered: true };
    }
    const dayparts = language === 'ru' ? ['утром', 'днём', 'вечером', 'ночью'] : ['morning', 'afternoon', 'evening', 'night'];
    const dateLabel = new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short' }).format(new Date(parseDate(day, now)!.iso));
    const partOptions: Suggestion[] = dayparts.map(part => {
      const parsed = parseDate(`${day} ${part}`, now)!;
      const clock = timeOf(new Date(parsed.iso));
      return { label: part, insert: ` ${part} `, detail: `${dateLabel} · ${clock}${Date.parse(parsed.iso) <= now.getTime() ? language === 'ru' ? ' · в прошлом' : ' · in the past' : ''}` };
    });
    const dueReminderOptions: Suggestion[] = prefix === '@' ? dayparts.filter(part => Date.parse(parseDate(`${day} ${part}`, now)!.iso) > now.getTime()).map(part => ({
      label: language === 'ru' ? `напомнить ${part}` : `remind ${part}`,
      insert: `${language === 'ru' ? 'срок' : 'due'}:${day} ${part} ${language === 'ru' ? 'напомнить' : 'remind'}:в ${day} ${part} `,
      detail: language === 'ru' ? `Due и напоминание · ${dateLabel} · ${timeOf(new Date(parseDate(`${day} ${part}`, now)!.iso))}` : `Due and reminder · ${dateLabel} · ${timeOf(new Date(parseDate(`${day} ${part}`, now)!.iso))}`,
      replaceStart: start,
      replaceEnd: end,
    })) : [];
    const times = [...new Set([timeOf(nearest), '09:00', '12:00', '15:00', '19:00', '23:00'])].filter(time => Boolean(parseDate(`${day} ${time}`, now)));
    const timeOptions: Suggestion[] = times.map(time => ({ label: time, insert: ` ${time} `, detail: dateLabel }));
    const reminderKey = language === 'ru' ? 'напомнить' : 'remind';
    const anchor = parseDate(day, now);
    const reminderOptions: Suggestion[] = [15, 30, 60].flatMap(minutes => {
      if (!anchor) return [];
      const reminderAt = new Date(Date.parse(anchor.iso) - minutes * 60_000);
      if (reminderAt <= now) return [];
      const clock = timeOf(reminderAt);
      const date = new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short' }).format(reminderAt);
      const dueAnchor = /^(?:@|(?:срок|due):)$/i.test(prefix);
      const relative = language === 'ru' ? `${minutes} мин до ${dueAnchor ? 'срока' : 'начала'} в 09:00` : `${minutes} min before the 09:00 ${dueAnchor ? 'due time' : 'start'}`;
      return [{ label: language === 'ru' ? `напомнить ${date} в ${clock}` : `remind ${date} at ${clock}`, insert: ` ${reminderKey}:${minutes}m `, detail: relative }];
    });
    return { start: dayEnd, end, options: [...partOptions, ...timeOptions, ...dueReminderOptions, ...reminderOptions], timeOnly: true };
  }
  const time = completeClock ?? timeOf(nearest);
  const recognised = day in relativeDays || day in weekdays || Boolean(parseDate(day, now));
  const relative = language === 'ru' ? ['завтра', 'сегодня'] : ['tomorrow', 'today'];
  const weekdayNames = language === 'ru' ? russianWeekdays : englishWeekdays;
  const preferred = recognised ? day : Object.keys(relativeDays).filter(d => language === 'ru' ? /[а-яё]/i.test(d) : /[a-z]/i.test(d)).find(d => d.startsWith(day)) ?? relative[0]!;
  const days = [...new Set([preferred, ...relative, ...Array.from({ length: 7 }, (_, i) => weekdayNames[(now.getDay() + i + 1) % 7]!)])];
  for (const candidate of days) {
    let optionDay = candidate;
    if (!future(candidate, time)) {
      if (!weekdayNames.includes(candidate)) continue;
      const followingWeek = new Date(parseDate(`${candidate} ${time}`, now)!.iso); followingWeek.setDate(followingWeek.getDate() + 7);
      optionDay = `${followingWeek.getFullYear()}-${String(followingWeek.getMonth() + 1).padStart(2, '0')}-${String(followingWeek.getDate()).padStart(2, '0')}`;
    }
    const parsed = parseDate(`${optionDay} ${time}`, now)!;
    const actualDate = new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'long' }).format(new Date(parsed.iso));
    options.push({ ...make(optionDay, time, `${actualDate} · ${weekdayNames.includes(candidate) ? language === 'ru' ? 'выбрать день недели' : 'choose weekday' : completeClock ? language === 'ru' ? 'сохранить время' : 'keep time' : language === 'ru' ? 'ближайшее время' : 'nearest time'}`), label: `${prefix}${candidate} ${time}` });
  }
  return { start, end, options };
}

function suggestInternal(input: string, caret: number, now: Date, language: 'ru' | 'en') {
  const before = input.slice(0, caret);
  if ((before.match(/"/g)?.length ?? 0) % 2 || before.lastIndexOf('«') > before.lastIndexOf('»')) return { start: caret, end: caret, options: [] as Suggestion[] };
  const dates = dateSuggestions(input, caret, now, language);
  if (dates) {
    const first = dates.options[0];
    if (first && !('timeOnly' in dates && dates.timeOnly)) dates.options.push({ label: 'Выбрать дату…', detail: 'Открыть календарь · сохранить время', calendar: true, insert: first.insert.replace(/^(@|(?:event\s+(?:opens|ends)|[a-zа-яё]+):)\S+/i, '$1__DATE__') });
    return dates;
  }
  const trailingCommand = /(?:event\s+(?:opens|ends)|[a-zа-яё]+):\s+$/i.exec(before);
  let token = trailingCommand ? trailingCommand[0].trimEnd() : /(?:event\s+(?:(?:opens|ends):\S*|\S*)|\S*)$/i.exec(before)![0]; let start = caret - (trailingCommand?.[0].length ?? token.length);
  let end = caret + /^\S*/.exec(input.slice(caret))![0].length;
  // Determine the active command by its range, not by the last whitespace token.
  const unquoted = input.replace(/"([^"\n]*)"|«([^»\n]*)»/g, value => ' '.repeat(value.length));
  const commandMarkers = [...unquoted.matchAll(/(^|\s)(@|(?:event\s+(?:opens|ends)|travel\s+time):|[a-zа-яё]+:)/gi)];
  let reminderTail = '';
  for (let i = 0; i < commandMarkers.length; i++) {
    const marker = commandMarkers[i]!, commandStart = marker.index! + marker[1]!.length;
    const commandEnd = i + 1 < commandMarkers.length ? commandMarkers[i + 1]!.index! : input.length;
    if (caret < commandStart || caret > commandEnd || !/^(напомнить|нап|напомни|напоминание|напоминания|напомянание|remind|reminder|r):$/i.test(marker[2]!)) continue;
    start = commandStart; end = commandEnd;
    token = input.slice(start, Math.max(caret, start + marker[2]!.length));
    const comma = input.slice(caret, end).indexOf(',');
    if (comma >= 0) reminderTail = input.slice(caret + comma, end).trimEnd();
    break;
  }
  const reminder = /^(напомнить|нап|напомни|напоминание|напоминания|напомянание|remind|reminder|r):([\s\S]*)$/i.exec(token);
  let options: Suggestion[];
  if (reminder) {
    const prefix = reminder[2]!.includes(',') ? reminder[2]!.slice(0, reminder[2]!.lastIndexOf(',') + 1) : '';
    const partial = reminder[2]!.slice(prefix.length).trim().toLowerCase();
    const context = input.replace(/"([^"\n]*)"|«([^»\n]*)»/g, '');
    const travel = /(?:^|\s)(?:дорога|ехать|тт|tt|travel|travel\s+time|drive):\s*(.*?)(?=\s+(?:@|event\s+(?:opens|ends):|[a-zа-яё]+:)|$)/i.exec(context);
    const naturalTravel = /(?:^|\s)ехать\s+(\d+\s*(?:минут(?:ы|а)?|мин|час(?:а|ов)?|ч|м))(?=\s|$)/i.exec(context);
    const hasTravel = duration(travel?.[1] ?? naturalTravel?.[1] ?? '') !== null;
    const mentionsDeparture = /(?:^|[\s:,])(?:выезд|leave)(?=[\s:-]|$)/i.test(context) || /^(?:вы|выезд|le|leave)/i.test(partial);
    const hasStart = parseEntry(input, now).start !== null;
    const relative = ['30м', '1ч', '1д', '15м', '2ч'];
    const explicit = partial.startsWith('начало') || partial.startsWith('start') ? ['начало-30м', 'start-30m'] : partial.startsWith('срок') || partial.startsWith('due') ? ['срок-30м', 'due-30m'] : [];
    const values = [...(hasTravel || mentionsDeparture ? ['выезд-2ч', 'выезд-1д'] : []), ...relative, ...explicit, 'через45м'];
    const completeDuration = duration(partial);
    const matching = values.filter(v => v.startsWith(partial.replace(/\s/g, '')));
    const candidates = completeDuration !== null ? [...values].sort((a, b) => Number(duration(b) === completeDuration) - Number(duration(a) === completeDuration)) : matching.length ? matching : values;
    options = candidates.map(v => ({ label: v, insert: `${reminder[1]}:${prefix}${v}${reminderTail} `, detail: v.startsWith('выезд') ? 'От времени выезда' : v.startsWith('начало') || v.startsWith('start') ? 'От event opens' : v.startsWith('срок') || v.startsWith('due') ? 'От due' : v.startsWith('через') ? 'От момента создания карточки' : hasStart ? 'До event opens · автоматически' : 'До due · автоматически' }));
  } else if (/^(ттб|ttb):/i.test(token)) {
    const [key, partial = ''] = token.split(':');
    options = ['30м', '45м', '1ч'].filter(value => value.startsWith(partial)).map(value => ({ label: value, insert: `${key}:${value} `, detail: language === 'ru' ? 'Одинаковое время туда и обратно' : 'Same duration both ways' }));
  } else if (/^(дорога|ехать|тт|tt|travel|travel time|drive|длительность|duration):/i.test(token)) {
    const [key, partial = ''] = token.split(':'); options = ['15м', '30м', '45м', '1ч', '1ч30м'].filter(v => v.startsWith(partial)).map(v => ({ label: v, insert: `${key}:${v} `, detail: 'Длительность' }));
  } else if (/^(срок|due|начало|start|opens|event opens|конец|end|ends|event ends):/i.test(token)) {
    const [key, partial = ''] = token.split(':'); options = ['сегодня', 'завтра', 'пятница'].filter(v => v.startsWith(partial)).map(v => ({ label: v, insert: `${key}:${v} `, detail: ['срок', 'due'].includes(key!) ? 'Дата due; можно дописать время' : 'Допишите время события после даты' }));
  } else {
    const aliases: Record<string, string> = { tt: 'дорога:', r: 'напомнить:', duration: 'длительность:', due: 'срок:', '@tom': '@завтра' };
    const query = aliases[token.toLowerCase()] ?? token.toLowerCase();
    const commandOptions = commands.filter(c => !Object.values(commandVariants).some(variants => variants.includes(c.label)) && (language === 'ru' ? /[а-яё]/i.test(c.label) : /^[a-z]/i.test(c.label)));
    options = commandOptions.filter(c => (query || !['след месяц', 'след год'].includes(c.label)) && (c.label.startsWith(query) || commandVariants[c.label]?.some(alias => alias.startsWith(query))));
    if (/^[а-яё]{2,}$/i.test(query)) {
      options.push(...monthForms.map((name, index) => ({ label: name, insert: `${name} `, detail: `Дата: ${index + 1}-й месяц, тот же день и время` })).filter(option => option.label.startsWith(query) || months[monthForms.indexOf(option.label)]?.startsWith(query)));
    }
  }
  if (/^(?:@|(?:срок|due|начало|start|opens|event opens|конец|end|ends|event ends):)/i.test(token)) {
    // Complete the date token and retain the time already entered to its right.
    {
      const existingTime = /^(\s+(?:в\s+)?\d{1,2}(?::|\s)\d{2})(?=\s|$)/.exec(input.slice(end));
      if (existingTime) {
        const timeText = existingTime[1]!.trim();
        end += existingTime[0].length;
        options = options.map(option => {
          const day = option.insert.trim().replace(/\s+\d{1,2}:\d{2}$/, '');
          return { label: `${day} ${timeText}`, insert: `${day} ${timeText}`, detail: 'Сохранить введённое время' };
        });
      }
    }
  }
  return { start, end, options };
}

/** Clock completion edits only the active clock, never its date or later commands. */
function stagedClockSuggestions(input: string, caret: number, now: Date, language: 'ru' | 'en') {
  const masked = input.replace(/"([^"\n]*)"|«([^»\n]*)»/g, value => ' '.repeat(value.length));
  const before = masked.slice(0, caret);
  if ((input.slice(0, caret).match(/"/g)?.length ?? 0) % 2 || input.slice(0, caret).lastIndexOf('«') > input.slice(0, caret).lastIndexOf('»')) return null;
  const namedDate = `\\d{1,2}\\s+(?:${monthPattern})(?:\\s+(?:\\d{4}|\\d{2})(?![\\d:]))?`;
  const date = new RegExp(`(?:^|[\\s:@])(${namedDate}|${nextDayExpression}|${dayExpression})(?:\\s+(?:в\\s+)?(\\d{1,2})(?:(:|\\s)(\\d{0,2}))?)?\\s*$`, 'i').exec(before);
  const command = /(?:^|\s)(?:event\s+(?:opens|ends)|начало|конец|срок|due|start|end|opens|ends|до|by|с|from|по|to|напомнить|нап|напомни|напоминание|напоминания|remind|reminder|r)(?::|\s)\s*(?:(?:в|at)\s+)?(\d{1,2})?(?:(:|\s)(\d{0,2}))?\s*$/i.exec(before);
  const range = /(?:\d{1,2}(?:(?::|\s)\d{2})?)\s*[-–—]\s*(\d{1,2})?(?:(:|\s)(\d{0,2}))?\s*$/.exec(before);
  const rangePrefix = range ? before.replace(/[-–—]\s*\d{0,2}(?:(?::|\s)\d{0,2})?\s*$/, '') : command && /(?:по|to|конец|end|ends)\s*$/i.test(command[0]) ? before.slice(0, command.index) : '';
  const startMarker = /(?:^|\s)(?:с|from)\s+/i.exec(rangePrefix);
  const rangeStart = rangePrefix ? (startMarker ? parseDate(rangePrefix.slice(startMarker.index + startMarker[0].length).trim(), now)?.iso : parseEntry(rangePrefix, now).start) : undefined;
  let hour: string | undefined, minute: string | undefined, separator: string | undefined, start: number, detail: string;
  if (date) {
    const phrase = date[1]!;
    const dateStart = date.index + date[0].indexOf(phrase);
    if (/\d{1,2}(?::|\s)\d{2}\s+$/.test(before.slice(0, dateStart))) return null;
    const resolved = parseDate(phrase, now)?.iso ?? parseEntry(`Timeline ${phrase}`, now).start;
    if (!resolved) return null;
    hour = date[2]; separator = date[3]; minute = date[4];
    if (!hour && /^\s+(?:в\s+)?\d{1,2}(?::|\s)\d{2}/.test(input.slice(caret))) return null;
    const dateEnd = date.index + date[0].indexOf(phrase) + phrase.length;
    start = hour ? dateEnd + before.slice(dateEnd).indexOf(hour) : caret;
    detail = new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(resolved));
  } else if (command || range) {
    const match = command ?? range!;
    hour = match[1]; separator = match[2]; minute = match[3];
    // Empty reminder commands still offer relative offsets. Explicit clock input
    // and absolute reminder dates use the same two-stage clock picker.
    if (!hour && command && !rangeStart) return null;
    if (command && /(?:напом|remind|\br\b)/i.test(command[0]) && ((!separator && hour?.length === 1) || /^\s*(?:день|дня|дней|час|мин|[mhdмчд])\b/i.test(input.slice(caret)))) return null;
    start = hour ? caret - /\d{1,2}(?:(?::|\s)\d{0,2})?\s*$/.exec(before)![0].length : caret;
    detail = language === 'ru' ? 'Время' : 'Time';
  } else return null;
  if (hour && (Number(hour) > 23 || (separator && minute?.length === 2))) return null;
  const end = caret + /^\d*(?::\d*)?/.exec(input.slice(caret))![0].length;
  if (hour) {
    const clock = hour.padStart(2, '0');
    const minutes = ['00', '15', '30', '45'].filter(value => !minute || value.startsWith(minute));
    return { start, end, ordered: true, options: minutes.map(value => ({ label: `:${value}`, insert: `${clock}:${value}${/^\s/.test(input.slice(end)) ? '' : ' '}`, detail: `${clock}:${value} · ${detail}` })) };
  }
  const leading = /\s$/.test(input.slice(0, caret)) ? '' : ' ';
  return { start, end, ordered: true, options: Array.from({ length: 24 }, (_, index) => {
    const firstHour = rangeStart ? new Date(rangeStart).getHours() + 1 : 6;
    const clock = String((index + firstHour) % 24).padStart(2, '0');
    const nextDay = rangeStart && index + firstHour >= 24;
    return { label: `${nextDay ? language === 'ru' ? 'следующий день ' : 'next day ' : ''}${clock}:`, insert: `${leading}${clock}:`, detail: nextDay ? language === 'ru' ? 'На следующий день после начала' : 'Day after the range start' : detail };
  }) };
}

/** Live capture supports a calendar day without inventing a start time. */
export function bareDurationInsertion(input: string): number {
  const inline = /\s+((?:\d+(?:[.,]\d+)?\s*(?:часов|часа?|hours?|ч|h|минуты?|мин|minutes?|min|м|m)\s*)+)(?=\s+(?:н|r|нап|напомнить|напомни|remind|reminder)(?::|\s)|$)/gi;
  for (const match of input.matchAll(inline)) {
    if (!/(?:длительность|duration|дл|dr|напомнить|нап|напомни|н|r|reminder|remind(?:\s+me)?|за|через|in|дорога|ехать|тт|drive|обратно(?:\s+по)?|travel(?:\s+(?:back|time))?|ттб|ttb|тб|tb|tt)\s*$/i.test(input.slice(0, match.index))) return match.index! + 1;
  }
  const trailing = /\s+((?:\d+(?:[.,]\d+)?\s*(?:часов|часа?|hours?|ч|h|минуты?|мин|minutes?|min|м|m)\s*)+)$/i.exec(input);
  if (!trailing || /(?:длительность|duration|дл|dr|напомнить|нап|напомни|н|r|reminder|remind(?:\s+me)?|за|через|in|дорога|ехать|тт|drive|обратно(?:\s+по)?|travel(?:\s+(?:back|time))?|ттб|ttb|тб|tb|tt)\s*$/i.test(input.slice(0, trailing.index))) return -1;
  return trailing.index + 1;
}

export function parseLiveEntry(input: string, now: Date): Draft {
  const organization = extractOrganization(input);
  const fields = { areas: organization.areas, projects: organization.projects, tags: organization.tags };
  if (/^\.(?:\s|$)/.test(organization.text)) return { ...fields, commandSpans: organization.commandSpans, isNote: true, title: organization.text.slice(1).trim(), start: null, end: null, due: null, leave: null, durationMinutes: null, travelMinutes: null, reminders: [], errors: [], warnings: [] };
  input = organization.maskedText;
  const flagSpans: Array<{ start: number; end: number }> = [];
  let noDateDefaults = false, noDefaultReminders = false;
  input = input.replace(/"[^"\n]*"|«[^»\n]*»|(^|\s)(бд|nd|бн)(?=\s|$)/gi, (match, leading: string | undefined, flag: string | undefined, offset: number) => {
    if (!flag) return match;
    if (flag.toLowerCase() === 'бн') noDefaultReminders = true; else noDateDefaults = true;
    const start = offset + (leading?.length ?? 0); flagSpans.push({ start, end: start + flag.length });
    return ' '.repeat(match.length);
  });
  const insertAt = bareDurationInsertion(input);
  const insertion = 'длительность ';
  const normalized = insertAt >= 0 ? input.slice(0, insertAt) + insertion + input.slice(insertAt) : input;
  const withoutDatePreposition = normalized.replace(new RegExp(`"[^"\\n]*"|«[^»\\n]*»|(^|\\s)(?:(?:в|во|на|on)\\s+(?:эту\\s+|этот\\s+|this\\s+)?)?(?:эту\\s+|this\\s+)?(?=${dateValueExpression}(?=\\s|$))|(^|\\s)на\\s+(?=длительность\\s)`, 'gi'), (match, leading: string | undefined, durationLeading: string | undefined) => leading === undefined && durationLeading === undefined ? match : ' '.repeat(match.length));
  const result = { ...parseEntry(withoutDatePreposition, now, !noDateDefaults), ...fields, noDateDefaults, noDefaultReminders };
  const spans = (result.commandSpans ?? []).filter(span => insertAt < 0 || span.end <= insertAt || span.start >= insertAt + insertion.length).map(span => insertAt >= 0 && span.start >= insertAt + insertion.length ? { start: span.start - insertion.length, end: span.end - insertion.length } : span);
  result.commandSpans = [...organization.commandSpans, ...flagSpans, ...(result.errors.length ? [] : spans)].sort((a, b) => a.start - b.start);
  if (!result.dateOnlyStart || !result.start) return result;
  const day = new Date(result.start);
  result.plannedDate = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  result.start = null; result.end = null; result.leave = null;
  if (!/(?:длительность|duration)(?::|\s)/i.test(normalized)) result.durationMinutes = null;
  result.warnings = result.warnings.filter(value => !value.startsWith('Начало уже'));
  if (result.travelMinutes !== null) result.errors.push('Для дороги нужно время начала.');
  if (result.reminders.some(value => value.anchor === 'start' || value.anchor === 'leave')) result.errors.push('Для напоминания до начала нужно указать время.');
  return result;
}

export function suggest(input: string, caret: number, now: Date = new Date(), interfaceLanguage: 'ru' | 'en' = 'ru'): { start: number; end: number; options: Suggestion[]; ordered?: boolean } {
  if (/^\.(?:\s|$)/.test(input.trimStart()) || /(?:^|\s)\.[^\s]*$/.test(input.slice(0, caret))) return { start: caret, end: caret, options: [] };
  const beforeCaret = input.slice(0, caret);
  const activeWord = /[a-zа-яё]+$/i.exec(beforeCaret)?.[0] ?? '';
  const closestWord = activeWord || [...beforeCaret.matchAll(/[a-zа-яё]+/gi)].at(-1)?.[0] || '';
  const language: 'ru' | 'en' = /[а-яё]/i.test(closestWord) ? 'ru' : /[a-z]/i.test(closestWord) ? 'en' : interfaceLanguage;
  const reminderPrompt = /(?:^|\s)(н|r|нап|напомнить|напомни|remind(?:\s+me)?|reminder)(?:\s+(через|in))?\s*$/i.exec(beforeCaret);
  const priorReminderAnchor = reminderPrompt ? parseEntry(input.slice(0, reminderPrompt.index), now) : undefined;
  const priorText = reminderPrompt ? input.slice(0, reminderPrompt.index) : '';
  const hasExplicitDate = new RegExp(dateValueExpression, 'i').test(priorText) || /(?:^|\s)\d{1,2}(?::|\s)\d{2}(?=\s|$)/.test(priorText);
  if (caret === input.length && reminderPrompt && (reminderPrompt[1]!.length === 1 || /\s$/.test(beforeCaret) || Boolean(reminderPrompt[2])) && (!hasExplicitDate || (!priorReminderAnchor?.start && !priorReminderAnchor?.due && !priorReminderAnchor?.end))) {
    const key = reminderPrompt[1]!;
    const relativeWord = language === 'ru' ? 'через' : 'in';
    const atWord = language === 'ru' ? 'в' : 'at';
    const amounts = language === 'ru' ? ['5м', '10м', '15м', '30м', '45м', '1ч', '2ч', '3ч', '1д', '2д', '1нед'] : ['5m', '10m', '15m', '30m', '45m', '1h', '2h', '3h', '1d', '2d', '1w'];
    const afterRelative = Boolean(reminderPrompt[2]);
    const start = reminderPrompt.index! + reminderPrompt[0].lastIndexOf(afterRelative ? reminderPrompt[2]! : key);
    const options: Suggestion[] = amounts.map(amount => ({ label: `${relativeWord} ${amount}`, insert: `${afterRelative ? '' : `${key} `}${relativeWord}${amount} `, detail: language === 'ru' ? 'От текущего времени' : 'From now' }));
    if (!afterRelative) for (const hour of [12, 15, 18]) {
      const at = new Date(now); at.setHours(hour, 0, 0, 0);
      if (at.getTime() > now.getTime()) options.push({ label: `${atWord} ${String(hour).padStart(2, '0')}:00`, insert: `${key} ${atWord} ${String(hour).padStart(2, '0')}:00 `, detail: language === 'ru' ? 'Сегодня' : 'Today' });
    }
    return { start, end: caret, ordered: true, options };
  }
  const clock = stagedClockSuggestions(input, caret, now, language);
  if (clock) return clock;
  const nextCommand = /(?:^|\s)(до|due|срок|начало|start|opens|конец|end|ends|напомнить|нап|напомни|remind|reminder)(?::|\s|$)\s*$/i.exec(beforeCaret);
  if (nextCommand) {
    const previous = parseEntry(input.slice(0, nextCommand.index), now);
    const anchor = previous.start ?? previous.due ?? previous.end;
    if (anchor) {
      const at = new Date(anchor);
      const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
      const date = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
      const key = nextCommand[1]!;
      const prefix = /напом|remind/i.test(key) ? `${key}${nextCommand[0].includes(':') ? ':' : ''} в` : key;
      const days = [date, ...(language === 'ru' ? ['сегодня', 'завтра', ...russianWeekdays] : ['today', 'tomorrow', ...englishWeekdays])];
      return { start: nextCommand.index + nextCommand[0].indexOf(key), end: caret, ordered: true, options: days.map((day, index) => ({ label: `${key} ${day} ${time}`, insert: `${prefix} ${day} ${time} `, detail: index === 0 ? language === 'ru' ? 'Указанные дата и время' : 'Entered date and time' : language === 'ru' ? 'Сохранить указанное время' : 'Keep entered time' })) };
    }
    if (/^(?:до|due|срок)$/i.test(nextCommand[1]!)) {
      const key = nextCommand[1]!;
      const today = language === 'ru' ? 'сегодня' : 'today';
      const days = language === 'ru' ? ['завтра', 'послезавтра', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'] : ['tomorrow', ...englishWeekdays];
      const clocks = [12, 15, 18].flatMap(hour => {
        const at = new Date(now); at.setHours(hour, 0, 0, 0);
        if (at.getTime() <= now.getTime()) return [];
        const time = `${String(hour).padStart(2, '0')}:00`;
        return [{ label: `${key} ${today} ${time}`, insert: `${key} ${today} ${time} `, detail: language === 'ru' ? 'Сегодня · ближайшее время' : 'Today · upcoming time' }];
      });
      return { start: nextCommand.index + nextCommand[0].indexOf(key), end: caret, ordered: true, options: [...clocks, ...days.map(day => ({ label: `${key} ${day} 09:00`, insert: `${key} ${day} 09:00 `, detail: language === 'ru' ? 'Другой день' : 'Another day' }))] };
    }
  }
  const normalized = relaxedCommands(input);
  if (caret === input.length) {
    const masked = input.replace(/"([^"\n]*)"|«([^»\n]*)»/g, value => ' '.repeat(value.length));
    const markers = [...masked.matchAll(/(?:^|\s)(с|по|до)\s+/gi)];
    const marker = markers.at(-1);
    if (marker) {
      const key = marker[1]!.toLowerCase();
      const start = marker.index! + marker[0].lastIndexOf(key);
      const raw = input.slice(marker.index! + marker[0].length).trim();
      const validPrefix = !raw || [...Object.keys(relativeDays), ...Object.keys(weekdays)].some(day => day.startsWith(raw.toLowerCase())) || parseDate(raw, now);
      if (validPrefix) {
        if (key === 'с' && parseDate(raw, now)) return { start: caret, end: caret, options: [{ label: 'по', insert: ' по ', detail: 'Укажите event ends' }] };
        const beforeRangeEnd = input.slice(0, start);
        const startMarker = [...beforeRangeEnd.matchAll(/(?:^|\s)с\s+/gi)].at(-1);
        const rangeStart = startMarker ? parseDate(beforeRangeEnd.slice(startMarker.index! + startMarker[0].length).trim(), now) : null;
        const preferred = rangeStart ? new Date(new Date(rangeStart.iso).getTime() + 3600_000) : null;
        const preferredDay = preferred ? `${preferred.getFullYear()}-${String(preferred.getMonth() + 1).padStart(2, '0')}-${String(preferred.getDate()).padStart(2, '0')}` : null;
        const candidates = [...new Set([...(preferredDay ? [preferredDay] : []), 'сегодня', 'завтра', 'послезавтра', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'])];
        const options = candidates.filter(day => !raw || day.startsWith(raw.toLowerCase())).map(day => {
          const time = preferred && day === candidates[0] ? `${String(preferred.getHours()).padStart(2, '0')}:${String(preferred.getMinutes()).padStart(2, '0')}` : '09:00';
          const date = parseDate(`${day} ${time}`, now)!;
          return { label: `${key} ${day} ${time}`, insert: `${key} ${day} ${time} `, detail: new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(date.iso)) };
        });
        if (options.length) return { start, end: caret, options };
      }
    }
  }
  if (caret === input.length && /(?:^|\s)след\s+$/i.test(input)) {
    const start = input.toLowerCase().lastIndexOf('след');
    const names = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
    const monday = new Date(now); monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() + (8 - (monday.getDay() || 7)));
    return { start, end: input.length, options: names.map((name, index) => {
      const day = new Date(monday); day.setDate(day.getDate() + index);
      return { label: `след ${name}`, insert: `след ${name} `, detail: new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(day) };
    }) };
  }
  if (caret === input.length) {
    const nextPeriod = /(?:^|\s)(след\s+(?:м\S*|г\S*))$/i.exec(input);
    if (nextPeriod) {
      const query = nextPeriod[1]!.toLowerCase();
      return { start: input.length - nextPeriod[1]!.length, end: caret, options: commands.filter(command => ['след месяц', 'след год'].includes(command.label) && command.label.startsWith(query)) };
    }
  }
  // Once the date has an explicit time or daypart, do not offer another date.
  // The next useful choices are independent commands, inserted after the text.
  if (caret === input.length) {
    const terminalDate = new RegExp(`(?:^|\\s)(${dateValueExpression})\\s*$`, 'i').exec(normalized);
    const phrase = terminalDate?.[1] ?? '';
    if (phrase && !/(?:^|\s)(?:след\S*|next)(?=\s|$)/i.test(phrase) && new RegExp(`\\s+(?:${dayPartPattern}|\\d{1,2}(?:(?::|\\s)\\d{2})?)$`, 'i').test(phrase) && parseDate(phrase, now)) {
      const labels = language === 'ru' ? ['напомнить', 'длительность', 'дорога', 'ттб', 'конец', 'срок'] : ['remind', 'duration', 'travel', 'ttb', 'event ends', 'due'];
      const used = [
        /(?:^|\s)(?:напомнить|нап|напомни|напоминание|remind|reminder|r)(?=\s|:)/i,
        /(?:^|\s)(?:длительность|duration)(?=\s|:)/i,
        /(?:^|\s)(?:дорога|ехать|тт|travel|drive|ттб|ttb)(?=\s|:)/i,
        /(?:^|\s)(?:дорога|ехать|тт|travel|drive|ттб|ttb)(?=\s|:)/i,
        /(?:^|\s)(?:конец|end|ends|event ends)(?=\s|:)/i,
        /(?:^|\s)(?:срок|due|до|by)(?=\s|:)/i,
      ];
      const leadingSpace = /\s$/.test(input) ? '' : ' ';
      return { start: caret, end: caret, options: labels.flatMap((label, index) => {
        if (used[index]!.test(input)) return [];
        const command = commands.find(option => option.label === label)!;
        return [{ ...command, insert: `${leadingSpace}${command.insert}` }];
      }) };
    }
  }
  // Russian users often say time first: “15 00 пятница”. Keep that order in
  // completion instead of treating Friday as a date with a missing time.
  const maskedOriginal = normalized.replace(/"([^"\n]*)"|«([^»\n]*)»/g, value => ' '.repeat(value.length));
  const reversedDate = new RegExp(`(?:^|\\s)(\\d{1,2})(?::|\\s)(\\d{2})\\s+(${dayExpression})(?=\\s|$)`, 'gi');
  for (const match of maskedOriginal.matchAll(reversedDate)) {
    const leading = match[0].startsWith(' ') ? 1 : 0;
    const rangeStart = match.index! + leading;
    const rangeEnd = match.index! + match[0].length;
    if (caret < rangeStart || caret > rangeEnd) continue;
    const time = `${match[1]!.padStart(2, '0')}:${match[2]}`;
    const temporary = normalized.slice(0, rangeStart) + `@${match[3]} ${time}` + normalized.slice(rangeEnd);
    const suggested = suggestInternal(temporary, rangeStart + 1 + match[3]!.length + 1 + time.length, now, language);
    return {
      start: rangeStart,
      end: rangeEnd,
      options: suggested.options.map(option => {
        const resolvedDay = option.label.replace(/^@/, '').replace(/\s+\d{1,2}:\d{2}$/, '');
        return { ...option, label: `${time} ${resolvedDay}`, insert: `${time} ${resolvedDay} ` };
      }),
    };
  }
  let result = suggestInternal(normalized, caret, now, language);
  // Unlabelled dates get the same completion engine, with @ only used internally.
  {
    const masked = normalized.replace(/"([^"\n]*)"|«([^»\n]*)»/g, value => ' '.repeat(value.length));
    const pattern = new RegExp(`(?:^|\\s)(${dayExpression})(?:\\s+(?:в\\s+)?\\d{0,2}(?::\\d{0,2}|\\s\\d{1,2})?)?(?=\\s|$)`, 'gi');
    for (const match of masked.matchAll(pattern)) {
      const start = match.index! + match[0].indexOf(match[1]!);
      const matchedEnd = match.index! + match[0].length;
      // A space after a bare hour still belongs to time completion:
      // "сегодня 14 |" should offer 14:00, 14:15, ... at the caret.
      const end = caret > matchedEnd && /^\s*$/.test(masked.slice(matchedEnd, caret)) ? caret : matchedEnd;
      const preceding = masked.slice(0, start);
      if (caret < start || caret > end || /(?:@|[a-zа-яё]+:)\s*$/i.test(preceding)) continue;
      // Do not reinterpret reminder values as date context.
      if (/(?:напомнить|нап|напоминание|напоминания|r):[^@]*$/i.test(preceding)) continue;
      const temporary = normalized.slice(0, start) + '@' + normalized.slice(start);
      result = suggestInternal(temporary, caret + 1, now, language);
      if (/(?:^|\s)(?:в\s+)?(?:след|следу(?:ю)?щ(?:ий|ую|ая|ем))\s*$/i.test(preceding)) {
        const due = parseEntry(normalized, now).start;
        const clock = /\b(\d{1,2}:\d{2})\b/.exec(result.options[0]?.label ?? '')?.[1];
        if (due && clock) {
          const date = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(due));
          return { start, end, options: [{ label: `${match[1]} ${clock}`, insert: `${match[1]} ${clock} `, detail: `${date} · следующая неделя` }] };
        }
      }
      return { ...result, start: result.start > start ? result.start - 1 : result.start, end: result.end - 1, options: result.options.map(option => ({ ...option, ...(option.replaceStart === undefined ? {} : { replaceStart: option.replaceStart > start ? option.replaceStart - 1 : option.replaceStart }), ...(option.replaceEnd === undefined ? {} : { replaceEnd: option.replaceEnd - 1 }), label: option.label.replace(/^@/, ''), insert: option.insert.replace(/^@/, ''), detail: option.detail.replace('до срока', 'до начала').replace('due time', 'start') })) };
    }
  }
  return { ...result, options: result.options.map(option => {
    const originalCommand = input.slice(result.start, result.end);
    if (/^(?:@|(?:event\s+(?:opens|ends)|[a-zа-яё]+):)/i.test(originalCommand)) return option;
    const withoutCommandColon = (value: string) => value.replace(/^((?:event\s+(?:opens|ends)|[a-zа-яё]+)):/i, '$1 ');
    return { ...option, label: withoutCommandColon(option.label), insert: withoutCommandColon(option.insert) };
  }) };
}
