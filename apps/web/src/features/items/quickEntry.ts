import { createId, createItem, durationToMs, type UniversalItem } from '@utm/core';
import { bareDurationInsertion, dateValueExpression, duration, parseDate, parseLiveEntry as parseEntry, type Draft } from '../../../quick-entry-lab/parser';
import { extractOrganization } from '../../../quick-entry-lab/organization';

export const QUICK_ENTRY_SOURCE = 'utm:quickEntrySource';
const QUICK_REMINDER_FOLLOWUPS = 'utm:quickReminderFollowups';
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
  if (/^\.(?:\s|$)/.test(text.trimStart())) return text;
  const bareAt = bareDurationInsertion(text);
  if (bareAt >= 0) text = text.slice(0, bareAt).replace(/на\s+$/, '') + 'длительность ' + text.slice(bareAt);
  text = text.replace(/"[^"\n]*"|«[^»\n]*»|(^|\s)(?:ттб|ttb|туда\s+и\s+обратно(?:\s+по)?)(?::|\s)\s*((?:\d+(?:[.,]\d+)?\s*(?:minutes?|hours?|минуты?|мин|часов|часа?|[mhмч])\s*)+)/gi, (match, leading: string | undefined, value: string | undefined) => {
    const amount = value ? duration(value) : null;
    return amount === null ? match : `${leading ?? ''}дорога ${amount}м обратно ${amount}м `;
  });
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
    if (start > 0 && /[.\p{L}\p{N}]/u.test(masked[start - 1]!)) continue;
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
  text = text.replace(/(^|\s)(напомнить|нап|напомни|напоминание|напоминания|remind(?:\s+me)?|reminder|н|r)(?::|\s)\s*(?:(?:в|at)\s+)?(\d{1,2}(?::|\s)\d{2})(?=\s|$)/gi, (match, leading: string, key: string, clock: string) => {
    const at = parseEntry(`Reminder напомнить ${clock}`, now).reminders[0]?.at;
    return at ? `${leading}${key} в ${localDateTime(at)}` : match;
  });
  text = text.replace(/(?:через|\bin)\s*(?:полтора\s+часа|полчаса|неделю|half\s+an?\s+hour|an?\s+hour\s+and\s+a\s+half|a\s+week|(?:\d+(?:[.,]\d+)?\s*[a-zа-я]+\s*)+)/gi, value => {
    const reminder = relativeNow[nextReminder++];
    return reminder?.at ? `в ${localDateTime(reminder.at)}${/\s$/.test(value) ? ' ' : ''}` : value;
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

/** Presentation only: keep quoted titles and decimal commas untouched. */
export function formatQuickEntryForEditor(text: string): string {
  text = text.replace(editorDefaultReminders, '').trimEnd();
  // Compact only parser-recognized commands, and verify semantic parity. Never
  // rewrite a title, quoted text, dates, or an ambiguous/unfinished command.
  const now = new Date(2026, 0, 15, 12);
  const parsed = parseEntry(text, now);
  const aliases: Record<string, string> = { длительность: 'дл', duration: 'dr', дорога: 'тт', ехать: 'тт', обратно: 'тб', 'travel time': 'tt', travel: 'tt', drive: 'tt', 'travel back': 'tb', напомнить: 'н', напоминание: 'н', remind: 'r', reminder: 'r', 'remind me': 'r', 'event opens': 'start', 'event ends': 'end' };
  const candidate = text.replace(/"[^"\n]*"|«[^»\n]*»|(^|\s)(длительность|duration|дорога|ехать|обратно|travel time|travel back|travel|drive|напомнить|напоминание|remind me|reminder|remind|event opens|event ends)(?=\s|:)/gi, (match, leading: string | undefined, command: string | undefined, offset: number) => {
    if (!command || !parsed.commandSpans?.some(span => span.start <= offset + leading!.length && span.end > offset + leading!.length)) return match;
    return leading + aliases[command.toLowerCase()]!;
  });
  const semantic = ({ commandSpans: _spans, ...draft }: Draft) => JSON.stringify(draft);
  if (candidate !== text && !parsed.errors.length && semantic(parsed) === semantic(parseEntry(candidate, now))) text = candidate;
  let quote = '', result = '';
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (!quote && (char === '"' || char === '«')) quote = char === '«' ? '»' : '"';
    else if (char === quote && text[index - 1] !== '\\') quote = '';
    result += char;
    if (!quote && char === ',' && text[index + 1] && !/\s/.test(text[index + 1]!) && !(/\d/.test(text[index - 1] ?? '') && /\d/.test(text[index + 1]!))) result += ' ';
  }
  return result;
}

