import { describe, expect, it } from 'vitest';
import { addTimerActualTime, countGoalResult, createItem, durationGoalResult, migrateItem, syncCompletionCounter } from './index.js';

describe('completion goals', () => {
  it('counts one timer session once, keeps counting beyond the goal, and reopens only automatic goal closure', () => {
    const item = createItem('Practice');
    item.progress = { mode: 'counter', current: 0, target: 1 };
    const session = { id: 'session-1', mode: 'timer' as const, startedAt: '2026-09-21T10:00:00Z', endedAt: '2026-09-21T10:05:00Z', durationSeconds: 300 };
    addTimerActualTime(item, session);
    addTimerActualTime(item, session);
    syncCompletionCounter(item);
    expect(item.completionEntries).toHaveLength(1);
    expect(item.actualTimeEntries).toHaveLength(1);
    expect(item.progress.current).toBe(1);
    expect(item.state).toBe('done');
    item.completionEntries!.push({ id: 'second', at: '2026-09-21T11:00:00Z', kind: 'manual', comment: '' });
    syncCompletionCounter(item);
    expect(countGoalResult(item)).toEqual({ count: 2, met: true, difference: 1 });
    item.completionEntries = [];
    syncCompletionCounter(item);
    expect(item.state).toBe('open');
  });

  it('compares duration with lower, upper and range goals and keeps schema compatible', () => {
    expect(durationGoalResult(120, { comparison: 'at_least', minSeconds: 180 })).toEqual({ met: false, differenceSeconds: -60 });
    expect(durationGoalResult(120, { comparison: 'at_most', maxSeconds: 180 })).toEqual({ met: true, differenceSeconds: -60 });
    expect(durationGoalResult(240, { comparison: 'between', minSeconds: 120, maxSeconds: 180 })).toEqual({ met: false, differenceSeconds: 60 });
    const item = createItem('Practice');
    item.progress = { mode: 'counter', current: 0, target: 3, durationGoal: { comparison: 'between', minSeconds: 120, maxSeconds: 180 } };
    expect(migrateItem(item).value.progress?.durationGoal).toEqual(item.progress.durationGoal);
  });
});
