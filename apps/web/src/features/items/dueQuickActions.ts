import { calendarDateKey, shiftCalendarDateKey, type UniversalItem } from '@utm/core';

export type DueQuickOptionId = 'today-13' | 'today-19' | 'today-23' | 'tomorrow' | 'next-week' | 'next-monday';
export type DueQuickOption = { id: DueQuickOptionId; at: string; disabled: boolean };

export function itemTimeZone(item: UniversalItem): string {
  const zone = item.schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  try { new Intl.DateTimeFormat('en', { timeZone: zone }); return zone; }
  catch { return Intl.DateTimeFormat().resolvedOptions().timeZone; }
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const value = (part: string) => Number(parts.find((entry) => entry.type === part)?.value ?? 0);
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute'), second: value('second') };
}

/** Convert a wall-clock selection in the item's zone to an instant. A spring-forward gap is invalid. */
export function dueWallTimeToIso(dateKey: string, hour: number, minute: number, timeZone: string): string | undefined {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day || !Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
  const wallUtc = Date.UTC(year, month - 1, day, hour, minute);
  const candidates = [wallUtc - 14 * 3_600_000, wallUtc + 14 * 3_600_000];
  for (let index = 0; index < 3; index += 1) {
    const probe = candidates[index] ?? wallUtc;
    const current = zonedParts(new Date(probe), timeZone);
    const difference = wallUtc - Date.UTC(current.year, current.month - 1, current.day, current.hour, current.minute, current.second);
    candidates.push(probe + difference);
  }
  const matching = candidates.filter((candidate) => { const value = zonedParts(new Date(candidate), timeZone); return value.year === year && value.month === month && value.day === day && value.hour === hour && value.minute === minute; });
  if (!matching.length) return undefined;
  return new Date(Math.min(...matching)).toISOString();
}

export function dueWallInput(value: string, timeZone: string): string {
  const parts = zonedParts(new Date(value), timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

export function dueWallInputToIso(input: string, timeZone: string): string | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(input);
  return match ? dueWallTimeToIso(match[1]!, Number(match[2]), Number(match[3]), timeZone) : undefined;
}

export function dueQuickOptions(item: UniversalItem, now: Date): DueQuickOption[] {
  const timeZone = itemTimeZone(item);
  const today = calendarDateKey(now, timeZone);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const mondayOffset = ((8 - weekday) % 7) || 7;
  const choices: [DueQuickOptionId, string, number][] = [
    ['today-13', today, 13], ['today-19', today, 19], ['today-23', today, 23],
    ['tomorrow', shiftCalendarDateKey(today, 1), 9],
    ['next-week', shiftCalendarDateKey(today, 7), 9],
    ['next-monday', shiftCalendarDateKey(today, mondayOffset), 9],
  ];
  const opensAt = item.schedule?.startAt ? Date.parse(item.schedule.startAt) : Number.NaN;
  return choices.flatMap(([id, day, hour]) => {
    const at = dueWallTimeToIso(day, hour, 0, timeZone);
    if (!at || (id.startsWith('today') && Date.parse(at) <= now.getTime())) return [];
    return [{ id, at, disabled: Number.isFinite(opensAt) && Date.parse(at) < opensAt }];
  });
}

export function canQuickChangeDue(item: UniversalItem): boolean {
  return !item.deletedAt && !item.external?.readOnly && item.role !== 'series_template';
}
