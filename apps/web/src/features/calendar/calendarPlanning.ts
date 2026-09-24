import {
  calendarDateKey, createOccurrence, effectiveItemDurationMs, googleCalendarProjection, itemDeletionTime,
  occupiedIntervals, viewPeriodBoundsForDates, zonedDateTime,
  type CalendarPin, type CalendarSourceReference, type UniversalItem, type WorkspaceDocument,
} from '@utm/core';
import { dayBounds, intersects, itemInterval, mergeIntervals, type Interval, type TimelineEvent } from './timelineLayout';
import type { prepareTimelineData } from './timelineData';
import { calendarDayView } from './calendarEvaluation';
import { sortViewItems } from '../views/viewSelectors';

export const planningEnabled = (workspace: WorkspaceDocument) => workspace.calendarPreferences.planning?.enabled !== false;
export const hasFixedEventInterval = (item: UniversalItem) => Boolean(item.schedule?.startAt && item.schedule?.endAt);
export const sourceReference = (item: UniversalItem): CalendarSourceReference => ({ itemId: item.id, ...(item.occurrence ? { seriesId: item.occurrence.seriesId, recurrenceId: item.occurrence.recurrenceId } : {}) });
export const referenceKey = (ref: CalendarSourceReference) => ref.seriesId && ref.recurrenceId ? `${ref.seriesId}@${ref.recurrenceId}` : ref.itemId;

/** Resolution is read-only: a virtual occurrence is never inserted into items. */
export function resolveCalendarSource(workspace: WorkspaceDocument, ref: CalendarSourceReference): UniversalItem | null {
  if (ref.seriesId && workspace.items[ref.seriesId] && itemDeletionTime(workspace, workspace.items[ref.seriesId]!)) return null;
  let item = workspace.items[ref.itemId];
  if (!item && ref.seriesId && ref.recurrenceId) {
    const series = workspace.items[ref.seriesId];
    if (!series || itemDeletionTime(workspace, series) || (series.cycleHistory ?? []).some(entry => entry.recurrenceId === ref.recurrenceId)
      || (series.completionEntries ?? []).some(entry => entry.recurrenceId === ref.recurrenceId && !entry.revokedAt)
      || series.recurrence?.exdates?.includes(ref.recurrenceId)) return null;
    try { item = createOccurrence(series, new Date(ref.recurrenceId), 0); } catch { return null; }
    if (item.id !== ref.itemId) return null;
  }
  return item && !itemDeletionTime(workspace, item) ? item : null;
}

export function activeCalendarPins(workspace: WorkspaceDocument, day: string, now: Date) {
  if (!planningEnabled(workspace) || day < calendarDateKey(now, workspace.calendarPreferences.timezone)) return [];
  return Object.values(workspace.calendarPreferences.planning?.pins ?? {}).flatMap(pin => {
    if (pin.day !== day) return [];
    const item = resolveCalendarSource(workspace, pin);
    return item && item.state === 'open' ? [{ pin, item }] : [];
  });
}

/** Preferences-only mutations: callers must not save/normalize the source item. */
export function setCalendarPin(workspace: WorkspaceDocument, pin: CalendarPin) {
  workspace.calendarPreferences.planning ??= {};
  workspace.calendarPreferences.planning.pins ??= {};
  workspace.calendarPreferences.planning.pins[referenceKey(pin)] = { ...pin };
}
export function removeCalendarPin(workspace: WorkspaceDocument, ref: CalendarSourceReference) {
  const pins = workspace.calendarPreferences.planning?.pins;
  if (pins) delete pins[referenceKey(ref)];
}

export function sameTimeInterval(item: UniversalItem, day: string, zone: string): TimelineEvent | null {
  const original = itemInterval(googleCalendarProjection(item));
  if (!original || original.invalid || !item.schedule?.startAt) return null;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(original.start);
  const hour = Number(parts.find(part => part.type === 'hour')?.value), minute = Number(parts.find(part => part.type === 'minute')?.value);
  const start = +zonedDateTime(day, hour, minute, zone);
  return { ...original, item, start, end: start + original.end - original.start };
}