const editorDefaultReminders = /\s+(?:напомнить|remind)\s+(?:начало|start)-120[мm],\s*(?:начало|start)-1440[мm]\s*$/i;

/** Hidden default reminder syntax remains part of the source, not the visible title. */
export function applyQuickEntryEditorText(item: UniversalItem, text: string, now: Date) {
  const hidden = quickEntrySource(item)?.text.match(editorDefaultReminders)?.[0];
  const expanded = hidden && !parseEntry(text, now).reminders.length ? text.trimEnd() + hidden : text;
  return applyQuickEntryText(item, expanded, now);
}

export function applyQuickEntryText(item: UniversalItem, text: string, now: Date): { item: UniversalItem; draft: Draft } {
  const draft = parseEntry(text, now);
  if (draft.errors.length) throw new Error(draft.errors.join(' '));
  const organization = extractOrganization(text);
  const metadata = [...organization.areas.map(name => `area:${JSON.stringify(name)}`), ...organization.projects.map(name => `project:${JSON.stringify(name)}`), ...organization.tags.map(name => `#${JSON.stringify(name)}`)];
  const normalizedText = [materializeQuickEntryText(organization.text, now), ...metadata].join(' ');
  const previous = extractOrganization(quickEntrySource(item)?.text ?? '');
  const memberships = (current: string[], old: string[], next: string[]) => [...new Set([...current.filter(name => !old.includes(name)), ...next])];
  const schedule = { timezone: item.schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, ...item.schedule };
  if (draft.due) schedule.dueAt = draft.due; else delete schedule.dueAt;
  if (draft.plannedDate) schedule.plannedDate = draft.plannedDate; else delete schedule.plannedDate;
  if (draft.start) schedule.startAt = draft.start; else delete schedule.startAt;
  if (draft.end) schedule.endAt = draft.end; else delete schedule.endAt;
  if (draft.durationMinutes !== null) schedule.estimatedDuration = minutesDuration(draft.durationMinutes); else delete schedule.estimatedDuration;
  if (draft.travelMinutes !== null) schedule.travelDuration = minutesDuration(draft.travelMinutes); else delete schedule.travelDuration;
  if (draft.travelBackMinutes !== undefined) schedule.travelBackDuration = minutesDuration(draft.travelBackMinutes); else delete schedule.travelBackDuration;
  return {
    item: {
      ...item, title: draft.title, schedule, reminders: reminderItems(draft),
      ...(draft.isNote ? { isNote: true, canBeCompleted: false } : {}),
      areas: memberships(item.areas, previous.areas, draft.areas ?? []),
      projects: memberships(item.projects, previous.projects, draft.projects ?? []),
      tags: memberships(item.tags, previous.tags, draft.tags ?? []),
      extensions: { ...item.extensions, [QUICK_ENTRY_SOURCE]: { text: normalizedText, timezone: schedule.timezone, grammarVersion: 2 } satisfies QuickEntrySource },
    }, draft,
  };
}

