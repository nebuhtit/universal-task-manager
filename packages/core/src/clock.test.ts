import { describe, expect, it } from 'vitest';
import { createWorkspace, effectiveWorkspaceNow, testClockDisplay, testDayDurationSeconds } from './index.js';

describe('accelerated workspace clock', () => {
  it('converts Settings units to canonical seconds', () => {
    expect(testDayDurationSeconds(30, 'seconds')).toBe(30);
    expect(testDayDurationSeconds(2, 'minutes')).toBe(120);
    expect(testDayDurationSeconds(1.5, 'hours')).toBe(5_400);
  });

  it('advances every system day at the configured real-time speed', () => {
    const workspace = createWorkspace('Clock', new Date('2026-08-26T00:00:00.000Z'));
    workspace.calendarPreferences.testClock = { enabled: true, secondsPerDay: 30, dayDurationValue: 30, dayDurationUnit: 'seconds', startedAt: '2026-08-26T00:00:00.000Z', virtualAt: '2026-08-26T12:00:00.000Z' };
    expect(effectiveWorkspaceNow(workspace, new Date('2026-08-26T00:00:30.000Z')).toISOString()).toBe('2026-08-27T12:00:00.000Z');
    expect(testClockDisplay(workspace.calendarPreferences.testClock)).toEqual({ value: 30, unit: 'seconds' });
  });
});
