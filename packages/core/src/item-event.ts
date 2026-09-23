import type { UniversalItem } from './types.js';

/** Explicit calendar bounds turn an item into a non-tickable event. */
export function isCalendarItem(item: UniversalItem): boolean {
  return Boolean(item.external || (item.schedule?.startAt && item.schedule?.endAt));
}
export function canManuallyComplete(item: UniversalItem): boolean {
  if (item.isNote || item.external?.readOnly || item.canBeCompleted === false) return false;
  return item.canBeCompleted === true || item.preset === 'task' || (!item.schedule?.allDay && !isCalendarItem(item));
}
