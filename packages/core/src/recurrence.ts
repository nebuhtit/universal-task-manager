import { RRule, RRuleSet } from 'rrule';
import { durationToMs } from './dsl.js';
import { APP_ID, APP_NAME, APP_VERSION } from './types.js';
import type { ProjectedOccurrence, ReconcileResult, UniversalItem, WorkspaceDocument } from './types.js';

function shiftIso(value: string | undefined, deltaMs: number): string | undefined {
  return value ? new Date(new Date(value).getTime() + deltaMs).toISOString() : undefined;
}

export function deterministicOccurrenceId(seriesId: string, anchor: string): string {
  return `occ_${seriesId}_${anchor.replace(/[-:.TZ]/g, '')}`;
}

function addDates(rule: RRuleSet, values: string[], exclude = false): void {
  for (const value of values) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) continue;
    if (exclude) rule.exdate(date); else rule.rdate(date);
  }
}

export function buildRecurrenceRule(series: UniversalItem): RRuleSet {
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

export function createOccurrence(series: UniversalItem, anchor: Date, sequence: number): UniversalItem {
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
  const reminders = detached.reminders.map((reminder) => reminder.mode === 'absolute' && reminder.at
    ? { ...reminder, at: shiftIso(reminder.at, delta)! }
    : reminder);
  return {
    ...snapshot,
    id: deterministicOccurrenceId(series.id, recurrenceId),
    createdWithAppId: APP_ID,
    createdWithAppName: APP_NAME,
    createdWithVersion: APP_VERSION,
    role: 'occurrence',
    revision: 1,
    state: 'open',
    createdAt: schedule.availableFrom,
    updatedAt: schedule.availableFrom,
    schedule,
    reminders,
    occurrence: { seriesId: series.id, recurrenceId, sequence, templateRevision: series.revision },
  };
}

function closingBoundary(current: UniversalItem, nextActivation: Date | undefined): Date | undefined {
  const seriesRule = current.custom.__closeAt;
  if (seriesRule === 'never') return undefined;
  if (seriesRule === 'due') return current.schedule?.dueAt ? new Date(current.schedule.dueAt) : nextActivation;
  return nextActivation;
}

/** Converts legacy materialized Habit cycles into a compact completed-date log. */
export function consolidateHabitOccurrences(workspace: WorkspaceDocument, now = new Date()): number {
  let removed = 0;
  const habits = Object.values(workspace.items).filter((item) => item.role === 'series_template' && item.preset === 'habit' && !item.deletedAt);
  for (const series of habits) {
    series.habit ??= { target: 1, unit: 'times', streakMode: 'manual_only', completedDates: [] };
    series.habit.completedDates ??= [];
    const legacyOccurrences = Object.values(workspace.items).filter((item) => item.occurrence?.seriesId === series.id);
    for (const occurrence of legacyOccurrences) {
      if (occurrence.state === 'done') series.habit.completedDates.push(occurrence.occurrence!.recurrenceId.slice(0, 10));
      workspace.tombstones[occurrence.id] = now.toISOString();
      delete workspace.items[occurrence.id];
      removed += 1;
    }
    series.habit.completedDates = [...new Set(series.habit.completedDates)].sort();
    series.state = 'open';
    delete series.closure;
  }
  return removed;
}

export function reconcileRecurrences(workspace: WorkspaceDocument, now = new Date()): ReconcileResult {
  const created: UniversalItem[] = [];
  const autoClosed: UniversalItem[] = [];
  let untouched = 0;
  consolidateHabitOccurrences(workspace, now);
  const templates = Object.values(workspace.items).filter(
    (item) => item.role === 'series_template' && item.recurrence && item.schedule?.startAt && !item.deletedAt,
  );
  for (const series of templates) {
    if (series.preset === 'habit') {
      untouched += 1;
      continue;
    }
    const rule = buildRecurrenceRule(series);
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
