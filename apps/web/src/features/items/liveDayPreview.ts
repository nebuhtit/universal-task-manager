import { activeRangeDailyDuration, occupiedIntervals, viewPeriodBoundsForDates, type WorkspaceDocument } from '@utm/core';
import { createCalendarEvaluator } from '../calendar/calendarEvaluation';
import { timelineData } from '../calendar/timelineData';

/** Per-input cache; immutable snapshots only. No changes to saved items. */
export function createLiveDayPreview() {
  const calendar = createCalendarEvaluator();
  return {
    counters: calendar.projections.counters,
    evaluate(workspace: WorkspaceDocument, key: string, now: Date) {
      const data = timelineData(workspace, key, now, calendar.projections);
      const nextDay = new Date(`${key}T12:00:00Z`);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      const day = calendar.evaluate(workspace, key, nextDay.toISOString().slice(0, 10), workspace.calendarPreferences.dayView, now).days[key]!;
      const period = viewPeriodBoundsForDates(key, key, workspace.calendarPreferences.timezone);
      const reserves = day.reservedItems.flatMap(item => activeRangeDailyDuration(item, period) !== null ? [] : occupiedIntervals(item, period))
        .map(interval => ({ start: Math.max(interval.start, data.day.start), end: Math.min(interval.end, data.day.end) }))
        .filter(interval => interval.end > interval.start);
      return { ...data, reserves };
    },
  };
}
