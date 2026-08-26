import type { TestClockPreferences, TestClockUnit, WorkspaceDocument } from './types.js';

const secondsByUnit: Record<TestClockUnit, number> = { seconds: 1, minutes: 60, hours: 3_600 };

export function testDayDurationSeconds(value: number, unit: TestClockUnit): number {
  return Math.max(1, value * secondsByUnit[unit]);
}

export function testClockDisplay(clock: TestClockPreferences | undefined): { value: number; unit: TestClockUnit } {
  if (clock?.dayDurationValue && clock.dayDurationUnit) return { value: clock.dayDurationValue, unit: clock.dayDurationUnit };
  const seconds = Math.max(1, clock?.secondsPerDay ?? 86_400);
  if (seconds % 3_600 === 0) return { value: seconds / 3_600, unit: 'hours' };
  if (seconds % 60 === 0) return { value: seconds / 60, unit: 'minutes' };
  return { value: seconds, unit: 'seconds' };
}

/** Domain clock used by recurrence, filters, reminders and visible app time. */
export function effectiveWorkspaceNow(workspace: WorkspaceDocument, realNow = new Date()): Date {
  const clock = workspace.calendarPreferences.testClock;
  if (!clock?.enabled || !clock.secondsPerDay || !clock.startedAt || !clock.virtualAt) return realNow;
  const elapsed = Math.max(0, realNow.getTime() - new Date(clock.startedAt).getTime());
  return new Date(new Date(clock.virtualAt).getTime() + elapsed * 86_400_000 / (clock.secondsPerDay * 1_000));
}
