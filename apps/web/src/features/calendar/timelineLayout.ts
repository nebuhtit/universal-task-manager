import { durationToMs, effectiveItemDurationMs, zonedDateStart, type UniversalItem } from '@utm/core';

export type Interval = { start: number; end: number };
export type TimelineEvent = Interval & { item: UniversalItem; point: boolean; invalid: boolean; travel?: boolean; travelBack?: boolean; tentative?: boolean; tentativeOverdue?: boolean };
export type Segment = Interval & { top: number; height: number; hidden: boolean };
export type PlacedEvent = TimelineEvent & { top: number; height: number; column: number; columns: number; continuedBefore: boolean; continuedAfter: boolean };
export type MoreBlock = { top: number; height: number; column: number; columns: number; items: UniversalItem[] };
const MINUTE = 60_000;
// Geometry only: one elapsed minute per CSS pixel, including 23/25-hour days.
export const MIN_CARD_HEIGHT = 36;
export const BREAK_HEIGHT = 36;

export function dayBounds(key: string, zone: string): Interval {
  const next = new Date(`${key}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  return { start: zonedDateStart(key, zone).getTime(), end: zonedDateStart(next.toISOString().slice(0, 10), zone).getTime() };
}

export function itemInterval(item: UniversalItem): TimelineEvent | null {
  const schedule = item.schedule;
  const read = (v?: string) => v && Number.isFinite(Date.parse(v)) ? Date.parse(v) : undefined;
  const start = read(schedule?.startAt);
  const end = read(schedule?.endAt);
  const due = read(schedule?.dueAt);
  const duration = effectiveItemDurationMs(item);
  if (start !== undefined && end !== undefined) return { item, start, end: Math.max(start, end), invalid: end < start, point: end <= start };
  if (start !== undefined) return { item, start, end: start + duration, invalid: false, point: duration <= 0 };
  const anchor = end ?? due ?? read(schedule?.availableFrom);
  if (anchor === undefined) return null;
  return { item, start: anchor - duration, end: anchor, invalid: false, point: duration <= 0 };
}

export function intersects(interval: Interval, day: Interval): boolean {
  return interval.start === interval.end ? interval.start >= day.start && interval.start < day.end : interval.start < day.end && interval.end > day.start;
}

export function travelInterval(item: UniversalItem): TimelineEvent | null {
  const end = Date.parse(item.schedule?.startAt ?? '');
  try {
    const duration = durationToMs(item.schedule?.travelDuration ?? 'PT0S');
    return Number.isFinite(end) && Number.isFinite(duration) && duration > 0
      ? { item, start: end - duration, end, point: false, invalid: false, travel: true } : null;
  } catch { return null; }
}

export function returnTravelInterval(item: UniversalItem): TimelineEvent | null {
  const schedule = item.schedule;
  if (!schedule?.endAt && !schedule?.startAt) return null;
  const interval = itemInterval(item);
  if (!interval || interval.invalid || (interval.point && !schedule.endAt)) return null;
  try {
    const duration = durationToMs(schedule.travelBackDuration ?? 'PT0S');
    return Number.isFinite(duration) && duration > 0
      ? { item, start: interval.end, end: interval.end + duration, point: false, invalid: false, travel: true, travelBack: true } : null;
  } catch { return null; }
}

export function mergeIntervals(intervals: Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const interval of [...intervals].filter(v => v.end > v.start).sort((a, b) => a.start - b.start)) {
    const last = result.at(-1);
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else result.push({ ...interval });
  }
  return result;
}

export function hiddenIntervals(sleep: Interval[], occupied: Interval[], day: Interval): Interval[] {
  let hidden = mergeIntervals(sleep.map(v => ({ start: Math.max(day.start, v.start), end: Math.min(day.end, v.end) })));
  for (const event of occupied) {
    // A due-only point still needs a visible minute at its actual anchor.
    const start = event.start, end = Math.max(event.end, start + MINUTE);
    hidden = hidden.flatMap(v => end <= v.start || start >= v.end ? [v] : [
      { start: v.start, end: Math.min(v.end, start) }, { start: Math.max(v.start, end), end: v.end },
    ].filter(part => part.end > part.start));
  }
  return hidden;
}

export function buildSegments(day: Interval, hidden: Interval[]): Segment[] {
  const result: Segment[] = []; let at = day.start; let top = 0;
  const add = (start: number, end: number, isHidden: boolean) => {
    if (end <= start) return;
    const height = isHidden ? BREAK_HEIGHT : (end - start) / MINUTE;
    result.push({ start, end, top, height, hidden: isHidden }); top += height;
  };
  for (const interval of mergeIntervals(hidden)) { add(at, interval.start, false); add(interval.start, interval.end, true); at = interval.end; }
  add(at, day.end, false);
  return result;
}

export function positionAt(at: number, segments: Segment[]): number {
  const segment = segments.find(v => at >= v.start && at < v.end);
  if (segment) return segment.top + (segment.hidden ? 0 : (at - segment.start) / MINUTE);
  return at <= (segments[0]?.start ?? at) ? 0 : (segments.at(-1)?.top ?? 0) + (segments.at(-1)?.height ?? 0);
}

/** Place flexible-range cues only in rows not occupied by real or hidden blocks. */
export function placeActiveRangeCues<T>(items: T[], segments: Segment[], blocked: { top: number; height: number }[], preferredTop = 0): { item: T; top: number; height: number }[] {
  const height = MIN_CARD_HEIGHT;
  const occupied = blocked.map(value => ({ start: value.top, end: value.top + value.height }));
  const result: { item: T; top: number; height: number }[] = [];
  for (const item of items) {
    let chosen: number | undefined;
    for (const earliest of [preferredTop, 0]) {
      for (const segment of segments) {
        if (segment.hidden) continue;
        const end = segment.top + segment.height;
        let top = Math.max(segment.top, earliest);
        for (const interval of mergeIntervals(occupied.filter(value => value.end > top && value.start < end))) {
          if (interval.start - top >= height) break;
          top = Math.max(top, interval.end);
        }
        if (top + height <= end && !occupied.some(value => value.start < top + height && value.end > top)) { chosen = top; break; }
      }
      if (chosen !== undefined) break;
    }
    if (chosen === undefined) continue;
    result.push({ item, top: chosen, height });
    occupied.push({ start: chosen, end: chosen + height });
  }
  return result;
}

export function layoutEvents(events: TimelineEvent[], day: Interval, segments: Segment[], limit: number): { events: PlacedEvent[]; more: MoreBlock[] } {
  const sorted = events.filter(v => intersects(v, day)).sort((a, b) => a.start - b.start || a.end - b.end || a.item.id.localeCompare(b.item.id)).map(event => {
    const top = positionAt(Math.max(day.start, event.start), segments);
    return { ...event, top, height: Math.max(MIN_CARD_HEIGHT, positionAt(Math.min(day.end, event.end), segments) - top), column: 0, columns: 1, continuedBefore: event.start < day.start, continuedAfter: event.end > day.end };
  });
  const output: PlacedEvent[] = []; const more: MoreBlock[] = [];
  let group: PlacedEvent[] = []; let groupEnd = -Infinity;
  const flush = () => {
    if (!group.length) return;
    const ends: number[] = [];
    for (const event of group) {
      let column = ends.findIndex(end => end <= event.top);
      if (column < 0) column = ends.length;
      ends[column] = event.top + event.height; event.column = column;
    }
    const columns = Math.min(limit, ends.length);
    const overflow = group.filter(v => ends.length > limit && v.column >= limit - 1);
    output.push(...group.filter(v => !overflow.includes(v)).map(v => ({ ...v, columns })));
    // Merge only visually touching overflow blocks, not unrelated free gaps.
    for (const event of overflow) {
      const previous = more.at(-1);
      if (previous && previous.columns === columns && event.top < previous.top + previous.height) {
        previous.height = Math.max(previous.height, event.top + event.height - previous.top);
        if (!previous.items.some(item => item.id === event.item.id)) previous.items.push(event.item);
      } else more.push({ top: event.top, height: event.height, column: limit - 1, columns, items: [event.item] });
    }
    group = []; groupEnd = -Infinity;
  };
  for (const event of sorted) { if (event.top >= groupEnd) flush(); group.push(event); groupEnd = Math.max(groupEnd, event.top + event.height); }
  flush(); return { events: output, more };
}
