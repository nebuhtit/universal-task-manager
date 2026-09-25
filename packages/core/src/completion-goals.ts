import type { Progress, UniversalItem } from './types.js';

export function completionCount(item: UniversalItem): number {
  return (item.completionEntries ?? []).filter((entry) => !entry.revokedAt).length;
}

/** Missing durations are unknown, not zero; revoked completions do not contribute. */
export function completionStatistics(items: readonly UniversalItem[]) {
  let count = 0, timedCount = 0, totalSeconds = 0;
  for (const item of items) {
    for (const completion of item.completionEntries ?? []) {
      if (completion.revokedAt) continue;
      count++;
      const times = (item.actualTimeEntries ?? []).filter(entry => entry.completionId === completion.id && Number.isFinite(entry.durationSeconds) && entry.durationSeconds >= 0);
      if (!times.length) continue;
      timedCount++;
      totalSeconds += times.reduce((sum, entry) => sum + entry.durationSeconds, 0);
    }
  }
  return { count, timedCount, totalSeconds, averageSeconds: timedCount ? totalSeconds / timedCount : undefined };
}

export function countGoalResult(item: UniversalItem): { count: number; met: boolean; difference: number } | undefined {
  if (item.progress?.mode !== 'counter') return undefined;
  const count = completionCount(item);
  const target = Math.max(0, item.progress.target);
  const difference = count - target;
  return { count, met: count > 0 && (item.progress.countComparison === 'at_most' ? difference <= 0 : difference >= 0), difference };
}

/** Recompute the counter from the journal; goal attainment does not add a second completion. */
export function syncCompletionCounter(item: UniversalItem, now = new Date().toISOString()): void {
  const result = countGoalResult(item);
  if (!result || !item.progress) return;
  item.progress.current = result.count;
  if (item.isNote || item.canBeCompleted === false || item.external?.readOnly || (item.external && item.canBeCompleted !== true) || item.role === 'series_template') return;
  if (result.met && item.state === 'open') {
    item.state = 'done';
    item.closure = { at: now, actor: 'automation', reason: 'rule' };
  } else if (!result.met && item.state === 'done' && item.closure?.actor === 'automation' && item.closure.reason === 'rule') {
    item.state = 'open';
    delete item.closure;
  }
}

export function durationGoalResult(seconds: number | undefined, goal: Progress['durationGoal']): { met: boolean; differenceSeconds: number } | undefined {
  if (!goal || seconds === undefined) return undefined;
  const minimum = goal.minSeconds ?? 0;
  const maximum = goal.maxSeconds ?? 0;
  if (goal.comparison === 'at_least') return { met: seconds >= minimum, differenceSeconds: seconds - minimum };
  if (goal.comparison === 'at_most') return { met: seconds <= maximum, differenceSeconds: seconds - maximum };
  if (seconds < minimum) return { met: false, differenceSeconds: seconds - minimum };
  if (seconds > maximum) return { met: false, differenceSeconds: seconds - maximum };
  return { met: true, differenceSeconds: Math.min(seconds - minimum, maximum - seconds) };
}
