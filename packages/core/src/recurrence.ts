import { RRule, RRuleSet } from 'rrule';
import { durationToMs } from './dsl.js';
import type { ReconcileResult, UniversalItem, WorkspaceDocument } from './types.js';

function shiftIso(value: string | undefined, deltaMs: number): string | undefined {
  return value ? new Date(new Date(value).getTime() + deltaMs).toISOString() : undefined;
}

function deterministicOccurrenceId(seriesId: string, anchor: string): string {
  return `occ_${seriesId}_${anchor.replace(/[-:.TZ]/g, '')}`;
}

function addDates(rule: RRuleSet, values: string[], exclude = false): void {
  for (const value of values) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) continue;
    if (exclude) rule.exdate(date); else rule.rdate(date);
  }
}

function buildRule(series: UniversalItem): RRuleSet {
  if (!series.recurrence || !series.schedule?.startAt) throw new Error(`Series ${series.id} has no recurrence start`);
  const value = series.recurrence.rrule.replace(/^RRULE:/, '');
  const parsed = RRule.fromString(value);
  const recurring = new RRule({
    ...parsed.origOptions,
    dtstart: new Date(series.schedule.startAt),
    tzid: series.recurrence.timezone,
  });
  const set = new RRuleSet();
  set.rrule(recurring);
  addDates(set, series.recurrence.rdates);
  addDates(set, series.recurrence.exdates, true);
  return set;
}

function createOccurrence(series: UniversalItem, anchor: Date, sequence: number): UniversalItem {
  // Automerge draft values are document proxies. Copying their nested fields into
  // a new item would create forbidden cross-document references, so occurrences
  // are always materialized from a detached snapshot.
  const detached = JSON.parse(JSON.stringify(series)) as UniversalItem;
  const originalAnchor = new Date(detached.schedule!.startAt!).getTime();
  const delta = anchor.getTime() - originalAnchor;
  const activationOffset = detached.recurrence?.activationOffset ? durationToMs(detached.recurrence.activationOffset) : 0;
  const dueOffset = detached.recurrence?.dueOffset ? durationToMs(detached.recurrence.dueOffset) : undefined;
  const recurrenceId = anchor.toISOString();
  const schedule = {
    ...detached.schedule!,
    availableFrom: new Date(anchor.getTime() - activationOffset).toISOString(),
    startAt: anchor.toISOString(),
    ...(detached.schedule?.endAt ? { endAt: shiftIso(detached.schedule.endAt, delta)! } : {}),
    ...(dueOffset !== undefined
      ? { dueAt: new Date(anchor.getTime() + dueOffset).toISOString() }
      : detached.schedule?.dueAt ? { dueAt: shiftIso(detached.schedule.dueAt, delta)! } : {}),
  };
  const { recurrence: _recurrence, occurrence: _occurrence, closure: _closure, ...snapshot } = detached;
  return {
    ...snapshot,
    id: deterministicOccurrenceId(series.id, recurrenceId),
    role: 'occurrence',
    revision: 1,
    state: 'open',
    createdAt: schedule.availableFrom,
    updatedAt: schedule.availableFrom,
    schedule,
    occurrence: { seriesId: series.id, recurrenceId, sequence, templateRevision: series.revision },
  };
}

function closingBoundary(current: UniversalItem, nextActivation: Date | undefined): Date | undefined {
  const seriesRule = current.custom.__closeAt;
  if (seriesRule === 'never') return undefined;
  if (seriesRule === 'due') return current.schedule?.dueAt ? new Date(current.schedule.dueAt) : nextActivation;
  return nextActivation;
}

export function reconcileRecurrences(workspace: WorkspaceDocument, now = new Date()): ReconcileResult {
  const created: UniversalItem[] = [];
  const autoClosed: UniversalItem[] = [];
  let untouched = 0;
  const templates = Object.values(workspace.items).filter(
    (item) => item.role === 'series_template' && item.recurrence && item.schedule?.startAt && !item.deletedAt,
  );
  for (const series of templates) {
    const rule = buildRule(series);
    const start = new Date(series.schedule!.startAt!);
    const next = rule.after(now, true);
    const anchors = rule.between(new Date(start.getTime() - 1), now, true);
    if (next && next.getTime() > now.getTime()) anchors.push(next);
    const unique = [...new Map(anchors.map((date) => [date.toISOString(), date])).values()].sort((a, b) => a.getTime() - b.getTime());
    const activeAnchors = unique.filter((anchor) => {
      const offset = series.recurrence?.activationOffset ? durationToMs(series.recurrence.activationOffset) : 0;
      return anchor.getTime() - offset <= now.getTime();
    });
    activeAnchors.forEach((anchor, sequence) => {
      const id = deterministicOccurrenceId(series.id, anchor.toISOString());
      if (!workspace.items[id]) {
        const occurrence = createOccurrence(series, anchor, sequence);
        occurrence.custom.__closeAt = series.recurrence!.closeAt;
        workspace.items[id] = occurrence;
        created.push(occurrence);
      } else untouched += 1;
    });
    const occurrences = Object.values(workspace.items)
      .filter((item) => item.occurrence?.seriesId === series.id && !item.deletedAt)
      .sort((a, b) => a.occurrence!.recurrenceId.localeCompare(b.occurrence!.recurrenceId));
    occurrences.forEach((occurrence, index) => {
      if (!series.recurrence!.autoRenew || occurrence.state !== 'open') return;
      const nextOccurrence = occurrences[index + 1];
      const nextActivation = nextOccurrence?.schedule?.availableFrom ? new Date(nextOccurrence.schedule.availableFrom) : undefined;
      const boundary = closingBoundary(occurrence, nextActivation);
      if (boundary && boundary.getTime() <= now.getTime()) {
        occurrence.state = 'auto_closed';
        occurrence.updatedAt = now.toISOString();
        occurrence.revision += 1;
        occurrence.closure = { at: boundary.toISOString(), actor: 'system', reason: 'auto_renew' };
        autoClosed.push(occurrence);
      }
    });
  }
  workspace.updatedAt = now.toISOString();
  return { created, autoClosed, untouched };
}

export function makeSeries(item: UniversalItem, rrule: string, options?: Partial<UniversalItem['recurrence']>): UniversalItem {
  if (!item.schedule?.startAt) throw new Error('A recurring item needs schedule.startAt');
  return {
    ...item,
    role: 'series_template',
    recurrence: {
      rrule,
      rdates: [],
      exdates: [],
      timezone: item.schedule.timezone,
      activationOffset: 'P7D',
      closeAt: 'next_activation',
      anchor: 'schedule',
      autoRenew: true,
      ...options,
    },
  };
}