export function dueBoundary(item: UniversalItem, zone: string): number {
  const due = item.schedule?.dueAt;
  if (!due) return Infinity;
  if (item.schedule?.dueDateOnly) return dayBounds(calendarDateKey(new Date(due), zone), zone).end;
  return Date.parse(due) || Infinity;
}

type Prepared = ReturnType<typeof prepareTimelineData>;
/** Minute ticks affect today's queue, not every other visible day. */
export function createCalendarPlanCache() {
  const values = new Map<string, { workspace: WorkspaceDocument; prepared: Prepared; reserved: UniversalItem[]; stamp: string; value: ReturnType<typeof buildCalendarPlan> }>();
  return (workspace: WorkspaceDocument, key: string, prepared: Prepared, now: Date, reserved: UniversalItem[]) => {
    const today = calendarDateKey(now, workspace.calendarPreferences.timezone);
    const pinBoundaries = activeCalendarPins(workspace, key, now).map(({ item }) => dueBoundary(item, workspace.calendarPreferences.timezone) <= +now).join(',');
    const stamp = `${today}:${key === today ? Math.floor(+now / 60_000) : pinBoundaries}`;
    const prior = values.get(key);
    if (prior && prior.workspace === workspace && prior.prepared === prepared && prior.reserved === reserved && prior.stamp === stamp) return prior.value;
    const value = buildCalendarPlan(workspace, key, prepared, now, reserved);
    if (values.size >= 62 && !values.has(key)) values.delete(values.keys().next().value!);
    values.set(key, { workspace, prepared, reserved, stamp, value }); return value;
  };
}

export function naturallyOnDay(item: UniversalItem, prepared: Prepared, day: string) {
  return prepared.events.some(event => event.item.id === item.id) || [...prepared.allDay, ...prepared.activeRange, ...prepared.dateOnlyTasks].some(value => value.id === item.id)
    || item.schedule?.plannedDate === day;
}

export function planningReservations(workspace: WorkspaceDocument, key: string, prepared: Prepared, reserved: UniversalItem[]): Interval[] {
  const period = viewPeriodBoundsForDates(key, key, workspace.calendarPreferences.timezone);
  const visibleIds = new Set([...prepared.events.map(event => event.item), ...prepared.undated, ...prepared.overdue, ...prepared.dateOnlyTasks, ...prepared.allDay, ...prepared.activeRange].map(item => item.id));
  return [...prepared.sleep, ...prepared.allDay.filter(item => item.state === 'open' && item.external?.transparency !== 'transparent').flatMap(item => occupiedIntervals(item, period)), ...reserved.filter(item => !visibleIds.has(item.id) && item.state === 'open' && item.external?.transparency !== 'transparent').flatMap(item => occupiedIntervals(item, period))];
}

