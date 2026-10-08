import { itemDeletionTime, type WorkspaceDocument } from '@utm/core';
import { measureProfile } from './performanceProfile';

const MAX_TIMEOUT_MS = 2_147_000_000;

/** Build once per workspace snapshot, never on a clock tick. */
export function activeTimerDeadlines(workspace: WorkspaceDocument): { id: string; at: number }[] {
  return measureProfile('timer.index', () => Object.values(workspace.items).flatMap(item => {
    const timer = item.activeTimer;
    if (itemDeletionTime(workspace, item) || timer?.mode !== 'timer' || timer.stoppedAt || !(timer.targetSeconds! > 0)) return [];
    const at = Date.parse(timer.startedAt) + timer.targetSeconds! * 1000;
    return Number.isFinite(at) ? [{ id: item.id, at }] : [];
  }).sort((a, b) => a.at - b.at), result => ({ matched: result.length }));
}

/** One deadline wakeup; resume reconciles wall time after OS suspension. */
export function watchTimerDeadlines(deadlines: { id: string; at: number }[], onDue: (ids: string[], now: number) => void) {
  let pending = [...deadlines];
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  const resume = () => {
    if (cancelled) return;
    clearTimeout(timeout);
    const now = Date.now();
    const due = pending.filter(value => value.at <= now);
    pending = pending.filter(value => value.at > now);
    if (due.length) onDue(due.map(value => value.id), now);
    if (!cancelled && pending.length) timeout = setTimeout(resume, Math.min(Math.max(0, pending[0]!.at - Date.now()), MAX_TIMEOUT_MS));
  };
  resume();
  return { resume, cancel: () => { cancelled = true; clearTimeout(timeout); } };
}

export function virtualDelayToRealMs(workspace: WorkspaceDocument, virtualDelayMs: number): number {
  if (!(virtualDelayMs > 0)) return 0;
  const clock = workspace.calendarPreferences.testClock;
  if (!clock?.enabled || !(clock.secondsPerDay > 0)) return Math.min(virtualDelayMs, MAX_TIMEOUT_MS);
  return Math.min(virtualDelayMs * clock.secondsPerDay / 86_400, MAX_TIMEOUT_MS);
}

export function scheduleWorkspaceTime(
  workspace: WorkspaceDocument,
  virtualDelayMs: number,
  callback: () => void,
): () => void {
  const timeout = globalThis.setTimeout(callback, Math.max(0, virtualDelayToRealMs(workspace, virtualDelayMs)));
  return () => globalThis.clearTimeout(timeout);
}
