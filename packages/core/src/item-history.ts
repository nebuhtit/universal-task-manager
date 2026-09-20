import { durationToMs, type UniversalItem, type ItemTimerSession, type CompletionEntry } from './types.js';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export function actualTimeMs(item: UniversalItem): number {
  if (item.actualTimeEntries) return item.actualTimeEntries.reduce((sum, entry) => sum +
    (entry.recurrenceId && entry.recurrenceId !== item.occurrence?.recurrenceId ? 0 : Number.isFinite(entry.durationSeconds) && entry.durationSeconds >= 0 ? entry.durationSeconds * 1000 : 0), 0);
  try { const ms = durationToMs(item.schedule?.actualDuration ?? 'PT0S'); return Number.isFinite(ms) && ms > 0 ? ms : 0; } catch { return 0; }
}

export function syncActualDuration(item: UniversalItem): void {
  if (!item.actualTimeEntries) return;
  item.schedule = { ...item.schedule, timezone: item.schedule?.timezone ?? 'UTC', actualDuration: `PT${actualTimeMs(item) / 1000}S` };
}

/** Missing journals are legacy data; an empty journal is an intentional deletion. */
export function initializeItemHistory(item: UniversalItem): void {
  if (!item.actualTimeEntries && item.schedule?.actualDuration) {
    item.actualTimeEntries = [{ id: `imported-time:${item.id}`, durationSeconds: actualTimeMs(item) / 1000, comment: 'Imported', source: 'imported', ...(item.occurrence ? { recurrenceId: item.occurrence.recurrenceId } : {}) }];
  }
  if (!item.completionEntries && !item.external?.readOnly && !item.isNote) {
    const entries: CompletionEntry[] = (item.cycleHistory ?? []).filter((cycle) => cycle.state === 'done' || cycle.state === 'auto_closed').map((cycle) => ({ id: `cycle:${item.id}:${cycle.recurrenceId}`, at: cycle.closedAt, kind: cycle.state === 'auto_closed' || cycle.actor !== 'user' ? 'automatic' : 'manual', comment: '', recurrenceId: cycle.recurrenceId }));
    for (const day of item.habit?.completedDates ?? []) {
      if (!entries.some((entry) => entry.recurrenceId?.slice(0, 10) === day)) entries.push({ id: `habit:${item.id}:${day}`, at: `${day}T00:00:00.000Z`, kind: 'manual', comment: 'Imported', recurrenceId: `${day}T00:00:00.000Z` });
    }
    if ((item.state === 'done' || item.state === 'auto_closed') && item.closure && !entries.some((entry) => entry.recurrenceId === item.occurrence?.recurrenceId && entry.at === item.closure!.at)) entries.push({ id: `closure:${item.id}:${item.closure.at}`, at: item.closure.at, kind: item.closure.actor === 'user' && item.state === 'done' ? 'manual' : 'automatic', comment: '', ...(item.occurrence ? { recurrenceId: item.occurrence.recurrenceId } : {}) });
    if (entries.length) item.completionEntries = entries;
  }
  syncActualDuration(item);
}

export function recordCompletionTransition(item: UniversalItem, previousState: UniversalItem['state'], now: string): void {
  if (item.external?.readOnly || item.isNote) return;
  if ((item.state === 'done' || item.state === 'auto_closed') && item.state !== previousState) {
    item.completionEntries ??= [];
    const at = item.closure?.at ?? now;
    item.completionEntries.push({ id: `completion:${item.id}:${now}:${item.completionEntries.length}`, at, kind: item.state === 'auto_closed' || item.closure?.actor !== 'user' ? 'automatic' : 'manual', comment: '', ...(item.occurrence ? { recurrenceId: item.occurrence.recurrenceId } : {}) });
  } else if (item.state === 'open' && (previousState === 'done' || previousState === 'auto_closed')) {
    const last = [...(item.completionEntries ?? [])].reverse().find((entry) => !entry.revokedAt && entry.recurrenceId === item.occurrence?.recurrenceId);
    if (last) last.revokedAt = now;
  }
}

export function addTimerActualTime(item: UniversalItem, session: ItemTimerSession): void {
  initializeItemHistory(item);
  item.actualTimeEntries ??= [];
  if (item.actualTimeEntries.some((entry) => entry.sourceSessionId === session.id)) return;
  if (session.mode === 'stopwatch' && session.durationSeconds <= 30) return;
  const recurrenceId = session.recurrenceId ?? item.occurrence?.recurrenceId;
  item.actualTimeEntries.push({ id: `timer:${session.id}`, sourceSessionId: session.id, source: session.mode, at: session.startedAt, durationSeconds: session.durationSeconds, comment: '', ...(recurrenceId ? { recurrenceId } : {}) });
  syncActualDuration(item);
}

/** Rolling recurrence rows keep previous-cycle journals, but totals use only the current cycle. */
export function retainedItemHistory(item: UniversalItem): Partial<UniversalItem> {
  initializeItemHistory(item);
  return clone({ ...(item.actualTimeEntries ? { actualTimeEntries: item.actualTimeEntries } : {}), ...(item.completionEntries ? { completionEntries: item.completionEntries } : {}), ...(item.timerHistory ? { timerHistory: item.timerHistory.map((session) => ({ ...session, ...(!session.recurrenceId && item.occurrence ? { recurrenceId: item.occurrence.recurrenceId } : {}) })) } : {}) });
}
