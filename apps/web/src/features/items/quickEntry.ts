import { createId, createItem, durationToMs, type UniversalItem } from '@utm/core';
import { dateValueExpression, parseDate, parseLiveEntry as parseEntry, type Draft } from '../../../quick-entry-lab/parser';

export const QUICK_ENTRY_SOURCE = 'utm:quickEntrySource';
export type QuickEntrySource = { text: string; timezone: string; grammarVersion?: 2 };

const days = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const pad = (value: number) => String(value).padStart(2, '0');
const localDate = (iso: string) => {
  const date = new Date(iso);
  return `${days[date.getDay()]} ${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
};
const localDateTime = (iso: string) => {
  const date = new Date(iso);
  return `${localDate(iso)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const minutesDuration = (minutes: number) => `PT${minutes}M`;

export function quickEntrySource(item: UniversalItem): QuickEntrySource | null {
  const value = item.extensions?.[QUICK_ENTRY_SOURCE];
  if (!value || typeof value !== 'object' || typeof (value as QuickEntrySource).text !== 'string' || typeof (value as QuickEntrySource).timezone !== 'string') return null;
  const source = value as QuickEntrySource;
  if (source.grammarVersion === 2 || !item.schedule?.dueAt) return source;
  // Earlier quick-entry items used an unlabelled date for due. Add the new
  // explicit marker only when that exact old due phrase is still in the text.
  const masked = source.text.replace(/"([^"\n]*)"|«([^»\n]*)»/g, quoted => ' '.repeat(quoted.length));
  for (const match of masked.matchAll(new RegExp(dateValueExpression, 'gi'))) {
    const before = masked.slice(0, match.index!);
    if (/(?:@|(?:до|by|срок|due|начало|start|конец|end|с|по|from|to)\s+)$/i.test(before)) continue;
    if (parseDate(match[0], new Date(item.createdAt))?.iso !== item.schedule.dueAt) continue;
    return { ...source, text: source.text.slice(0, match.index) + 'до ' + source.text.slice(match.index), grammarVersion: 2 };
  }
  return source;
}

/** Freeze relative dates at creation while preserving the rest of the wording. */
export function materializeQuickEntryText(text: string, now: Date): string {
  // Freeze a complete named date, never replace its month alone with a
  // standalone month suggestion (which would introduce a guessed clock).
  text = text.replace(/"[^"\n]*"|«[^»\n]*»|\b(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+\d{2,4}(?![\d:]))?/gi, (match, day: string | undefined) => {
    if (!day) return match;
    const date = parseEntry(match, now).plannedDate;
    return date ? date.split('-').reverse().join('.') : match;
  });
  const relativeNow = parseEntry(text, now).reminders.filter(reminder => reminder.anchor === 'now' && reminder.minutes > 0);
  const masked = text.replace(/"([^"\n]*)"|«([^»\n]*)»/g, value => ' '.repeat(value.length));
