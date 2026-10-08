import { describe, expect, it, vi } from 'vitest';
import { createItem, createWorkspace } from '@utm/core';
import { activeTimerDeadlines, watchTimerDeadlines, scheduleWorkspaceTime, virtualDelayToRealMs } from './workspaceTimers';

describe('workspace timers', () => {
  it('indexes running countdowns only and ignores invalid deadlines', () => {
    const workspace = createWorkspace('Timers');
    for (const [index, mode, stoppedAt, startedAt] of [[0, 'timer', undefined, '2026-01-01T00:00:00Z'], [1, 'stopwatch', undefined, '2026-01-01T00:00:00Z'], [2, 'timer', '2026-01-01T00:00:10Z', '2026-01-01T00:00:00Z'], [3, 'timer', undefined, 'invalid']] as const) {
      const item = createItem(String(index), 'task');
      item.activeTimer = { id: String(index), mode, startedAt, targetSeconds: 60, ...(stoppedAt ? { stoppedAt } : {}) };
      workspace.items[item.id] = item;
    }
    expect(activeTimerDeadlines(workspace).map(value => value.at)).toEqual([Date.parse('2026-01-01T00:01:00Z')]);
  });

  it('has no periodic wakeups, reconciles suspension once and cancels cleanly', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const due = vi.fn();
      const watcher = watchTimerDeadlines([{ id: 'one', at: 60_000 }, { id: 'two', at: 120_000 }], due);
      vi.advanceTimersByTime(59_000);
      expect(due).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(1);
      // OS suspension: wall clock advances while callbacks cannot run.
      vi.setSystemTime(180_000); watcher.resume(); watcher.resume();
      expect(due).toHaveBeenCalledExactlyOnceWith(['one', 'two'], 180_000);
      expect(vi.getTimerCount()).toBe(0);
      watcher.cancel(); watcher.resume();
      expect(due).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it('does not schedule empty lists and does not complete cancelled timers', () => {
    vi.useFakeTimers();
    try {
      const due = vi.fn();
      watchTimerDeadlines([], due).cancel();
      expect(vi.getTimerCount()).toBe(0);
      watchTimerDeadlines([{ id: 'one', at: Date.now() + 1000 }], due).cancel();
      vi.advanceTimersByTime(2000);
      expect(due).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('keeps normal workspace delays unchanged', () => {
    expect(virtualDelayToRealMs(createWorkspace('Normal'), 12_345)).toBe(12_345);
  });

  it('converts virtual time to real time for the accelerated clock', () => {
    const workspace = createWorkspace('Accelerated');
    workspace.calendarPreferences.testClock = { enabled: true, secondsPerDay: 30, startedAt: '2026-01-01T00:00:00.000Z', virtualAt: '2026-01-01T00:00:00.000Z' };
    expect(virtualDelayToRealMs(workspace, 86_400_000)).toBe(30_000);
  });

  it('returns a cancellation function', () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const cancel = scheduleWorkspaceTime(createWorkspace('Normal'), 1_000, callback);
    cancel();
    vi.advanceTimersByTime(1_000);
    expect(callback).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