export function createQuickEntryItem(text: string, now: Date, defaultPlannedDate?: string): UniversalItem {
  let original = text.trim();
  if (!original) throw new Error('Добавьте название.');
  const initial = parseEntry(original, now);
  if (initial.noDateDefaults) defaultPlannedDate = undefined;
  if (!initial.isNote && !initial.noDateDefaults && !initial.start && !initial.end && !initial.due && !initial.plannedDate && initial.durationMinutes === null && !initial.errors.length) original += ' длительность 10м';
  if (defaultPlannedDate && !initial.isNote) {
    const masked = original.replace(/"[^"\n]*"|«[^»\n]*»/g, value => ' '.repeat(value.length));
    const explicitDay = new RegExp(`(?:^|\\s)${dateValueExpression}(?=\\s|$)`, 'i').test(masked);
    const clock = /(?:^|\s)(\d{1,2}:\d{2})(?=\s|$)/.exec(masked);
    if (!explicitDay && clock) {
      const at = clock.index + clock[0].length - clock[1]!.length;
      original = original.slice(0, at) + defaultPlannedDate.split('-').reverse().join('.') + ' ' + original.slice(at);
    }
  }
  try {
    const created = applyQuickEntryText(createItem('', 'task', now), original, now);
    if (created.draft.isNote) return created.item;
    if (!created.draft.start && !created.draft.due && created.item.reminders.length > 0) {
      const moments = created.item.reminders.map(reminder => reminder.at).filter((at): at is string => Boolean(at && Number.isFinite(Date.parse(at)))).sort((left, right) => Date.parse(left) - Date.parse(right));
      const first = moments[0];
      if (first) {
        const following = [1, 2].map(hours => new Date(Date.parse(first) + hours * 3_600_000).toISOString())
          .filter(at => !moments.includes(at))
          .map(at => ({ id: createId(), mode: 'absolute' as const, at, urgency: 'normal' as const, repeatUntilAcknowledged: false }));
        const next = { ...created.item, schedule: { ...created.item.schedule!, dueAt: first }, reminders: [...created.item.reminders, ...following], extensions: { ...created.item.extensions, [QUICK_REMINDER_FOLLOWUPS]: following.map(reminder => reminder.id) } };
        created.item = syncQuickEntrySource(created.item, next);
      }
    }
    if (!created.draft.start) {
      if (defaultPlannedDate && !created.draft.plannedDate && !created.draft.due && !created.draft.end) {
        created.item.schedule = { ...created.item.schedule!, plannedDate: defaultPlannedDate };
        // Preserve the chosen day when the saved capture text is edited later.
        const source = quickEntrySource(created.item);
        if (source) created.item.extensions![QUICK_ENTRY_SOURCE] = { ...source, text: `${defaultPlannedDate.split('-').reverse().join('.')} ${source.text}` };
      }
      return created.item;
    }
    const anchor = created.draft.leave ?? created.draft.start;
    if (created.draft.noDefaultReminders) return created.item;
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
    const fallback = createItem(text.trim(), 'task', now);
    if (defaultPlannedDate) fallback.schedule = { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, plannedDate: defaultPlannedDate };
    return fallback;
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
  const followupIds = previous.extensions?.[QUICK_REMINDER_FOLLOWUPS];
  if (Array.isArray(followupIds) && (previous.schedule?.dueAt !== next.schedule?.dueAt || previous.schedule?.plannedDate !== next.schedule?.plannedDate || previous.schedule?.startAt !== next.schedule?.startAt)) {
    const ids = new Set(followupIds.filter((value): value is string => typeof value === 'string'));
    const extensions = { ...next.extensions }; delete extensions[QUICK_REMINDER_FOLLOWUPS];
    next = { ...next, reminders: next.reminders.filter(reminder => !ids.has(reminder.id)), extensions };
  }
  if (previous.schedule?.plannedDate !== next.schedule?.plannedDate || previous.schedule?.dueDateOnly !== next.schedule?.dueDateOnly) {
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
    { before: previous.schedule?.estimatedDuration, after: next.schedule?.estimatedDuration, key: 'длительность', aliases: '(?:длительность|duration|дл|dr)' },
    { before: previous.schedule?.travelDuration, after: next.schedule?.travelDuration, key: 'дорога', aliases: '(?:дорога|ехать|тт|tt|travel(?!\\s+back)(?:\\s+time)?|drive)' },
    { before: previous.schedule?.travelBackDuration, after: next.schedule?.travelBackDuration, key: 'обратно', aliases: '(?:обратно|тб|tb|travel\\s+back)' },
  ];
  for (const change of durationChanges) {
    if (change.before === change.after) continue;
    const command = new RegExp(`(^|\\s)(${change.aliases})(?::|\\s)\\s*`, 'i');
    const amount = change.after ? durationToMs(change.after) / 60000 : 0;
    const found = command.exec(text);
    if (found) {
      const start = found.index + found[0].length;
      let valueLength = 0;
      for (let end = start + 1; end <= text.length; end++) {
        if (end < text.length && !/\s/.test(text[end]!)) continue;
        if (duration(text.slice(start, end)) !== null) valueLength = text.slice(start, end).trimEnd().length;
      }
      text = text.slice(0, found.index) + (amount ? `${found[1]}${found[2]} ${amount}м` : '') + text.slice(start + valueLength);
    }
    else if (amount) text += ` ${change.key} ${amount}м`;
  }
  if (JSON.stringify(previous.reminders) !== JSON.stringify(next.reminders)) {
    const values = next.reminders.map(reminder => {
      if (reminder.mode === 'absolute') return reminder.at ? `в ${localDateTime(reminder.at)}` : '';
      const amount = reminder.offset ? Math.round(Math.abs(durationToMs(reminder.offset)) / 60_000) : 0;
      const anchor = reminder.relativeTo === 'due' ? 'срок' : 'начало';
      return amount > 0 ? `${anchor}${reminder.offset?.startsWith('-') ? '-' : '+'}${amount}м` : '';
    }).filter(Boolean).join(', ');
    const command = /(^|\s)(напомнить|нап|напомни|напоминание|напоминания|напомянание|н|remind(?:\s+me)?|reminder|r)\s+.+?(?=\s+(?:срок|due|начало|start|конец|end|дорога|ехать|тт|tt|travel|drive|длительность|duration|event\s+opens|event\s+ends)\s+|$)/i.exec(text);
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
