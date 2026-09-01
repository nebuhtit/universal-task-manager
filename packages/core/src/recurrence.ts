import * as rruleModule from 'rrule';
import type { RRuleSet as RRuleSetType } from 'rrule';
import { durationToMs } from './dsl.js';
import { APP_ID, APP_NAME, APP_VERSION } from './types.js';
import type { CycleHistoryEntry, ProjectedOccurrence, ReconcileResult, UniversalItem, WorkspaceDocument } from './types.js';

// rrule publishes native named exports for the browser and a CommonJS wrapper
// for Node. The namespace form supports both without making either build mode
// rely on a bundler-specific interop flag.
const rrule = ('RRule' in rruleModule ? rruleModule : Reflect.get(rruleModule, 'default')) as typeof import('rrule');
const { RRule, RRuleSet } = rrule;

export interface RecurrenceIterator {
  all(): Date[];
  after(date: Date, inclusive?: boolean): Date | null;
  between(after: Date, before: Date, inclusive?: boolean): Date[];
}

export type RecurrenceCompletionStorage = 'closure' | 'cycle_history' | 'habit_date';
export interface RecurrenceCompletionRecord {
  seriesId: string;
  ownerItemId: string;
  recurrenceId: string;
  completedAt: string;
  state: CycleHistoryEntry['state'];
  actor: CycleHistoryEntry['actor'];
  reason: CycleHistoryEntry['reason'];
  storage: RecurrenceCompletionStorage;
  startAt?: string;
  dueAt?: string;
  timeRecorded: boolean;
  affectsNextCycle: boolean;
}

export interface RecurrenceCompletionEditResult {
  changed: boolean;
  rescheduled: boolean;
}

function shiftIso(value: string | undefined, deltaMs: number): string | undefined {
  return value ? new Date(new Date(value).getTime() + deltaMs).toISOString() : undefined;
}

export function deterministicOccurrenceId(seriesId: string, anchor: string): string {
  return `occ_${seriesId}_${anchor.replace(/[-:.TZ]/g, '')}`;
}

function localParts(date: Date, timezone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
}

/** A UTC Date used as a timezone-independent container for local wall-clock parts. */
function toFloating(date: Date, timezone: string): Date {
  const part = localParts(date, timezone);
  return new Date(Date.UTC(part.year!, part.month! - 1, part.day!, part.hour!, part.minute!, part.second!, date.getUTCMilliseconds()));
}

/** Resolves local wall-clock parts to an instant. DST gaps advance to the first valid local time. */
function fromFloating(date: Date, timezone: string): Date {
  let instant = new Date(date.getTime());
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const part = localParts(instant, timezone);
    const displayedAsUtc = Date.UTC(part.year!, part.month! - 1, part.day!, part.hour!, part.minute!, part.second!, instant.getUTCMilliseconds());
    const offset = displayedAsUtc - instant.getTime();
    const next = new Date(date.getTime() - offset);
    if (next.getTime() === instant.getTime()) return next;
    instant = next;
  }
  return instant;
}

function addDates(rule: RRuleSetType, values: string[], timezone: string, exclude = false): void {
  for (const value of values) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) continue;
    const floating = toFloating(date, timezone);
    if (exclude) rule.exdate(floating); else rule.rdate(floating);
  }
}

