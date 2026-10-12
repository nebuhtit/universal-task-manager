import { viewPeriodBoundsForDates, zonedDateTime, type TimeInterval, type WorkspaceDocument, type WorkspaceLanguage } from '@utm/core';
import type { CalendarProjectionCache } from './calendarProjectionCache';
import { applyTimelinePlanning, prepareTimelineData } from './timelineData';
import { dayBounds } from './timelineLayout';

const DAY_MS = 86_400_000;

export type FreeTimeDay = { date: string; start: number; end: number; intervals: TimeInterval[]; busy: TimeInterval[]; reserved: TimeInterval[]; booked: TimeInterval[] };

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function merge(intervals: TimeInterval[]): TimeInterval[] {
  const sorted = intervals.filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start).sort((a, b) => a.start - b.start);
  const result: TimeInterval[] = [];
  for (const item of sorted) {
    const previous = result.at(-1);
    if (previous && item.start <= previous.end) previous.end = Math.max(previous.end, item.end);
    else result.push({ ...item });
  }
  return result;
}

/** Display the longest waking stretch, normally from the morning sleep end to bedtime. */
function wakingWindow(day: TimeInterval, sleep: TimeInterval[]): TimeInterval {
  const sleeping = merge(sleep.map(interval => ({ start: Math.max(day.start, interval.start), end: Math.min(day.end, interval.end) })));
  if (!sleeping.length) return day;
  const waking: TimeInterval[] = [];
  let cursor = day.start;
  for (const interval of sleeping) {
    if (interval.start > cursor) waking.push({ start: cursor, end: interval.start });
    cursor = Math.max(cursor, interval.end);
  }
  if (cursor < day.end) waking.push({ start: cursor, end: day.end });
  return waking.sort((left, right) => (right.end - right.start) - (left.end - left.start) || left.start - right.start)[0] ?? { start: day.start, end: day.start };
}

export function freeTimeScaleMarks(day: FreeTimeDay, timeZone: string): Array<{ at: number; label: string }> {
  if (day.end <= day.start) return [];
  const label = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const marks = [{ at: day.start, label: label.format(new Date(day.start)) }];
  for (let hour = 0; hour <= 24; hour++) {
    const at = hour === 24 ? zonedDateTime(shiftDate(day.date, 1), 0, 0, timeZone).getTime() : zonedDateTime(day.date, hour, 0, timeZone).getTime();
    if (at > day.start && at < day.end && !marks.some(mark => mark.at === at)) marks.push({ at, label: `${String(hour).padStart(2, '0')}:00` });
  }
  if (!marks.some(mark => mark.at === day.end)) marks.push({ at: day.end, label: day.end === zonedDateTime(shiftDate(day.date, 1), 0, 0, timeZone).getTime() ? '24:00' : label.format(new Date(day.end)) });
  return marks.sort((left, right) => left.at - right.at);
}