const relative = /(?:след|следу(?:ю)?щ(?:ий|ую|ая|ем)|next)\s+(?:вс|пн|вт|ср|чт|пт|сб|воскресенье|понедельник|вторник|среда|четверг|пятница|суббота|sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?)|сегодня|завтра|послезавтра|today|tomorrow|(?:след|следу(?:ю)?щ(?:ий|ую|ая|ем))\s+(?:месяц|год)|январ[ья]|феврал[ья]|март[а]?|апрел[ья]|ма[йя]|июн[ья]|июл[ья]|август[а]?|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья]|воскресенье|понедельник|вторник|среда|четверг|пятница|суббота|sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|вс|пн|вт|ср|чт|пт|сб/gi;
const replacements: Array<{ start: number; end: number; value: string }> = [];
  for (const match of masked.matchAll(relative)) {
    const start = match.index!, end = start + match[0].length;
    if (start > 0 && /[\p{L}\p{N}]/u.test(masked[start - 1]!)) continue;
    if (end < masked.length && /[\p{L}\p{N}]/u.test(masked[end]!)) continue;
    if (/^\s+\d{1,2}\.\d{1,2}(?:\.\d{4})?\b/.test(masked.slice(end))) continue;
    const resolved = parseDate(match[0], now);
    if (resolved) replacements.push({ start, end, value: /^(?:след(?:ующий)?\s+(?:месяц|год)|январ[ья]|феврал[ья]|март[а]?|апрел[ья]|ма[йя]|июн[ья]|июл[ья]|август[а]?|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья])$/i.test(match[0]) ? localDateTime(resolved.iso) : localDate(resolved.iso) });
  }
  for (const replacement of replacements.reverse()) text = text.slice(0, replacement.start) + replacement.value + text.slice(replacement.end);
  const currentDue = parseEntry(text, now).due;
  if (currentDue) text = text.replace(/(^|\s)(?:до|by)\s+\d{1,2}(?::|\s)\d{2}(?=\s|$)/i, (match, leading: string) => `${leading}до ${localDateTime(currentDue)}`);
  if (currentDue) text = text.replace(/(^|\s)(?:срок|due)(?::|\s)\s*\d{1,2}(?::|\s)\d{2}(?=\s|$)/i, (match, leading: string) => `${leading}срок:${localDateTime(currentDue)}`);
  const boundaries = parseEntry(text, now);
  for (const [keys, at] of [['начало|start|opens|event opens', boundaries.start], ['конец|end|ends|event ends', boundaries.end]] as const) {
    if (at) text = text.replace(new RegExp(`(^|\\s)(${keys})(?::|\\s)\\s*\\d{1,2}(?::|\\s)\\d{2}(?=\\s|$)`, 'i'), (_match, leading: string, key: string) => `${leading}${key} ${localDateTime(at)}`);
  }
  if (currentDue && /(?:^|\s)(?:сейчас|now)(?=\s|$)/i.test(text)) {
    text = text.replace(/(?:^|\s)(?:сейчас|now)(?=\s|$)/i, (match) => `${match.startsWith(' ') ? ' ' : ''}до ${localDateTime(currentDue)}`);
    if (!parseEntry(text, now).title) text = `Сейчас ${text}`;
  }
  let nextReminder = 0;
  text = text.replace(/(^|\s)(напомнить|напомни|напоминание|напоминания|remind|reminder|r)(?::|\s)\s*(?:(?:в|at)\s+)?(\d{1,2}(?::|\s)\d{2})(?=\s|$)/gi, (match, leading: string, key: string, clock: string) => {
    const at = parseEntry(`Reminder напомнить ${clock}`, now).reminders[0]?.at;
    return at ? `${leading}${key} в ${localDateTime(at)}` : match;
  });
  text = text.replace(/(?:через|in)\s*\d+(?:[.,]\d+)?\s*[a-zа-я]+/gi, value => {
    const reminder = relativeNow[nextReminder++];
    return reminder?.at ? `в ${localDateTime(reminder.at)}` : value;
  });
  return text;
}

function reminderItems(draft: Draft): UniversalItem['reminders'] {
  return draft.reminders.map(reminder => {
    const common = { id: createId(), urgency: 'normal' as const, repeatUntilAcknowledged: false };
    if (reminder.anchor === 'due' || reminder.anchor === 'start') return { ...common, mode: 'relative' as const, relativeTo: reminder.anchor, offset: `${reminder.minutes < 0 ? '-' : ''}${minutesDuration(Math.abs(reminder.minutes))}` };
    return { ...common, mode: 'absolute' as const, ...(reminder.at ? { at: reminder.at } : {}) };
  });
}

export function applyQuickEntryText(item: UniversalItem, text: string, now: Date): { item: UniversalItem; draft: Draft } {
  const draft = parseEntry(text, now);
  if (draft.errors.length) throw new Error(draft.errors.join(' '));
  const normalizedText = materializeQuickEntryText(text, now);
  const schedule = { timezone: item.schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, ...item.schedule };
  if (draft.due) schedule.dueAt = draft.due; else delete schedule.dueAt;
  if (draft.plannedDate) schedule.plannedDate = draft.plannedDate; else delete schedule.plannedDate;
  if (draft.start) schedule.startAt = draft.start; else delete schedule.startAt;
  if (draft.end) schedule.endAt = draft.end; else delete schedule.endAt;
  if (draft.durationMinutes !== null) schedule.estimatedDuration = minutesDuration(draft.durationMinutes); else delete schedule.estimatedDuration;
  if (draft.travelMinutes !== null) schedule.travelDuration = minutesDuration(draft.travelMinutes); else delete schedule.travelDuration;
  return {
    item: {
      ...item, title: draft.title, schedule, reminders: reminderItems(draft),
      extensions: { ...item.extensions, [QUICK_ENTRY_SOURCE]: { text: normalizedText, timezone: schedule.timezone, grammarVersion: 2 } satisfies QuickEntrySource },
    }, draft,
  };
}