/** Shared, pure List/Timeline plan. Source objects and schedules are never patched. */
export function buildCalendarPlan(workspace: WorkspaceDocument, key: string, prepared: Prepared, now: Date, reserved: UniversalItem[] = [], orderOverride?: string[]) {
  const zone = workspace.calendarPreferences.timezone, day = prepared.day;
  const reservations = planningReservations(workspace, key, prepared, reserved);
  const pins = new Map<string, CalendarPin>();
  const tasks = new Map<string, UniversalItem>();
  const anchors: TimelineEvent[] = [];
  const visibleAnchors: TimelineEvent[] = [];
  for (const event of prepared.events) {
    if (!event.travel && !hasFixedEventInterval(event.item) && !event.item.schedule?.allDay && event.item.state === 'open') tasks.set(event.item.id, event.item);
    else { anchors.push(event); if (prepared.visible.includes(event)) visibleAnchors.push(event); }
  }
  for (const item of [...prepared.undated, ...prepared.dateOnlyTasks, ...(prepared.showOverdue ? prepared.overdue : [])]) {
    if (!item.schedule?.startAt && !item.schedule?.endAt && item.state === 'open' && !item.isNote && !item.schedule?.allDay) tasks.set(item.id, item);
  }
  const warnings: Array<{ item: UniversalItem; reason: string }> = [];
  for (const { pin, item } of activeCalendarPins(workspace, key, now)) {
    if (naturallyOnDay(item, prepared, key)) continue;
    pins.set(item.id, pin);
    if (pin.mode === 'queue') tasks.set(item.id, item);
    else {
      const interval = sameTimeInterval(item, key, zone);
      const blocked = [...reservations, ...anchors.filter(event => event.item.external?.transparency !== 'transparent' || event.travel)];
      const due = dueBoundary(item, zone);
      if (interval && due > +now && interval.end > due) warnings.push({ item, reason: 'deadline' });
      else if (!interval || interval.end > day.end || blocked.some(busy => intersects(busy, interval))) warnings.push({ item, reason: 'conflict' });
      else { anchors.push(interval); visibleAnchors.push(interval); }
    }
  }
  // A fixed anchor appears once in ordering; its travel blocks still reserve time.
  const fixed = new Map(anchors.filter(event => !event.travel).map(event => [event.item.id, event]));
  const all = new Map([...fixed.values()].map(event => [event.item.id, event.item]));
  for (const item of tasks.values()) all.set(item.id, item);
  for (const item of [...prepared.allDay, ...prepared.activeRange]) all.set(item.id, item);
  for (const warning of warnings) all.set(warning.item.id, warning.item);
  const baseIds = sortViewItems(workspace, calendarDayView(key, workspace.calendarPreferences.dayView), [...all.values()], now).map(item => item.id);
  const savedOrder = orderOverride ?? workspace.calendarPreferences.planning?.orders?.[key];
  const ids = [...new Set([...(savedOrder ?? []).filter(id => all.has(id)), ...baseIds])];
  const busy = mergeIntervals([...reservations, ...anchors.filter(event => !event.invalid && (event.travel || event.item.external?.transparency !== 'transparent'))].map(v => ({ start: Math.max(day.start, v.start), end: Math.min(day.end, v.end) })));
  const gaps: Interval[] = [];
  let cursor = now.getTime() >= day.start && now.getTime() < day.end ? Math.ceil(+now / 60_000) * 60_000 : day.start;
  for (const interval of busy) { if (interval.start > cursor) gaps.push({ start: cursor, end: interval.start }); cursor = Math.max(cursor, interval.end); }
  if (cursor < day.end) gaps.push({ start: cursor, end: day.end });
  const proposals: TimelineEvent[] = [];
  let lowerBound = day.start;
  for (let index = 0; index < ids.length; index++) {
    const id = ids[index]!, anchor = fixed.get(id);
    if (anchor) {
      if (savedOrder) lowerBound = Math.max(lowerBound, anchor.end, ...anchors.filter(event => event.item.id === id && event.travelBack).map(event => event.end));
      continue;
    }
    const item = tasks.get(id);
    if (!item) continue;
    const duration = effectiveItemDurationMs(item), due = dueBoundary(item, zone), overdue = due <= +now;
    // A reference uses the source estimate but never its old event dates.
    const earliest = pins.has(id) ? lowerBound : Math.max(lowerBound, Date.parse(item.schedule?.availableFrom ?? '') || day.start);
    const nextAnchor = savedOrder ? ids.slice(index + 1).map(next => fixed.get(next)).find(Boolean) : undefined;
    const latest = Math.min(overdue ? day.end : due, nextAnchor?.start ?? day.end);
    // With no manual order, keep a due-only block close to its deadline when possible.
    const preferred = !savedOrder && Number.isFinite(due) && !overdue && !pins.has(id) ? due - duration : earliest;
    const fits = (gap: Interval, from: number) => Math.max(gap.start, from, earliest) + duration <= Math.min(gap.end, latest);
    const preferredGap = gaps.find(gap => fits(gap, preferred));
    const gap = preferredGap ?? gaps.find(gap => fits(gap, earliest));
    if (!gap || !Number.isFinite(duration) || duration <= 0) { warnings.push({ item, reason: duration <= 0 ? 'duration' : !overdue && due < day.end ? 'deadline' : 'capacity' }); continue; }
    const start = Math.max(gap.start, earliest, preferredGap ? preferred : earliest), end = start + duration;
    proposals.push({ item, start, end, invalid: false, point: false, tentative: true, ...(overdue ? { tentativeOverdue: true } : {}) });
    if (start > gap.start) gaps.push({ start: gap.start, end: start });
    gap.start = end; gaps.sort((a, b) => a.start - b.start);
    if (savedOrder) lowerBound = end;
  }
  return { ids, items: ids.map(id => all.get(id)!), pins, fixed, proposals, events: [...visibleAnchors, ...proposals], warnings, reservations, busy,
    movable: new Set(tasks.keys()), unplaced: warnings.map(warning => warning.item) };
}

