import { effectiveItemDurationMs, type UniversalItem } from '@utm/core';
import { mergeIntervals, type Interval, type TimelineEvent } from './timelineLayout';

/** Read-only proposals for the selected day, never schedule mutations. */
export function planUndatedTasks(items: UniversalItem[], events: TimelineEvent[], sleep: Interval[], day: Interval) {
  const tasks = items.filter(item => item.state === 'open' && !item.deletedAt && !item.isNote && item.canBeCompleted !== false
    && item.role !== 'series_template' && !item.schedule?.allDay
    && !item.schedule?.startAt && !item.schedule?.endAt && !item.schedule?.dueAt && !item.schedule?.availableFrom
    && Number.isFinite(effectiveItemDurationMs(item)) && effectiveItemDurationMs(item) > 0)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const clip = (intervals: Interval[]) => mergeIntervals(intervals.map(v => ({ start: Math.max(day.start, v.start), end: Math.min(day.end, v.end) })));
  const busy = clip([...sleep, ...events.filter(event => !event.invalid && (event.travel || event.item.external?.transparency !== 'transparent'))]);
  const calendarFreeMs = day.end - day.start - busy.reduce((sum, v) => sum + v.end - v.start, 0);
  const taskDurationMs = tasks.reduce((sum, item) => sum + effectiveItemDurationMs(item), 0);
  // Morning/overnight sleep ends before the end of this day; evening sleep does
  // not push all proposals past midnight. Without a sleep interval use day start.
  const wake = clip(sleep).find(v => v.end < day.end)?.end ?? day.start;
  const occupied = clip([...sleep, ...events.map(v => ({ start: v.start, end: Math.max(v.end, v.start + 60000) }))]);
  const gaps: Interval[] = [];
  let cursor = wake;
  for (const interval of occupied) {
    if (interval.start > cursor) gaps.push({ start: cursor, end: interval.start });
    cursor = Math.max(cursor, interval.end);
  }
  if (cursor < day.end) gaps.push({ start: cursor, end: day.end });
  const proposals: TimelineEvent[] = [];
  const unplaced: UniversalItem[] = [];
  for (const item of tasks) {
    const duration = effectiveItemDurationMs(item);
    const gap = gaps.find(v => v.end - v.start >= duration);
    if (!gap) { unplaced.push(item); continue; }
    proposals.push({ item, start: gap.start, end: gap.start + duration, point: false, invalid: false, tentative: true });
    gap.start += duration;
  }
  return { proposals, unplaced, calendarFreeMs, taskDurationMs, remainingMs: calendarFreeMs - taskDurationMs };
}
