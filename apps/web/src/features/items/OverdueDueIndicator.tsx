import type { UniversalItem } from '@utm/core';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
export type OverdueAge = { value: number; unit: 'hour' | 'day' };

export function overdueAgeWithoutActiveRange(item: UniversalItem, now: Date): OverdueAge | null {
  if (item.state !== 'open' || !item.schedule?.dueAt) return null;
  const due = Date.parse(item.schedule.dueAt);
  const start = item.schedule.startAt ? Date.parse(item.schedule.startAt) : Number.NaN;
  if (!Number.isFinite(due) || due >= now.getTime() || Number.isFinite(start)) return null;
  const elapsed = now.getTime() - due;
  return elapsed < DAY_MS
    ? { value: Math.max(1, Math.floor(elapsed / HOUR_MS)), unit: 'hour' }
    : { value: Math.floor(elapsed / DAY_MS), unit: 'day' };
}

export function OverdueDueIndicator({ item, now, label, enabled = true }: { item: UniversalItem; now: Date; label: string; enabled?: boolean }) {
  if (!enabled) return null;
  const age = overdueAgeWithoutActiveRange(item, now);
  if (age === null) return null;
  const unit = age.unit === 'hour' ? (age.value === 1 ? 'hour' : 'hours') : (age.value === 1 ? 'day' : 'days');
  const description = `${label}: ${age.value} ${unit}`;
  return <span className="item-overdue-due-indicator" title={description} aria-label={description}>{age.value}{age.unit === 'hour' ? 'h' : 'd'}</span>;
}