export function validateCalendarMove(plan: ReturnType<typeof buildCalendarPlan>, movedId: string, now: Date, zone: string, allowFixed = false): string | null {
  if (allowFixed && plan.fixed.has(movedId)) return null; // List order never moves this interval.
  if (!plan.movable.has(movedId)) return 'fixed';
  const item = plan.items.find(value => value.id === movedId)!;
  const due = dueBoundary(item, zone);
  if (due > +now && plan.ids.slice(0, plan.ids.indexOf(movedId)).some(id => (plan.fixed.get(id)?.start ?? -Infinity) >= due)) return 'deadline';
  return plan.warnings.find(warning => warning.item.id === movedId)?.reason ?? null;
}

/** Isolated statistics inputs, never passed to editing, persistence or synchronization. */
export function calendarPlanMetricItems(plan: ReturnType<typeof buildCalendarPlan>, originals: UniversalItem[]) {
  const items = new Map(originals.map(item => [item.id, item]));
  for (const item of plan.items) items.set(item.id, item);
  for (const event of plan.events) {
    if (event.travel || (!event.tentative && !plan.pins.has(event.item.id))) continue;
    const { external: _external, ...source } = event.item;
    items.set(source.id, { ...source, schedule: { timezone: source.schedule?.timezone ?? 'UTC', startAt: new Date(event.start).toISOString(), endAt: new Date(event.end).toISOString(), estimatedDuration: source.schedule?.estimatedDuration ?? 'PT0S' } });
  }
  for (const item of plan.unplaced) {
    const { external: _external, ...source } = item;
    items.set(source.id, { ...source, schedule: { timezone: source.schedule?.timezone ?? 'UTC', estimatedDuration: source.schedule?.estimatedDuration ?? 'PT0S' } });
  }
  return [...items.values()];
}

export const planningReason = (reason: string, ru: boolean) => ({
  conflict: ru ? 'Это время занято событием, дорогой или скрытым резервом. Можно поставить в очередь.' : 'This time overlaps an event, travel or hidden reserve. Choose queue instead.',
  deadline: ru ? 'Размещение не помещается до Due.' : 'Placement does not fit before Due.',
  capacity: ru ? 'Нет свободного непрерывного окна. Item остаётся вне расписания.' : 'No continuous free slot. The item remains outside the schedule.',
  duration: ru ? 'Укажите Duration в исходном item.' : 'Set Duration on the source item.',
  fixed: ru ? 'Событие с Event opens и Event ends фиксировано на Timeline.' : 'An event with Event opens and Event ends is fixed on Timeline.',
}[reason] ?? reason);
