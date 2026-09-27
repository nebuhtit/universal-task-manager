import { createId, createOccurrence, buildRecurrenceRule, recurrenceAnchor, type UniversalItem, type WorkspaceDocument } from '@utm/core';

export interface RecurrenceItemEdit { occurrenceId: string; scope: 'this_occurrence' | 'this_and_future' }
/** Parent writes must finish before an instance edit; splits must also settle
 * affected exceptions so their durable remote identities are not discarded. */
export function recurrenceEditPendingIds(workspace: WorkspaceDocument, intent: RecurrenceItemEdit): string[] {
  const selected = workspace.items[intent.occurrenceId];
  if (!selected?.occurrence) return [];
  const { seriesId, recurrenceId } = selected.occurrence;
  return Object.values(workspace.items).filter(item => !item.deletedAt && item.extensions?.['utm:googleSave'] && (
    item.id === seriesId || (intent.scope === 'this_and_future' && item.occurrence?.seriesId === seriesId && item.occurrence.recurrenceId >= recurrenceId)
    || (item.id === selected.id && (item.extensions['utm:googleSave'] as { kind?: string }).kind === 'delete')
  )).map(item => item.id);
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function ruleKey(value: UniversalItem['recurrence']) {
  if (!value) return '';
  const parts = new Map(value.rrule.replace(/^RRULE:/i, '').toUpperCase().split(';').map(part => part.split('=') as [string, string]));
  if (!parts.has('INTERVAL')) parts.set('INTERVAL', '1');
  return JSON.stringify({ rrule: [...parts].sort(), rdates: [...(value.rdates ?? [])].sort(), exdates: [...(value.exdates ?? [])].sort(), timezone: value.timezone ?? 'UTC', anchor: value.anchor ?? 'schedule', closeAt: value.closeAt ?? 'next_activation', activationOffset: value.activationOffset ?? 'P7D', autoRenew: value.autoRenew !== false });
}
const fields = ['title', 'bodyMarkdown', 'preset', 'canBeCompleted', 'isNote', 'areas', 'projects', 'tags', 'contexts', 'location', 'schedule', 'reminders', 'eventProgram', 'priority', 'list', 'custom', 'attachments', 'relations', 'scripts'] as const;
function applyFields(target: UniversalItem, edited: UniversalItem) {
  for (const field of fields) {
    if (edited[field] === undefined) delete target[field];
    else Object.assign(target, { [field]: clone(edited[field]) });
  }
}

/** Save a selected cycle without rewriting the dates or history of past cycles. */
export function editRecurringItem(workspace: WorkspaceDocument, edited: UniversalItem, intent: RecurrenceItemEdit, now: Date): { item: UniversalItem; previousSeries?: UniversalItem } {
  const selected = workspace.items[intent.occurrenceId];
  const series = selected?.occurrence ? workspace.items[selected.occurrence.seriesId] : undefined;
  if (!selected?.occurrence || !series?.recurrence || series.id !== edited.id || selected.deletedAt) throw new Error('The selected recurrence is unavailable. Reopen the item.');
  if (recurrenceEditPendingIds(workspace, intent).length) throw new Error('A related Google save is still pending. Retry saving when connected; your draft is kept in the editor.');
  const anchor = selected.occurrence.recurrenceId;
  if (intent.scope === 'this_occurrence') {
    if (ruleKey(edited.recurrence) !== ruleKey(series.recurrence)) throw new Error('Choose “This and future” to change the recurrence rule.');
    applyFields(selected, edited);
    selected.recurrenceOverride = { kind: 'this_occurrence', sourceSeriesId: series.id, recurrenceId: anchor };
    selected.revision += 1; selected.updatedAt = now.toISOString();
    return { item: selected };
  }
  const oldSeries = clone(series);
  const rule = buildRecurrenceRule({ ...oldSeries, recurrence: { ...oldSeries.recurrence!, exdates: [], rdates: [] } });
  const beforeCount = rule.between(new Date(Date.parse(recurrenceAnchor(oldSeries)!) - 1), new Date(Date.parse(anchor) - 1), true).length;
  const splitting = beforeCount > 0;
  const until = new Date(Date.parse(anchor) - 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  if (splitting) {
  series.recurrence.rrule = [...series.recurrence.rrule.split(';').filter(part => !/^(UNTIL|COUNT)=/i.test(part)), `UNTIL=${until}`].join(';');
  series.recurrence.rdates = series.recurrence.rdates.filter(value => Date.parse(value) < Date.parse(anchor));
  series.recurrence.exdates = series.recurrence.exdates.filter(value => Date.parse(value) < Date.parse(anchor));
  series.updatedAt = now.toISOString(); series.revision += 1;
  }
  const next = clone(oldSeries);
  next.id = splitting ? createId() : oldSeries.id; next.createdAt = splitting ? now.toISOString() : oldSeries.createdAt; next.updatedAt = now.toISOString(); next.revision = splitting ? 1 : oldSeries.revision + 1;
  applyFields(next, edited);
  next.recurrence = clone(edited.recurrence ?? oldSeries.recurrence!);
  if (ruleKey(next.recurrence) === ruleKey(oldSeries.recurrence)) next.recurrence.rrule = next.recurrence.rrule.replace(/COUNT=(\d+)/i, (_, count: string) => `COUNT=${Math.max(1, Number(count) - beforeCount)}`);
  next.recurrence.rdates = next.recurrence.rdates.filter(value => Date.parse(value) >= Date.parse(anchor));
  next.recurrence.exdates = next.recurrence.exdates.filter(value => Date.parse(value) >= Date.parse(anchor));
  if (splitting) next.recurrenceOverride = { kind: 'future_split', sourceSeriesId: series.id, recurrenceId: anchor };
  if (splitting) delete next.external;
  delete next.occurrence; delete next.closure;
  for (const field of ['completionEntries', 'actualTimeEntries', 'timerHistory', 'cycleHistory', 'activeTimer'] as const) delete next[field];
  if (splitting) for (const key of Object.keys(next.extensions ?? {})) if (key.startsWith('utm:google')) delete next.extensions![key];
  workspace.items[next.id] = next;
  const shift = Date.parse(recurrenceAnchor(next)!) - Date.parse(anchor);
  const nextRule = buildRecurrenceRule(next);
  for (const cycle of Object.values(workspace.items)) {
    if (cycle.occurrence?.seriesId !== series.id || cycle.occurrence.recurrenceId < anchor) continue;
    const newAnchor = new Date(Date.parse(cycle.occurrence.recurrenceId) + shift);
    // A changed frequency must not leave old projected slots alongside the new
    // rule. Keep completed history and explicit exceptions; regenerate defaults.
    const onRule = nextRule.between(new Date(newAnchor.getTime() - 1), newAnchor, true).length > 0;
    if (!onRule && !cycle.recurrenceOverride) {
      if (cycle.state === 'open') { cycle.deletedAt = now.toISOString(); workspace.tombstones[cycle.id] = now.toISOString(); }
      continue;
    }
    if (!onRule && cycle.recurrenceOverride) next.recurrence.rdates = [...new Set([...next.recurrence.rdates, newAnchor.toISOString()])];
    const fresh = createOccurrence(next, newAnchor, Math.max(0, cycle.occurrence.sequence - beforeCount));
    if (cycle.state === 'open' && (!cycle.recurrenceOverride || cycle.id === selected.id)) applyFields(cycle, fresh);
    cycle.occurrence = fresh.occurrence!;
    if (cycle.recurrenceOverride) cycle.recurrenceOverride = { ...cycle.recurrenceOverride, sourceSeriesId: next.id, recurrenceId: fresh.occurrence!.recurrenceId };
    if (splitting && cycle.state === 'open') {
      delete cycle.external;
      for (const key of Object.keys(cycle.extensions ?? {})) if (key.startsWith('utm:google')) delete cycle.extensions![key];
    }
    cycle.updatedAt = now.toISOString(); cycle.revision += 1;
  }
  return { item: next, ...(splitting ? { previousSeries: oldSeries } : {}) };
}
