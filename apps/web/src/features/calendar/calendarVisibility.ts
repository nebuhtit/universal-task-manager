import { calendarDateKey, zonedDateStart, type UniversalItem } from '@utm/core';

export function isCompletelyUndated(item: UniversalItem) {
  const s = item.schedule;
  return !s?.plannedDate && !s?.startAt && !s?.endAt && !s?.dueAt && !s?.availableFrom;
}

export function showUndatedItem(item: UniversalItem, now: Date, zone: string) {
  if (item.deletedAt) return false;
  if (item.state === 'open') return true;
  const at = item.closure?.at;
  return item.state === 'done' && Boolean(at && Number.isFinite(Date.parse(at)) && calendarDateKey(new Date(at), zone) === calendarDateKey(now, zone));
}

/** Additional inclusion only; never moves or edits the original schedule. */
export function showOverdueToday(item: UniversalItem, key: string, now: Date, zone: string, series?: UniversalItem) {
  if (item.deletedAt || item.state !== 'open' || key !== calendarDateKey(now, zone)) return false;
  const due = Date.parse(item.schedule?.dueAt ?? '');
  if (!Number.isFinite(due) || due >= now.getTime()) return false;
  const start = Date.parse(item.schedule?.startAt ?? '');
  const rule = (series ?? item).recurrence;
  const activeRange = rule?.autoRenew && rule.closeAt === 'due' && (!rule.activationOffset || /^PT0[MS]$/.test(rule.activationOffset));
  if (activeRange) {
    const dayStart = zonedDateStart(key, zone).getTime();
    // Due is already before now on this day; an active range must reach this day.
    if (!Number.isFinite(start) || start > due || due < dayStart) return false;
  }
  return true;
}
