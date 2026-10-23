import { activeRangeBounds, durationToMs, effectiveItemDurationMs, seriesReferenceAncestors, seriesReferenceOwner, withinTargetsFor, zonedDateStart, type UniversalItem, type WorkspaceDocument } from '@utm/core';

export type Interval = { start: number; end: number };
export type TimelineEvent = Interval & { item: UniversalItem; point: boolean; invalid: boolean; travel?: boolean; travelBack?: boolean; tentative?: boolean; tentativeOverdue?: boolean };
export type Segment = Interval & { top: number; height: number; hidden: boolean };
export type PlacedEvent = TimelineEvent & { top: number; height: number; column: number; columns: number; continuedBefore: boolean; continuedAfter: boolean; flexibleVisual?: boolean; withinParent?: string; withinContainer?: boolean };
export type MoreBlock = { top: number; height: number; column: number; columns: number; items: UniversalItem[]; withinParent?: string };
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

export function layoutEvents(events: TimelineEvent[], day: Interval, segments: Segment[], limit: number, flexibleIds: ReadonlySet<string> = new Set(), stackSequentialIds: ReadonlySet<string> = new Set()): { events: PlacedEvent[]; more: MoreBlock[] } {
  const sorted: PlacedEvent[] = events.filter(v => intersects(v, day)).sort((a, b) => a.start - b.start || a.end - b.end || a.item.id.localeCompare(b.item.id)).map(event => {
    const top = positionAt(Math.max(day.start, event.start), segments);
    return { ...event, top, height: Math.max(MIN_CARD_HEIGHT, positionAt(Math.min(day.end, event.end), segments) - top), column: 0, columns: 1, continuedBefore: event.start < day.start, continuedAfter: event.end > day.end };
  });
  // Flexible tasks use compact rows, not collision columns. This changes only
  // presentation: their source schedules and planner intervals stay untouched.
  const flexible = sorted.filter(event => flexibleIds.has(event.item.id) && !event.travel);
  const blocked = sorted.filter(event => !flexible.includes(event)).map(event => ({ top: event.top, height: event.height }));
  for (const event of flexible) {
    const range = activeRangeBounds(event.item);
    const from = Math.max(day.start, range?.start ?? (Date.parse(event.item.schedule?.availableFrom ?? '') || day.start));
    const until = Math.min(day.end, range?.end ?? day.end);
    const allowed = segments.filter(segment => !segment.hidden).flatMap(segment => {
      const start = Math.max(segment.start, from), end = Math.min(segment.end, until);
      return end > start ? [{ start, end, hidden: false, top: positionAt(start, segments), height: (end - start) / MINUTE }] : [];
    });
    const cue = placeActiveRangeCues([event.item], allowed, blocked, event.top)[0];
    if (cue) { event.top = cue.top; event.height = cue.height; event.flexibleVisual = true; }
    blocked.push({ top: event.top, height: event.height });
  }
  // Minimum-height cards for consecutive ten-minute tasks must not turn into
  // fake simultaneous events. Fixed appointments retain their time geometry.
  for (let index = 0; index < sorted.length; index++) {
    const event = sorted[index]!;
    if (!stackSequentialIds.has(event.item.id)) continue;
    const top = event.top;
    for (const previous of sorted.slice(0, index)) if (previous.end <= event.start) event.top = Math.max(event.top, previous.top + previous.height);
    if (event.top !== top) event.flexibleVisual = true;
  }
  sorted.sort((a, b) => a.top - b.top || a.end - b.end || a.item.id.localeCompare(b.item.id));
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

/** Related tasks occupy their block's column, not a competing collision column.
 * Ownership follows proven series lineage, never an item's display name.
 * Only geometry changes here; the actual task/deadline intervals stay intact. */
export function layoutWithinEvents(workspace: WorkspaceDocument, events: TimelineEvent[], day: Interval, segments: Segment[], limit: number, flexibleIds: ReadonlySet<string> = new Set()): ReturnType<typeof layoutEvents> {
  const visible = events.filter(event => intersects(event, day));
  const children = new Map<TimelineEvent, TimelineEvent[]>();
  const parents = new Map<TimelineEvent, TimelineEvent>();
  const containers = new Map<string, TimelineEvent[]>();
  for (const event of visible) {
    if (event.travel) continue;
    const height = positionAt(Math.min(day.end, event.end), segments) - positionAt(Math.max(day.start, event.start), segments);
    if (height < MIN_CARD_HEIGHT * 2) continue;
    const owner = seriesReferenceAncestors(workspace, seriesReferenceOwner(workspace, event.item.occurrence?.seriesId ?? event.item.id)).at(-1)!;
    containers.set(owner, [...(containers.get(owner) ?? []), event]);
  }
  for (const child of visible) {
    if (child.travel) continue;
    const targets = withinTargetsFor(workspace, child.item);
    if (!targets.length) continue;
    const parent = targets.flatMap(target => containers.get(target) ?? []).filter(candidate => {
      if (candidate === child || candidate.travel || candidate.start > child.start || candidate.end < child.end || candidate.end - candidate.start <= child.end - child.start) return false;
      return true;
    }).sort((a, b) => (a.end - a.start) - (b.end - b.start) || a.item.id.localeCompare(b.item.id))[0];
    if (parent) { parents.set(child, parent); children.set(parent, [...(children.get(parent) ?? []), child]); }
  }
  const result = layoutEvents(visible.filter(event => !parents.has(event)), day, segments, limit, flexibleIds);
  const nest = (parent: PlacedEvent, source: TimelineEvent) => {
    const nested = children.get(source);
    if (!nested?.length) return;
    parent.withinContainer = true;
    const compact = new Set(nested.filter(event => {
      const source = workspace.items[event.item.id];
      return source && !source.schedule?.endAt && !source.external?.startAt && !source.external?.endAt;
    }).map(event => event.item.id));
    const rows = layoutEvents(nested, day, segments, limit, new Set(), compact);
    const firstTop = Math.min(...rows.events.map(row => row.top), ...rows.more.map(row => row.top));
    const shift = Math.max(0, parent.top + MIN_CARD_HEIGHT - firstTop);
    const bottom = parent.top + parent.height;
    const needsOverflow = rows.more.length > 0 || rows.events.some(row => row.top + shift + row.height > bottom);
    const contentBottom = bottom - (needsOverflow ? MIN_CARD_HEIGHT : 0);
    const overflow: UniversalItem[] = [];
    const compose = <T extends { top: number; column: number; columns: number }>(row: T) => ({ ...row, top: row.top + shift, column: parent.column * row.columns + row.column, columns: parent.columns * row.columns, withinParent: parent.item.id });
    for (const row of rows.events) {
      const placed = compose(row);
      if (shift && compact.has(row.item.id)) placed.flexibleVisual = true;
      if (placed.top + placed.height > contentBottom) { overflow.push(row.item); continue; }
      result.events.push(placed);
      nest(placed, nested.find(event => event.item === row.item)!);
    }
    for (const row of rows.more) overflow.push(...row.items);
    if (overflow.length) {
      // Keep the overflow control inside the parent without covering a task.
      const top = bottom - MIN_CARD_HEIGHT;
      result.more.push({ top, height: MIN_CARD_HEIGHT, column: parent.column, columns: parent.columns, withinParent: parent.item.id, items: [...new Map(overflow.map(item => [item.id, item])).values()] });
    }
  };
  for (const parent of [...result.events]) {
    const source = visible.find(event => event.item === parent.item && Boolean(event.travel) === Boolean(parent.travel));
    if (source) nest(parent, source);
  }
  return result;
}