export function createQuickEntryItem(text: string, now: Date): UniversalItem {
  const original = text.trim();
  if (!original) throw new Error('Добавьте название.');
  try {
    const created = applyQuickEntryText(createItem('', 'task', now), original, now);
    if (!created.draft.start) return created.item;
    const anchor = created.draft.leave ?? created.draft.start;
    const defaults = [120, 1440].filter(minutes => !created.draft.reminders.some(reminder => reminder.at === new Date(Date.parse(anchor) - minutes * 60_000).toISOString()));
    if (!defaults.length) return created.item;
    // Store defaults in Live text as well, so subsequent parsing and changes to
    // travel time preserve and recalculate them rather than silently dropping them.
    const key = created.draft.leave ? 'выезд' : 'начало';
    return applyQuickEntryText(created.item, `${original} напомнить ${defaults.map(minutes => `${key}-${minutes}м`).join(',')}`, now).item;
  }
  catch {
    // Capture must never discard or block non-empty prose because a command
    // is incomplete. Keep the complete original as title, without guessed dates.
    return createItem(original, 'task', now);
  }
}

const commandDate = (key: string) => new RegExp(`(^|\\s)(${key})\\s+(${dateValueExpression})(?=\\s|$)`, 'i');
const ranges = [
  new RegExp(`(^|\\s)(?:с|from)\\s+(${dateValueExpression})\\s+(?:по|to)\\s+(${dateValueExpression})(?=\\s|$)`, 'i'),
  new RegExp(`(^|\\s)(${dateValueExpression})\\s+[-–—]\\s+(${dateValueExpression})(?=\\s|$)`, 'i'),
];

function replaceCapture(text: string, match: RegExpExecArray, group: number, replacement: string): string {
  const preceding = match.slice(0, group).reduce((length, value, index) => index === 0 ? 0 : length + (value?.length ?? 0), 0);
  const value = match[group]!;
  const relative = match[0].indexOf(value, preceding);
  const start = match.index + relative;
  return text.slice(0, start) + replacement + text.slice(start + value.length);
}