/** Availability is deliberately calculated from all scheduled items, not the current view filter. */
export function freeTimeForRange(workspace: WorkspaceDocument, startDate: string, endDate: string, bufferMinutes: number, now: Date, projectionCache?: CalendarProjectionCache, visibleStart = '00:00', visibleEnd = '24:00'): FreeTimeDay[] {
  const parseClock = (value: string) => {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match) return null;
    const hour = Number(match[1]), minute = Number(match[2]);
    return hour <= 24 && minute <= 59 && (hour < 24 || minute === 0) ? hour * 60 + minute : null;
  };
  const startMinute = parseClock(visibleStart), endMinute = parseClock(visibleEnd);
  if (startMinute === null || endMinute === null || endMinute <= startMinute || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) return [];
  const dayCount = Math.floor((Date.parse(`${endDate}T12:00:00Z`) - Date.parse(`${startDate}T12:00:00Z`)) / DAY_MS) + 1;
  if (dayCount > 31) return [];

  const availabilityWorkspace: WorkspaceDocument = {
    ...workspace,
    calendarPreferences: {
      ...workspace.calendarPreferences,
      dayView: {
        ...workspace.calendarPreferences.dayView,
        filter: { source: 'state == "open" || state == "done"' },
        scheduleSources: ['event_open', 'event', 'active', 'due'],
      },
    },
  };
  const buffer = Math.max(0, Math.min(240, Number.isFinite(bufferMinutes) ? bufferMinutes : 30)) * 60_000;
  const sleepId = workspace.calendarPreferences.timeline?.sleepItemId;
  const reservedIds = new Set(workspace.calendarPreferences.dayView.statistics?.reservedItemIds ?? []);
  const isReserved = (item: { id: string; occurrence?: { seriesId: string } }) => reservedIds.has(item.id) || Boolean(item.occurrence && reservedIds.has(item.occurrence.seriesId));
  const isSelectedSleep = (item: { id: string; occurrence?: { seriesId: string } }) => Boolean(sleepId)
    && (item.id === sleepId || item.occurrence?.seriesId === sleepId);
  const result: FreeTimeDay[] = [];
  for (let date = startDate; date <= endDate; date = shiftDate(date, 1)) {
    const day = dayBounds(date, workspace.calendarPreferences.timezone);
    const period = viewPeriodBoundsForDates(date, date, workspace.calendarPreferences.timezone);
    const prepared = prepareTimelineData(availabilityWorkspace, date, now, projectionCache);
    const waking = sleepId ? wakingWindow(day, prepared.sleep) : day;
    const window = {
      start: Math.max(waking.start, zonedDateTime(date, Math.floor(startMinute / 60), startMinute % 60, workspace.calendarPreferences.timezone).getTime()),
      end: Math.min(waking.end, endMinute === 1440 ? day.end : zonedDateTime(date, Math.floor(endMinute / 60), endMinute % 60, workspace.calendarPreferences.timezone).getTime()),
    };
    const start = Math.max(window.start, now.getTime() < day.end ? now.getTime() : window.start);
    const planned = applyTimelinePlanning(prepared, now);
    const scheduled = [
      ...prepared.events.filter(event => !isSelectedSleep(event.item) && !event.invalid && !event.point && (event.travel || event.item.external?.transparency !== 'transparent')),
      // Unscheduled/overdue suggestions are not bookings. Only tasks explicitly
      // assigned to this day contribute their proposed placement to availability.
      ...planned.planning.proposals.filter(({ item, tentativeOverdue }) => !isSelectedSleep(item) && Boolean(item.schedule?.plannedDate) && !tentativeOverdue),
      ...prepared.allDay.filter(item => !isSelectedSleep(item) && item.external?.transparency !== 'transparent').map(item => ({ item, start: period.start.getTime(), end: period.endExclusive.getTime() })),
    ];
    const clip = (entries: typeof scheduled) => merge(entries.map(interval => ({ start: Math.max(window.start, interval.start - buffer), end: Math.min(window.end, interval.end + buffer) })));
    const reserved = clip(scheduled.filter(event => isReserved(event.item)));
    const booked = clip(scheduled.filter(event => !isReserved(event.item)));
    // Preserve the complete day's bookings in the image; only text availability
    // begins at the current time when exporting today.
    const occupied = merge([...reserved, ...booked]);
    const free: TimeInterval[] = [];
    let cursor = start;
    for (const interval of occupied) {
      if (interval.start > cursor) free.push({ start: cursor, end: interval.start });
      cursor = Math.max(cursor, interval.end);
    }
    if (cursor < window.end) free.push({ start: cursor, end: window.end });
    result.push({ date, start: window.start, end: window.end, intervals: free, busy: occupied, reserved, booked });
  }
  return result;
}

const sharePhrases: Record<WorkspaceLanguage, { title: string; noSlots: string }> = {
  en: { title: 'Available time', noSlots: 'no free slots' },
  ru: { title: 'Свободное время', noSlots: 'нет свободных окон' },
  es: { title: 'Tiempo disponible', noSlots: 'sin horarios libres' },
  de: { title: 'Freie Zeiten', noSlots: 'keine freien Zeitfenster' },
  fr: { title: 'Créneaux disponibles', noSlots: 'aucun créneau libre' },
  ko: { title: '가능한 시간', noSlots: '가능한 시간이 없습니다' },
};

export function freeTimeShareTitle(language: WorkspaceLanguage): string { return sharePhrases[language].title; }

export function freeTimeShareText(days: FreeTimeDay[], language: WorkspaceLanguage, timeZone: string): string {
  const dateFormatter = new Intl.DateTimeFormat(language, { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
  const timeFormatter = new Intl.DateTimeFormat(language, { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const { title, noSlots } = sharePhrases[language];
  const rows = days.map(day => {
    const dateLabel = dateFormatter.format(new Date(`${day.date}T12:00:00Z`));
    const periods = day.intervals.map(interval => `${timeFormatter.format(new Date(interval.start))}–${timeFormatter.format(new Date(interval.end))}`);
    return `${dateLabel}: ${periods.length ? periods.join(', ') : noSlots}`;
  });
  return [title, ...rows].join('\n');
}
