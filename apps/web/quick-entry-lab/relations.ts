import { isLiteralEntry } from './literal';
/** Explicit selected references survive duplicate titles and later renames. */
export function extractWithinRelations(input: string) {
  if (isLiteralEntry(input)) return { text: input, displayText: input, ids: [], tokens: [] };
  const ids: string[] = [];
  const tokens: string[] = [];
  const spans: Array<{ start: number; end: number }> = [];
  const text = input.replace(/"(?:\\.|[^"\\])*"|«[^»]*»|(?:^|\s)(?:rr|рр)\s+\[([^\]\n]*)\]\(item:([^\s)]+)\)/giu, (match, _title: string | undefined, encoded: string | undefined, offset: number) => {
    if (!encoded) return match;
    try { const id = decodeURIComponent(encoded); if (!ids.includes(id)) ids.push(id); } catch { return match; }
    tokens.push(match.trim());
    spans.push({ start: offset, end: offset + match.length });
    return ' '.repeat(match.length);
  });
  let displayText = input;
  for (const span of spans.reverse()) displayText = displayText.slice(0, span.start) + displayText.slice(span.end);
  return { text, ids, tokens, displayText };
}

export const joinWithinText = (text: string, tokens: string[]) => tokens.length ? `${text}\n${tokens.join('\n')}` : text;

type WithinSuggestionItem = { id: string; title: string; preferred?: boolean; detail?: string; referenceId?: string; wholeSeries?: boolean };
export function withinSuggestions(input: string, caret: number, items: WithinSuggestionItem[] | (() => WithinSuggestionItem[]), language = 'ru') {
  if (isLiteralEntry(input)) return null;
  const match = /(?:^|\s)(rr|рр)(?:\s+([^\[\]\n]*))?$/iu.exec(input.slice(0, caret));
  if (!match || /^\d/.test((match[2] ?? '').trim())) return null; // legacy numeric rr alarm shorthand
  const query = (match[2] ?? '').trimStart().toLocaleLowerCase();
  const chosen = new Set(extractWithinRelations(input).ids);
  const start = match.index + match[0].indexOf(match[1]!);
  return { start, end: caret, ordered: true, options: (typeof items === 'function' ? items() : items).filter(i => !chosen.has(i.referenceId ?? i.id) && i.title.toLocaleLowerCase().includes(query)).sort((a, b) => Number(Boolean(b.preferred)) - Number(Boolean(a.preferred)) || Number(b.title.toLocaleLowerCase().startsWith(query)) - Number(a.title.toLocaleLowerCase().startsWith(query)) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)).slice(0, 30).map(i => ({
    label: i.title || 'Untitled item', insert: `rr [${i.title.replace(/[\]\n]/g, ' ')}](item:${encodeURIComponent(i.referenceId ?? i.id)}) `,
    detail: `${i.wholeSeries ? (language === 'ru' ? 'Вся серия · ' : 'Entire series · ') : ''}${i.preferred ? (language === 'ru' ? 'Закреплённый блок' : 'Reserved block') : (language === 'ru' ? 'Выполняется внутри' : 'Scheduled within')} · ${i.detail ?? i.id.slice(-8)}`,
  })) };
}
