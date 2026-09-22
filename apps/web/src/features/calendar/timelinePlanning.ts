import { effectiveItemDurationMs, timeCapacity, type UniversalItem } from '@utm/core';
import { mergeIntervals, type Interval, type TimelineEvent } from './timelineLayout';

/** Read-only proposals for the selected day, never schedule mutations. */
export function planUndatedTasks(items: UniversalItem[], events: TimelineEvent[], sleep: Interval[], day: Interval, now?: Date) {
  const tasks = items.filter(item => item.state === 'open' && !item.deletedAt && !item.isNote && item.canBeCompleted !== false
    && item.role !== 'series_template' && !item.schedule?.allDay
    && !item.schedule?.startAt && !item.schedule?.endAt && (!item.schedule?.dueAt || Boolean(item.schedule.plannedDate)) && (!item.schedule?.availableFrom || Boolean(item.schedule.plannedDate))
    && Number.isFinite(effectiveItemDurationMs(item)) && effectiveItemDurationMs(item) > 0)
    .sort((a, b) => (Date.parse(a.schedule?.dueAt ?? '') || Infinity) - (Date.parse(b.schedule?.dueAt ?? '') || Infinity) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const clip = (intervals: Interval[]) => mergeIntervals(intervals.map(v => ({ start: Math.max(day.start, v.start), end: Math.min(day.end, v.end) })));
  const busy = clip([...sleep, ...events.filter(event => !event.invalid && (event.travel || event.item.external?.transparency !== 'transparent'))]);
  const taskDurationMs = tasks.reduce((sum, item) => sum + effectiveItemDurationMs(item), 0);
  const calendarFreeMs = timeCapacity(day, busy).availableMs;
  // Morning/overnight sleep ends before the end of this day; evening sleep does
  // not push all proposals past midnight. Without a sleep interval use day start.
  const wake = clip(sleep).find(v => v.end < day.end)?.end ?? day.start;
  const occupied = busy;
  const gaps: Interval[] = [];
  const current = now?.getTime();
  const planningStart = current !== undefined && current >= day.start && current < day.end ? Math.max(wake, Math.ceil(current / 60000) * 60000) : wake;
  let cursor = planningStart;
  for (const interval of occupied) {
    if (interval.start > cursor) gaps.push({ start: cursor, end: interval.start });
    cursor = Math.max(cursor, interval.end);
  }
  if (cursor < day.end) gaps.push({ start: cursor, end: day.end });
  const proposals: TimelineEvent[] = [];
  const unplaced: UniversalItem[] = [];
  const warnings: Array<{ item: UniversalItem; reason: 'deadline' | 'fragmented' | 'capacity' }> = [];
  for (const item of tasks) {
    const duration = effectiveItemDurationMs(item);
    const due = Date.parse(item.schedule?.dueAt ?? '');
    const earliest = Date.parse(item.schedule?.availableFrom ?? '');
    const startIn = (v: Interval) => Math.max(v.start, Number.isFinite(earliest) ? earliest : v.start);
    const endIn = (v: Interval) => Math.min(v.end, Number.isFinite(due) ? due : v.end);
    const gap = gaps.find(v => endIn(v) - startIn(v) >= duration);
    if (!gap) {
      unplaced.push(item);
      const total = gaps.reduce((sum, v) => sum + Math.max(0, endIn(v) - startIn(v)), 0);
      warnings.push({ item, reason: Number.isFinite(due) && total < duration ? 'deadline' : total >= duration ? 'fragmented' : 'capacity' });
      continue;
    }
    const start = startIn(gap);
    proposals.push({ item, start, end: start + duration, point: false, invalid: false, tentative: true });
    if (start > gap.start) gaps.push({ start: gap.start, end: start });
    gap.start = start + duration;
    gaps.sort((a, b) => a.start - b.start);
  }
  const remainingToday = timeCapacity({ start: planningStart, end: day.end }, busy, taskDurationMs);
  return { proposals, unplaced, warnings, calendarFreeMs, taskDurationMs, remainingMs: timeCapacity(day, busy, taskDurationMs).remainingMs, remainingTodayMs: remainingToday.remainingMs, availableTodayMs: remainingToday.availableMs };
}