export function buildRecurrenceRule(series: UniversalItem): RecurrenceIterator {
  const anchor = series.schedule?.startAt ?? series.schedule?.dueAt;
  if (!series.recurrence || !anchor) throw new Error(`Series ${series.id} has no recurrence start or deadline`);
  const timezone = series.recurrence.timezone || series.schedule?.timezone || 'UTC';
  const value = series.recurrence.rrule.replace(/^RRULE:/, '');
  const parsed = RRule.fromString(value);
  const recurring = new RRule({
    ...parsed.origOptions,
    // rrule's Date values are floating wall-clock values. Keeping IANA conversion
    // here makes a 09:00 Europe/Berlin series remain 09:00 after DST changes.
    dtstart: toFloating(new Date(anchor), timezone),
    tzid: null,
  });
  const set = new RRuleSet();
  set.rrule(recurring);
  addDates(set, series.recurrence.rdates, timezone);
  addDates(set, series.recurrence.exdates, timezone, true);
  const all = () => set.all().map((date) => fromFloating(date, timezone)).sort((left, right) => left.getTime() - right.getTime());
  return {
    all,
    after(date, inclusive = false) {
      const next = set.after(toFloating(date, timezone), inclusive);
      return next ? fromFloating(next, timezone) : null;
    },
    between(after, before, inclusive = false) {
      return set.between(toFloating(after, timezone), toFloating(before, timezone), inclusive)
        .map((date) => fromFloating(date, timezone))
        .filter((date) => inclusive
          ? date.getTime() >= after.getTime() && date.getTime() <= before.getTime()
          : date.getTime() > after.getTime() && date.getTime() < before.getTime());
    },
  };
}