/** Update one source segment when an editor field changes; unrelated words stay put. */
export function syncQuickEntrySource(previous: UniversalItem, next: UniversalItem): UniversalItem {
  const source = quickEntrySource(previous);
  if (!source) return next;
  if (previous.schedule?.plannedDate !== next.schedule?.plannedDate) {
    // Invalidate obsolete source text rather than let a later reparse restore
    // the old date. The item remains the authoritative edited record.
    const extensions = { ...next.extensions }; delete extensions[QUICK_ENTRY_SOURCE];
    return { ...next, extensions };
  }
  let text = source.text;
  if (previous.title !== next.title) {
    const titleAt = text.indexOf(previous.title);
    text = titleAt >= 0
      ? text.slice(0, titleAt) + next.title + text.slice(titleAt + previous.title.length)
      : `${next.title} ${text}`.trim();
  }
  const changes: Array<{ field: 'due' | 'start' | 'end'; old: string | undefined; value: string | undefined; key: string }> = [
    { field: 'due', old: previous.schedule?.dueAt, value: next.schedule?.dueAt, key: '(?:до|by|срок|due)' },
    { field: 'start', old: previous.schedule?.startAt, value: next.schedule?.startAt, key: '(?:начало|start|event\\s+opens)' },
    { field: 'end', old: previous.schedule?.endAt, value: next.schedule?.endAt, key: '(?:конец|end|event\\s+ends)' },
  ];
  for (const change of changes) {
    if (change.old === change.value) continue;
    const replacement = change.value ? localDateTime(change.value) : '';
    const paired = ranges.map(range => range.exec(text)).find(Boolean);
    if (paired && change.field !== 'due') {
      if (replacement) text = replaceCapture(text, paired, change.field === 'start' ? 2 : 3, replacement);
      else {
        const other = change.field === 'start' ? paired[3]! : paired[2]!;
        text = text.slice(0, paired.index) + `${paired[1]}${change.field === 'start' ? 'конец' : 'начало'} ${other}` + text.slice(paired.index + paired[0].length);
      }
      continue;
    }
    const explicit = commandDate(change.key).exec(text);
    if (explicit) text = replacement ? replaceCapture(text, explicit, 3, replacement) : text.slice(0, explicit.index) + text.slice(explicit.index + explicit[0].length);
    else {
      let replacedBareDate = false;
      if ((change.field === 'start' || change.field === 'due') && change.old) {
        const dates = new RegExp(dateValueExpression, 'gi');
        const quoted = text.replace(/"([^"\n]*)"|«([^»\n]*)»/g, value => ' '.repeat(value.length));
        for (const match of quoted.matchAll(dates)) {
          const preceding = quoted.slice(0, match.index!);
          if (/(?:до|by|срок|due|начало|start|конец|end|с|по|from|to)\s+$/i.test(preceding)) continue;
          if (parseDate(match[0], new Date(previous.createdAt))?.iso !== change.old) continue;
          text = text.slice(0, match.index) + replacement + text.slice(match.index! + match[0].length);
          replacedBareDate = true;
          break;
        }
      }
      if (!replacedBareDate && replacement) text += ` ${change.field === 'due' ? 'до' : change.field === 'start' ? 'начало' : 'конец'} ${replacement}`;
    }
  }
  const durationChanges = [
    { before: previous.schedule?.estimatedDuration, after: next.schedule?.estimatedDuration, key: 'длительность' },
    { before: previous.schedule?.travelDuration, after: next.schedule?.travelDuration, key: 'дорога', aliases: '(?:дорога|ехать|тт|tt|travel(?:\\s+time)?|drive)' },
  ];
  for (const change of durationChanges) {
    if (change.before === change.after) continue;
    const command = new RegExp(`(^|\\s)(${('aliases' in change && change.aliases) || change.key})\\s+\\S+`, 'i');
    const amount = change.after ? Number(/PT(\d+)M/i.exec(change.after)?.[1] ?? 0) : 0;
    const found = command.exec(text);
    if (found) text = text.slice(0, found.index) + (amount ? `${found[1]}${found[2]} ${amount}м` : '') + text.slice(found.index + found[0].length);
    else if (amount) text += ` ${change.key} ${amount}м`;
  }
  if (JSON.stringify(previous.reminders) !== JSON.stringify(next.reminders)) {
    const values = next.reminders.map(reminder => {
      if (reminder.mode === 'absolute') return reminder.at ? `в ${localDateTime(reminder.at)}` : '';
      const amount = reminder.offset ? Math.round(Math.abs(durationToMs(reminder.offset)) / 60_000) : 0;
      const anchor = reminder.relativeTo === 'due' ? 'срок' : 'начало';
      return amount > 0 ? `${anchor}${reminder.offset?.startsWith('-') ? '-' : '+'}${amount}м` : '';
    }).filter(Boolean).join(',');
    const command = /(^|\s)(напомнить|напомни|напоминание|напоминания|напомянание|remind|reminder|r)\s+.+?(?=\s+(?:срок|due|начало|start|конец|end|дорога|ехать|тт|tt|travel|drive|длительность|duration|event\s+opens|event\s+ends)\s+|$)/i.exec(text);
    if (command) text = text.slice(0, command.index) + (values ? `${command[1]}${command[2]} ${values}` : '') + text.slice(command.index + command[0].length);
    else if (values) text += ` напомнить ${values}`;
  }
  text = text.replace(/\s+/g, ' ').trim();
  let reminders = next.reminders;
  if (previous.schedule?.startAt !== next.schedule?.startAt || previous.schedule?.travelDuration !== next.schedule?.travelDuration) {
    const refreshed = parseEntry(text, new Date(next.createdAt));
    if (!refreshed.errors.length && refreshed.reminders.length === reminders.length) reminders = reminders.map((reminder, index) => {
      const parsed = refreshed.reminders[index];
      if (!parsed) return reminder;
      if (parsed.anchor === 'leave' && parsed.at) return { ...reminder, mode: 'absolute', at: parsed.at };
      if (parsed.automatic && (parsed.anchor === 'due' || parsed.anchor === 'start')) return {
        ...reminder, mode: 'relative', relativeTo: parsed.anchor,
        offset: `${parsed.minutes < 0 ? '-' : ''}${minutesDuration(Math.abs(parsed.minutes))}`,
      };
      return reminder;
    });
  }
  return { ...next, reminders, extensions: { ...next.extensions, [QUICK_ENTRY_SOURCE]: { ...source, text } } };
}
