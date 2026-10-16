import { isLiteralEntry } from './literal';
export interface CalendarSelection { id: string; name: string }

export function calendarToken(calendar: CalendarSelection) {
  return `cc [${calendar.name.replace(/[\]\n\r]/g, ' ')}](calendar:${encodeURIComponent(calendar.id)})`;
}

/** Keep names out of date parsing and preserve identity across calendar renames. */
export function extractCalendarSelection(input: string) {
  if (isLiteralEntry(input)) return { text: input, displayText: input, selection: undefined };
  let selection: CalendarSelection | undefined;
  const spans: Array<{ start: number; end: number }> = [];
  const text = input.replace(/"(?:\\.|[^"\\])*"|«[^»]*»|(?:^|\s)(?:cc|кк)\s+\[([^\]\n]*)\]\(calendar:([^\s)]+)\)/giu, (match, name: string | undefined, encoded: string | undefined, offset: number) => {
    if (!encoded) return match;
    try {
      const id = decodeURIComponent(encoded);
      if (!id) return match;
      selection = { id, name: name ?? id };
    } catch { return match; }
    spans.push({ start: offset, end: offset + match.length });
    return ' '.repeat(match.length);
  });
  let displayText = input;
  for (const span of spans.reverse()) displayText = displayText.slice(0, span.start) + displayText.slice(span.end);
  return { text, displayText, selection };
}

export const joinCalendarText = (text: string, selection?: CalendarSelection) => selection ? `${text}\n${calendarToken(selection)}` : text;

export function calendarSuggestions(input: string, caret: number, calendars: CalendarSelection[] | (() => CalendarSelection[])) {
  if (isLiteralEntry(input)) return null;
  const match = /(?:^|\s)(cc|кк)(?:\s+([^\[\]\n]*))?$/iu.exec(input.slice(0, caret));
  if (!match) return null;
  const query = (match[2] ?? '').trimStart().toLocaleLowerCase();
  const start = match.index + match[0].indexOf(match[1]!);
  return { start, end: caret, ordered: true, options: (typeof calendars === 'function' ? calendars() : calendars)
    .filter(calendar => calendar.name.toLocaleLowerCase().includes(query))
    .sort((a, b) => Number(b.name.toLocaleLowerCase().startsWith(query)) - Number(a.name.toLocaleLowerCase().startsWith(query)) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map(calendar => ({ label: calendar.name, insert: `${calendarToken(calendar)} `, detail: `Google Calendar · ${calendar.id}` })) };
}
