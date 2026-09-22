import type { UniversalItem } from '@utm/core';

export const normalizeSearch = (text: string) => text.normalize('NFKC').toLocaleLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
type SearchEntry = { item: UniversalItem; title: string; words: string[]; other: string };
function customText(value: unknown, depth = 0): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (!value || typeof value !== 'object' || depth >= 3) return '';
  return Object.entries(value).slice(0, 100).map(([key, child]) => `${key} ${customText(child, depth + 1)}`).join(' ');
}
/** Explicit user-facing fields only: never credentials, sync tokens or script source. */
export function createItemSearchIndex(items: UniversalItem[]): SearchEntry[] {
  return items.map(item => {
    const title = normalizeSearch(item.title);
    const other = normalizeSearch([
      item.bodyMarkdown, item.location, item.state, item.preset, item.isNote ? 'note заметка' : '',
      ...item.areas, ...item.projects, ...item.tags, ...item.contexts, item.area, item.project, item.list,
      item.createdAt, item.updatedAt, ...Object.values(item.schedule ?? {}),
      item.reminders.length ? 'reminder reminders напоминание напоминания' : '',
      ...item.reminders.map(reminder => `${reminder.at ?? ''} ${reminder.offset ?? ''}`),
      item.priority, customText(item.custom),
    ].filter(value => value !== undefined && value !== null).join(' '));
    return { item, title, words: title.split(/[^\p{L}\p{N}]+/u).filter(Boolean), other };
  });
}
function oneTypo(a: string, b: string): boolean {
  if (a.length < 4 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length === b.length && a[i] === b[j + 1] && a[i + 1] === b[j]) { i += 2; j += 2; }
    else if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else { i++; j++; }
  }
  return edits + Number(i < a.length || j < b.length) <= 1;
}
export function searchItems(index: SearchEntry[], input: string): UniversalItem[] {
  const query = normalizeSearch(input.slice(0, 256));
  if (!query) return index.map(entry => entry.item);
  const terms = query.split(' ').slice(0, 12);
  return index.map(entry => {
    const titleTerms = terms.every(term => entry.title.includes(term));
    const fuzzyTitle = terms.every(term => entry.title.includes(term) || entry.words.some(word => oneTypo(term, word)));
    const allFields = terms.every(term => entry.title.includes(term) || entry.other.includes(term));
    const score = entry.title === query ? 1000 : entry.title.startsWith(query) ? 900 : entry.title.includes(query) ? 800 : titleTerms ? 700 : fuzzyTitle ? 600 : allFields ? 100 : 0;
    return { item: entry.item, score };
  }).filter(result => result.score > 0).sort((a, b) => b.score - a.score || b.item.updatedAt.localeCompare(a.item.updatedAt) || a.item.id.localeCompare(b.item.id)).map(result => result.item);
}
