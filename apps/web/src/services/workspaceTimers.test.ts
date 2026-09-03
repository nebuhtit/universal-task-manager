import { describe, expect, it, vi } from 'vitest';
import { createWorkspace } from '@utm/core';
import { scheduleWorkspaceTime, virtualDelayToRealMs } from './workspaceTimers';

describe('workspace timers', () => {
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