export function createOccurrence(series: UniversalItem, anchor: Date, sequence: number): UniversalItem {
  // Automerge draft values are document proxies. Copying their nested fields into
  // a new item would create forbidden cross-document references, so occurrences
  // are always materialized from a detached snapshot.
  const detached = JSON.parse(JSON.stringify(series)) as UniversalItem;
  const originalAnchorValue = detached.schedule?.startAt ?? detached.schedule?.dueAt;
  if (!originalAnchorValue) throw new Error(`Series ${series.id} has no recurrence start or deadline`);
  const originalAnchor = new Date(originalAnchorValue).getTime();
  const delta = anchor.getTime() - originalAnchor;
  const activationOffset = detached.recurrence?.activationOffset ? durationToMs(detached.recurrence.activationOffset) : 0;
  const dueOffset = detached.recurrence?.dueOffset ? durationToMs(detached.recurrence.dueOffset) : undefined;
  const recurrenceId = anchor.toISOString();
  const schedule = {
    ...detached.schedule!,
    availableFrom: new Date(anchor.getTime() - activationOffset).toISOString(),
    ...(detached.schedule?.startAt ? { startAt: anchor.toISOString() } : {}),
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

/**
 * Moves a completion-anchored series forward from the time its current cycle
 * was closed. Closed occurrence history remains untouched; only the template
 * is moved to the next cycle.
 */
export function advanceCompletionAnchoredSeries(workspace: WorkspaceDocument, occurrence: UniversalItem, closedAt: string): boolean {
  const seriesId = occurrence.occurrence?.seriesId;
  if (!seriesId) return false;
  const series = workspace.items[seriesId];
  if (!series?.recurrence || series.recurrence.anchor !== 'completion' || (!series.schedule?.startAt && !series.schedule?.dueAt)) return false;
  const closed = new Date(closedAt);
  if (Number.isNaN(closed.getTime())) return false;

  const probe = JSON.parse(JSON.stringify(series)) as UniversalItem;
  const anchorsFromStart = Boolean(series.schedule?.startAt);
  if (anchorsFromStart) probe.schedule!.startAt = closed.toISOString();
  else probe.schedule!.dueAt = closed.toISOString();
  const next = buildRecurrenceRule(probe).after(closed, false);
  if (!next) return false;

  const originalAnchor = series.schedule.startAt ?? series.schedule.dueAt!;
  const delta = next.getTime() - new Date(originalAnchor).getTime();
  const availableFrom = shiftIso(series.schedule.availableFrom, delta);
  const endAt = shiftIso(series.schedule.endAt, delta);
  const dueAt = shiftIso(series.schedule.dueAt, delta);
  series.schedule = {
    ...series.schedule,
    ...(availableFrom ? { availableFrom } : {}),
    ...(anchorsFromStart ? { startAt: next.toISOString() } : {}),
    ...(endAt ? { endAt } : {}),
    ...(dueAt ? { dueAt } : {}),
  };
  series.updatedAt = closed.toISOString();
  series.revision += 1;
  return true;
}

function recurrenceOwnerItems(workspace: WorkspaceDocument, seriesId: string): UniversalItem[] {
  return Object.values(workspace.items).filter((item) => !item.deletedAt && (item.id === seriesId || item.occurrence?.seriesId === seriesId));
}

/**
 * Returns one logical history row per finished recurrence cycle. Auto-renew
 * stores old cycles inside the rolling occurrence, while ordinary recurrence
 * keeps closures on occurrence rows. Habits created by older versions only
 * know the calendar date; those rows remain editable but are marked as not
 * having an originally recorded time.
 */
export function recurrenceCompletionHistory(workspace: WorkspaceDocument, seriesId: string): RecurrenceCompletionRecord[] {
  const series = workspace.items[seriesId];
  if (!series?.recurrence) return [];
  const rows: RecurrenceCompletionRecord[] = [];
  const historyKeys = new Set<string>();
  for (const owner of recurrenceOwnerItems(workspace, seriesId)) {
    for (const entry of owner.cycleHistory ?? []) {
      const key = `${entry.recurrenceId}:${entry.state}`;
      if (historyKeys.has(key)) continue;
      historyKeys.add(key);
      rows.push({
        seriesId, ownerItemId: owner.id, recurrenceId: entry.recurrenceId, completedAt: entry.closedAt,
        state: entry.state, actor: entry.actor, reason: entry.reason, storage: 'cycle_history',
        ...(entry.startAt ? { startAt: entry.startAt } : {}), ...(entry.dueAt ? { dueAt: entry.dueAt } : {}),
        timeRecorded: true, affectsNextCycle: false,
      });
    }
    if (owner.role === 'occurrence' && owner.closure && (owner.state === 'done' || owner.state === 'cancelled' || owner.state === 'auto_closed')) {
      const recurrenceId = owner.occurrence?.recurrenceId ?? owner.schedule?.startAt ?? owner.closure.at;
      const key = `${recurrenceId}:${owner.state}`;
      if (!historyKeys.has(key)) {
        historyKeys.add(key);
        rows.push({
          seriesId, ownerItemId: owner.id, recurrenceId, completedAt: owner.closure.at,
          state: owner.state, actor: owner.closure.actor, reason: owner.closure.reason, storage: 'closure',
          ...(owner.schedule?.startAt ? { startAt: owner.schedule.startAt } : {}), ...(owner.schedule?.dueAt ? { dueAt: owner.schedule.dueAt } : {}),
          timeRecorded: true, affectsNextCycle: false,
        });
      }
    }
  }
  for (const date of series.habit?.completedDates ?? []) {
    if (rows.some((row) => row.state === 'done' && row.completedAt.slice(0, 10) === date)) continue;
    rows.push({
      seriesId, ownerItemId: seriesId, recurrenceId: date, completedAt: `${date}T00:00:00.000Z`,
      state: 'done', actor: 'user', reason: 'manual', storage: 'habit_date', timeRecorded: false, affectsNextCycle: false,
    });
  }
  rows.sort((left, right) => right.recurrenceId.localeCompare(left.recurrenceId) || right.completedAt.localeCompare(left.completedAt));
  if (series.recurrence.anchor === 'completion' && rows[0]) rows[0].affectsNextCycle = true;
  return rows;
}

function nextAnchorFromCompletion(series: UniversalItem, completedAt: string): Date | null {
  const completed = new Date(completedAt);
  if (Number.isNaN(completed.getTime()) || !series.schedule) return null;
  const probe = JSON.parse(JSON.stringify(series)) as UniversalItem;
  if (probe.schedule?.startAt) probe.schedule.startAt = completed.toISOString();
  else if (probe.schedule?.dueAt) probe.schedule.dueAt = completed.toISOString();
  else return null;
  return buildRecurrenceRule(probe).after(completed, false);
}

/** Updates one recorded manual completion without rewriting unrelated cycles. */
export function updateRecurrenceCompletionTime(
  workspace: WorkspaceDocument,
  record: Pick<RecurrenceCompletionRecord, 'seriesId' | 'ownerItemId' | 'recurrenceId' | 'storage' | 'state'>,
  completedAt: string,
  now = new Date(),
): RecurrenceCompletionEditResult {
  if (record.state !== 'done') throw new Error('Only manually completed cycles have an editable completion time.');
  const completed = new Date(completedAt);
  if (Number.isNaN(completed.getTime())) throw new Error('Completion time is invalid.');
  const series = workspace.items[record.seriesId];
  const owner = workspace.items[record.ownerItemId];
  if (!series?.recurrence || !owner) throw new Error('Recurring series history is no longer available.');
  let previous = '';
  const normalizedCompletedAt = completed.toISOString();
  if (record.storage === 'cycle_history') {
    const entry = owner.cycleHistory?.find((candidate) => candidate.recurrenceId === record.recurrenceId && candidate.state === 'done');
    if (!entry) throw new Error('Completion history entry was not found.');
    previous = entry.closedAt;
    if (previous === normalizedCompletedAt) return { changed: false, rescheduled: false };
    entry.closedAt = normalizedCompletedAt; entry.actor = 'user'; entry.reason = 'manual';
  } else if (record.storage === 'closure') {
    if (owner.role !== 'occurrence' || owner.occurrence?.recurrenceId !== record.recurrenceId || owner.state !== 'done' || !owner.closure) throw new Error('Completed occurrence was not found.');
    previous = owner.closure.at;
    if (previous === normalizedCompletedAt) return { changed: false, rescheduled: false };
    owner.closure.at = normalizedCompletedAt; owner.closure.actor = 'user'; owner.closure.reason = 'manual';
  } else {
    const index = series.habit?.completedDates.indexOf(record.recurrenceId) ?? -1;
    if (index < 0 || !series.habit) throw new Error('Habit completion date was not found.');
    previous = `${record.recurrenceId}T00:00:00.000Z`;
    const nextDate = completed.toISOString().slice(0, 10);
    series.habit.completedDates[index] = nextDate;
    series.habit.completedDates = [...new Set(series.habit.completedDates)].sort();
    series.cycleHistory ??= [];
    series.cycleHistory.push({ recurrenceId: new Date(previous).toISOString(), closedAt: normalizedCompletedAt, state: 'done', actor: 'user', reason: 'manual' });
  }
  owner.updatedAt = now.toISOString(); owner.revision += 1;

  let rescheduled = false;
  const latest = recurrenceCompletionHistory(workspace, record.seriesId)[0];
  if (series.recurrence.anchor === 'completion' && latest?.recurrenceId === record.recurrenceId) {
    const currentAnchor = series.schedule?.startAt ?? series.schedule?.dueAt;
    const expectedCurrent = nextAnchorFromCompletion(series, previous);
    const next = nextAnchorFromCompletion(series, normalizedCompletedAt);
    if (currentAnchor && expectedCurrent && next && Math.abs(expectedCurrent.getTime() - new Date(currentAnchor).getTime()) < 1_000) {
      const delta = next.getTime() - new Date(currentAnchor).getTime();
      const shifted = JSON.parse(JSON.stringify(series.schedule)) as NonNullable<UniversalItem['schedule']>;
      for (const key of ['availableFrom', 'startAt', 'endAt', 'dueAt'] as const) {
        const value = shifted[key];
        if (value) shifted[key] = shiftIso(value, delta)!;
      }
      series.schedule = shifted;
      series.updatedAt = now.toISOString(); series.revision += 1;
      if (!series.recurrence.autoRenew) {
        for (const candidate of recurrenceOwnerItems(workspace, series.id)) {
          if (candidate.role !== 'occurrence' || candidate.state !== 'open' || candidate.recurrenceOverride) continue;
          delete workspace.items[candidate.id]; workspace.tombstones[candidate.id] = now.toISOString();
        }
      }
      rescheduled = true;
    }
  }
  workspace.updatedAt = now.toISOString();
  return { changed: true, rescheduled };
}

function closingBoundary(current: UniversalItem, nextActivation: Date | undefined): Date | undefined {
  const seriesRule = current.custom.__closeAt;
  if (seriesRule === 'never') return undefined;
  if (seriesRule === 'due') return current.schedule?.dueAt ? new Date(current.schedule.dueAt) : nextActivation;
  return nextActivation;
}

function appendCycleHistory(item: UniversalItem, entry: CycleHistoryEntry): boolean {
  item.cycleHistory ??= [];
  if (item.cycleHistory.some((candidate) => candidate.recurrenceId === entry.recurrenceId)) return false;
  item.cycleHistory.push(entry);
  item.cycleHistory.sort((left, right) => left.recurrenceId.localeCompare(right.recurrenceId));
  return true;
}

function cycleHistoryFrom(item: UniversalItem, state: CycleHistoryEntry['state'], closedAt: string): CycleHistoryEntry {
  const closure = item.closure;
  return {
    recurrenceId: item.occurrence?.recurrenceId ?? item.schedule?.startAt ?? closedAt,
    ...(item.schedule?.availableFrom ? { availableFrom: item.schedule.availableFrom } : {}),
    ...(item.schedule?.startAt ? { startAt: item.schedule.startAt } : {}),
    ...(item.schedule?.endAt ? { endAt: item.schedule.endAt } : {}),
    ...(item.schedule?.dueAt ? { dueAt: item.schedule.dueAt } : {}),
    closedAt,
    state,
    actor: closure?.actor ?? 'system',
    reason: closure?.reason ?? (state === 'cancelled' ? 'cancelled' : state === 'auto_closed' ? 'auto_renew' : 'manual'),
  };
}

function detachedCycleHistory(item: UniversalItem, excludePrematureRecurrenceId?: string): CycleHistoryEntry[] | undefined {
  if (!item.cycleHistory) return undefined;
  const kept = excludePrematureRecurrenceId
    ? item.cycleHistory.filter((entry) => entry.recurrenceId !== excludePrematureRecurrenceId || entry.reason !== 'auto_renew')
    : item.cycleHistory;
  // Automerge draft children cannot be reattached after their parent fields
  // are deleted. Keep the history as detached values before rebuilding a row.
  return JSON.parse(JSON.stringify(kept)) as CycleHistoryEntry[];
}

/**
 * Auto-renew is a rolling item, not an occurrence archive. Finished cycles are
 * appended to cycleHistory and the same materialized item is moved forward.
 */
function reconcileRollingSeries(
  workspace: WorkspaceDocument,
  series: UniversalItem,
  activeAnchors: Date[],
  rule: RecurrenceIterator,
  now: Date,
  sequenceFor: (anchor: Date) => number,
  updated: UniversalItem[],
  autoClosed: UniversalItem[],
  removedIds: string[],
): UniversalItem | undefined {
  const occurrences = Object.values(workspace.items)
    .filter((item) => item.occurrence?.seriesId === series.id && !item.deletedAt)
    .sort((left, right) => left.occurrence!.recurrenceId.localeCompare(right.occurrence!.recurrenceId));
  let rolling = occurrences.at(-1);
  let rollingChanged = false;
  const pendingHistory: CycleHistoryEntry[] = [];

  // Collapse data produced by older versions. Manual outcomes are preserved;
  // untouched past rows become auto-closed history rather than visible items.
  for (const legacy of occurrences) {
    if (legacy === rolling) continue;
    const state = legacy.state === 'done' || legacy.state === 'cancelled' ? legacy.state : 'auto_closed';
    const closedAt = legacy.closure?.at ?? legacy.schedule?.dueAt ?? legacy.updatedAt;
    const history = cycleHistoryFrom(legacy, state, closedAt);
    if (rolling) rollingChanged = appendCycleHistory(rolling, history) || rollingChanged; else pendingHistory.push(history);
    delete workspace.items[legacy.id];
    removedIds.push(legacy.id);
    rollingChanged = true;
  }

  if (!activeAnchors.length) return rolling;
  const configuredActivationOffset = series.recurrence?.activationOffset ? durationToMs(series.recurrence.activationOffset) : 0;
  const scheduledSpan = Math.max(0, new Date(series.schedule?.endAt ?? series.schedule?.dueAt ?? series.schedule?.startAt ?? 0).getTime() - new Date(series.schedule?.startAt ?? series.schedule?.dueAt ?? 0).getTime());
  const effectiveActivationOffset = (anchor: Date, nextAnchor: Date) => Math.min(configuredActivationOffset, Math.max(0, nextAnchor.getTime() - anchor.getTime() - scheduledSpan));
  const boundaryFor = (occurrence: UniversalItem, anchor: Date) => {
    const nextAnchor = rule.after(anchor, false);
    let nextActivation = nextAnchor ? new Date(nextAnchor.getTime() - effectiveActivationOffset(anchor, nextAnchor)) : undefined;
    const visibleUntil = new Date(occurrence.schedule?.endAt ?? occurrence.schedule?.dueAt ?? occurrence.schedule?.startAt ?? 0);
    if (nextActivation && Number.isFinite(visibleUntil.getTime()) && nextActivation < visibleUntil) nextActivation = visibleUntil;
    return closingBoundary(occurrence, nextActivation);
  };

  // Backfill every missed cycle directly into history. No item rows are born.
  for (const anchor of activeAnchors) {
    const snapshot = createOccurrence(series, anchor, sequenceFor(anchor));
    snapshot.custom.__closeAt = series.recurrence!.closeAt;
    const boundary = boundaryFor(snapshot, anchor);
    if (!boundary || boundary.getTime() > now.getTime()) continue;
    const history = cycleHistoryFrom(snapshot, 'auto_closed', boundary.toISOString());
    if (rolling) rollingChanged = appendCycleHistory(rolling, history) || rollingChanged; else pendingHistory.push(history);
  }

  const latestAnchor = activeAnchors.at(-1)!;
  const fresh = createOccurrence(series, latestAnchor, sequenceFor(latestAnchor));
  fresh.custom.__closeAt = series.recurrence!.closeAt;
  const boundary = boundaryFor(fresh, latestAnchor);
  const shouldAutoClose = Boolean(boundary && boundary.getTime() <= now.getTime());

  if (!rolling) {
    rolling = fresh;
    pendingHistory.forEach((entry) => appendCycleHistory(rolling!, entry));
    if (shouldAutoClose && boundary) {
      rolling.state = 'auto_closed';
      rolling.closure = { at: boundary.toISOString(), actor: 'system', reason: 'auto_renew' };
      appendCycleHistory(rolling, cycleHistoryFrom(rolling, 'auto_closed', boundary.toISOString()));
      autoClosed.push(rolling);
    }
    workspace.items[rolling.id] = rolling;
    return rolling;
  }

  const sameCycle = rolling.occurrence?.recurrenceId === latestAnchor.toISOString();
  const visibleUntil = new Date(rolling.schedule?.endAt ?? rolling.schedule?.dueAt ?? rolling.schedule?.startAt ?? 0);
  const closedAt = rolling.closure?.at ? new Date(rolling.closure.at) : undefined;
  const prematurelyAutoClosed = sameCycle
    && rolling.state === 'auto_closed'
    && rolling.closure?.actor === 'system'
    && rolling.closure.reason === 'auto_renew'
    && closedAt !== undefined
    && Number.isFinite(closedAt.getTime())
    && Number.isFinite(visibleUntil.getTime())
    && closedAt.getTime() < visibleUntil.getTime();
  if (prematurelyAutoClosed) {
    // Older builds subtracted activationOffset from the next recurrence without
    // clamping it to the event span. A daily series with the former P7D default
    // could therefore close six days before the event itself. Rehydrate that
    // still-current cycle from its source template and discard only the bogus
    // system-generated history entry; user completions remain untouched.
    const stable = {
      id: rolling.id,
      createdAt: rolling.createdAt,
      createdWithAppId: rolling.createdWithAppId,
      createdWithAppName: rolling.createdWithAppName,
      createdWithVersion: rolling.createdWithVersion,
      cycleHistory: detachedCycleHistory(rolling, latestAnchor.toISOString()),
    };
    Object.keys(rolling).forEach((key) => { delete (rolling as unknown as Record<string, unknown>)[key]; });
    Object.assign(rolling, fresh, stable, { updatedAt: now.toISOString(), revision: fresh.revision + 1 });
    rollingChanged = true;
  } else if (!sameCycle) {
    if (rolling.state === 'done' || rolling.state === 'cancelled' || rolling.state === 'auto_closed') {
      appendCycleHistory(rolling, cycleHistoryFrom(rolling, rolling.state, rolling.closure?.at ?? rolling.updatedAt));
    }
    const stable = {
      id: rolling.id,
      createdAt: rolling.createdAt,
      createdWithAppId: rolling.createdWithAppId,
      createdWithAppName: rolling.createdWithAppName,
      createdWithVersion: rolling.createdWithVersion,
      cycleHistory: detachedCycleHistory(rolling),
    };
    Object.keys(rolling).forEach((key) => { delete (rolling as unknown as Record<string, unknown>)[key]; });
    Object.assign(rolling, fresh, stable, { updatedAt: now.toISOString(), revision: fresh.revision + 1 });
    rollingChanged = true;
  } else if (rolling.state === 'open' && rolling.occurrence?.templateRevision !== series.revision) {
    // The View renders the materialized rolling item, while Edit item opens
    // the source series.  Refresh an untouched live cycle whenever its source
    // revision changes so edits to Due, Start, End, title, tags, reminders,
    // and other inherited fields appear immediately in every View.  Keep the
    // stable row identity and its completed-cycle history.
    const stable = {
      id: rolling.id,
      createdAt: rolling.createdAt,
      createdWithAppId: rolling.createdWithAppId,
      createdWithAppName: rolling.createdWithAppName,
      createdWithVersion: rolling.createdWithVersion,
      cycleHistory: detachedCycleHistory(rolling),
    };
    Object.keys(rolling).forEach((key) => { delete (rolling as unknown as Record<string, unknown>)[key]; });
    Object.assign(rolling, fresh, stable, { updatedAt: now.toISOString(), revision: fresh.revision + 1 });
    rollingChanged = true;
  }

  if (shouldAutoClose && boundary && rolling.state === 'open') {
    rolling.state = 'auto_closed';
    rolling.closure = { at: boundary.toISOString(), actor: 'system', reason: 'auto_renew' };
    rolling.updatedAt = now.toISOString();
    rolling.revision += 1;
    appendCycleHistory(rolling, cycleHistoryFrom(rolling, 'auto_closed', boundary.toISOString()));
    autoClosed.push(rolling);
    rollingChanged = true;
  }
  if (rollingChanged && !updated.includes(rolling)) updated.push(rolling);
  return rolling;
}

/** Converts legacy materialized Habit cycles into a compact completed-date log. */
export function consolidateHabitOccurrences(workspace: WorkspaceDocument, now = new Date()): number {
  let removed = 0;
  // Habit is a capability of a universal item, not a data type. Older items
  // may use the Task/Event preset while still carrying habit history.
  const habits = Object.values(workspace.items).filter((item) => item.role === 'series_template' && item.habit && !item.deletedAt);
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
  const updated: UniversalItem[] = [];
  const autoClosed: UniversalItem[] = [];
  const removedIds: string[] = [];
  let untouched = 0;
  consolidateHabitOccurrences(workspace, now);
  const templates = Object.values(workspace.items).filter(
    (item) => item.role === 'series_template' && item.recurrence && (item.schedule?.startAt || item.schedule?.dueAt) && !item.deletedAt,
  );
  for (const series of templates) {
    if (series.habit) {
      untouched += 1;
      continue;
    }
    const currentTemplateAnchor = series.schedule?.startAt ?? series.schedule?.dueAt;
    const pendingCompletion = series.recurrence?.anchor === 'completion' && currentTemplateAnchor
      ? Object.values(workspace.items).find((item) => item.occurrence?.seriesId === series.id
        && item.occurrence.recurrenceId === currentTemplateAnchor
        && (item.state === 'done' || item.state === 'cancelled' || item.state === 'auto_closed')
        && Boolean(item.closure?.at))
      : undefined;
    if (pendingCompletion?.closure?.at && advanceCompletionAnchoredSeries(workspace, pendingCompletion, pendingCompletion.closure.at)) updated.push(series);
    const rule = buildRecurrenceRule(series);
    const recurrence = series.recurrence!;
    const start = new Date(series.schedule!.startAt ?? series.schedule!.dueAt!);
    const startIsIncluded = start.getTime() >= now.getTime() && rule.between(new Date(start.getTime() - 1), start, true).some((anchor) => anchor.getTime() === start.getTime());
    const next = startIsIncluded ? start : rule.after(now, true);
    const anchors = recurrence.anchor === 'completion'
      ? [start]
      : [...rule.between(new Date(start.getTime() - 1), now, true), ...(next && next.getTime() > now.getTime() ? [next] : [])];
    const unique = [...new Map(anchors.map((date) => [date.toISOString(), date])).values()].sort((a, b) => a.getTime() - b.getTime());
    const activeAnchors = unique.filter((anchor, index) => {
      const configuredOffset = series.recurrence?.activationOffset ? durationToMs(series.recurrence.activationOffset) : 0;
      const previous = unique[index - 1];
      const scheduledSpan = Math.max(0, new Date(series.schedule?.endAt ?? series.schedule?.dueAt ?? series.schedule?.startAt ?? 0).getTime() - new Date(series.schedule?.startAt ?? series.schedule?.dueAt ?? 0).getTime());
      const offset = previous ? Math.min(configuredOffset, Math.max(0, anchor.getTime() - previous.getTime() - scheduledSpan)) : configuredOffset;
      return anchor.getTime() - offset <= now.getTime();
    });
    if (recurrence.autoRenew) {
      const hadOccurrence = Object.values(workspace.items).some((item) => item.occurrence?.seriesId === series.id && !item.deletedAt);
      const rolling = reconcileRollingSeries(workspace, series, activeAnchors, rule, now, (anchor) => unique.findIndex((candidate) => candidate.getTime() === anchor.getTime()), updated, autoClosed, removedIds);
      if (rolling && !hadOccurrence) created.push(rolling);
      else if (!rolling) untouched += 1;
      continue;
    }
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
      if (occurrence.state !== 'open') return;
      const nextOccurrence = occurrences[index + 1];
      const nextActivation = nextOccurrence?.schedule?.availableFrom ? new Date(nextOccurrence.schedule.availableFrom) : undefined;
      const boundary = closingBoundary(occurrence, nextActivation);
      if (boundary && boundary.getTime() <= now.getTime()) {
        occurrence.state = 'auto_closed';
        occurrence.updatedAt = now.toISOString();
        occurrence.revision += 1;
        occurrence.closure = { at: boundary.toISOString(), actor: 'system', reason: 'auto_renew' };
        advanceCompletionAnchoredSeries(workspace, occurrence, boundary.toISOString());
        autoClosed.push(occurrence);
      }
    });
  }
  if (created.length || updated.length || autoClosed.length || removedIds.length) workspace.updatedAt = now.toISOString();
  return { created, updated, autoClosed, removedIds, untouched };
}

export function makeSeries(item: UniversalItem, rrule: string, options?: Partial<UniversalItem['recurrence']>): UniversalItem {
  if (!item.schedule?.startAt && !item.schedule?.dueAt) throw new Error('A recurring item needs schedule.startAt or schedule.dueAt');
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
