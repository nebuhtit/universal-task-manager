import { buildRecurrenceRule, createOccurrence } from './recurrence.js';
import type { UniversalItem, WorkspaceDocument } from './types.js';

const comparableFields = [
  'title', 'bodyMarkdown', 'preset', 'canBeCompleted', 'isNote', 'areas', 'projects', 'tags', 'contexts',
  'location', 'schedule', 'reminders', 'eventProgram', 'priority', 'list', 'custom', 'attachments', 'relations', 'scripts',
] as const;

const canonical = (value: unknown): unknown => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonical(entry)]))
    : value;

const fingerprint = (item: UniversalItem): string => JSON.stringify(canonical(Object.fromEntries(
  comparableFields.map(field => [field, item[field] ?? null]),
)));

/**
 * Remove only empty generated cycles which were materialized and immediately
 * deleted by an older Google cancellation import. Tombstones are deliberately
 * retained so a stale replica or sync response cannot resurrect them.
 */
export function pruneTechnicalDeletedOccurrences(workspace: WorkspaceDocument): number {
  let removed = 0;
  const recurrenceRules = new Map<string, ReturnType<typeof buildRecurrenceRule>>();
  for (const item of Object.values(workspace.items)) {
    if (item.role !== 'occurrence' || !item.occurrence || !item.deletedAt || !workspace.tombstones[item.id] || item.state !== 'open') continue;
    if (item.closure || item.recurrenceOverride || item.activeTimer || item.habit || item.progress
      || item.completionEntries?.length || item.actualTimeEntries?.length || item.timerHistory?.length || item.cycleHistory?.length) continue;
    const series = workspace.items[item.occurrence.seriesId];
    if (!series?.recurrence || series.deletedAt || !Number.isFinite(Date.parse(item.occurrence.recurrenceId))) continue;
    const anchor = new Date(item.occurrence.recurrenceId);
    if (series.recurrence.exdates.some(value => Date.parse(value) === anchor.getTime())) continue;
    const rule = recurrenceRules.get(series.id) ?? buildRecurrenceRule(series);
    recurrenceRules.set(series.id, rule);
    if (!rule.between(new Date(anchor.getTime() - 1), anchor, true).length) continue;
    let generated: UniversalItem;
    try { generated = createOccurrence(series, anchor, item.occurrence.sequence); }
    catch { continue; }
    if (fingerprint(item) !== fingerprint(generated)) continue;
    delete workspace.items[item.id];
    removed += 1;
  }
  return removed;
}
