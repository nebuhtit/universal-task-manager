import type { Schedule } from '@utm/core';

export type FriendlyDurationUnit = 'minutes' | 'hours' | 'days' | 'weeks';
export type ReminderDurationUnit = 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'years';

export const reminderIsoDuration = (amount: number, unit: ReminderDurationUnit) => unit === 'seconds' ? `PT${amount}S` : unit === 'minutes' ? `PT${amount}M` : unit === 'hours' ? `PT${amount}H` : unit === 'days' ? `P${amount}D` : unit === 'weeks' ? `P${amount}W` : unit === 'months' ? `P${amount}M` : `P${amount}Y`;
export const parseReminderDuration = (value?: string): { amount: number; unit: ReminderDurationUnit; before: boolean } => { const before = (value ?? '').startsWith('-'); const match = /^(?:-)?(?:P(\d+)([DWMY])|PT(\d+)([HMS]))$/.exec(value ?? ''); if (!match) return { amount: 1, unit: 'hours', before: false }; const amount = Number(match[1] ?? match[3]); const code = match[2] ?? match[4]; return { amount, before, unit: code === 'S' ? 'seconds' : code === 'M' ? (match[3] ? 'minutes' : 'months') : code === 'H' ? 'hours' : code === 'W' ? 'weeks' : code === 'Y' ? 'years' : 'days' }; };
export const parseFriendlyDuration = (value?: string): { amount: number; unit: FriendlyDurationUnit } => {
  const match = /^(?:P(\d+)([DW])|PT(\d+)([HM]))$/.exec(value ?? '');
  if (!match) return { amount: 7, unit: 'days' };
  const amount = Number(match[1] ?? match[3]);
  const code = match[2] ?? match[4];
  return { amount, unit: code === 'W' ? 'weeks' : code === 'H' ? 'hours' : code === 'M' ? 'minutes' : 'days' };
};
export const toIsoDuration = (amount: number, unit: FriendlyDurationUnit) => unit === 'weeks' ? `P${amount}W` : unit === 'days' ? `P${amount}D` : unit === 'hours' ? `PT${amount}H` : `PT${amount}M`;
export const parseEstimateDuration = (value?: string): { amount: number; unit: FriendlyDurationUnit } => {
  const timed = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(value ?? '');
  if (timed && (timed[1] || timed[2])) {
    const minutes = Number(timed[1] ?? 0) * 60 + Number(timed[2] ?? 0);
    return minutes % 60 === 0 ? { amount: minutes / 60, unit: 'hours' } : { amount: minutes, unit: 'minutes' };
  }
  return parseFriendlyDuration(value);
};
export const parseOptionalEstimateDuration = (value?: string): { amount: number; unit: FriendlyDurationUnit } | undefined => {
  if (!/^(?:P\d+[DW]|PT(?=\d)(?:(?:\d+)H)?(?:(?:\d+)M)?)$/.test(value ?? '')) return undefined;
  const parsed = parseEstimateDuration(value);
  return Number.isFinite(parsed.amount) && parsed.amount > 0 ? parsed : undefined;
};
export const calendarDuration = (startAt?: string, endAt?: string): { amount: number; unit: FriendlyDurationUnit } => {
  const start = startAt ? Date.parse(startAt) : Number.NaN;
  const end = endAt ? Date.parse(endAt) : Number.NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return { amount: 10, unit: 'minutes' };
  // datetime-local displays minute precision. Compare the same visible values
  // so hidden seconds on a freshly-created Start cannot turn 1 hour into 59 min.
  const minutes = Math.max(1, Math.floor(end / 60_000) - Math.floor(start / 60_000));
  if (minutes % (7 * 24 * 60) === 0) return { amount: minutes / (7 * 24 * 60), unit: 'weeks' };
  if (minutes % (24 * 60) === 0) return { amount: minutes / (24 * 60), unit: 'days' };
  if (minutes % 60 === 0) return { amount: minutes / 60, unit: 'hours' };
  return { amount: minutes, unit: 'minutes' };
};
export const calendarDurationMs = (amount: number, unit: FriendlyDurationUnit) => {
  const minutes = unit === 'weeks' ? amount * 7 * 24 * 60 : unit === 'days' ? amount * 24 * 60 : unit === 'hours' ? amount * 60 : amount;
  return minutes * 60_000;
};

export const effectiveScheduleDuration = (schedule?: Pick<Schedule, 'estimatedDuration' | 'startAt' | 'endAt'>): { amount: number; unit: FriendlyDurationUnit } | undefined => {
  const estimate = parseOptionalEstimateDuration(schedule?.estimatedDuration);
  if (estimate) return estimate;
  const start = schedule?.startAt ? Date.parse(schedule.startAt) : Number.NaN;
  const end = schedule?.endAt ? Date.parse(schedule.endAt) : Number.NaN;
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? calendarDuration(schedule!.startAt, schedule!.endAt) : undefined;
};

export const scheduleWithDuration = (schedule: Schedule, duration?: { amount: number; unit: FriendlyDurationUnit }): Schedule => {
  const next = { ...schedule };
  if (!duration || !Number.isFinite(duration.amount) || duration.amount <= 0) {
    delete next.estimatedDuration;
    delete next.endAt;
    return next;
  }
  next.estimatedDuration = toIsoDuration(duration.amount, duration.unit);
  const start = next.startAt ? Date.parse(next.startAt) : Number.NaN;
  if (Number.isFinite(start)) next.endAt = new Date(start + calendarDurationMs(duration.amount, duration.unit)).toISOString();
  return next;
};

export const scheduleWithStart = (schedule: Schedule, startAt?: string): Schedule => {
  const duration = effectiveScheduleDuration(schedule);
  const next = { ...schedule };
  if (!startAt) {
    delete next.startAt;
    delete next.endAt;
    return next;
  }
  next.startAt = startAt;
  const start = Date.parse(startAt);
  if (Number.isFinite(start)) {
    const resolvedDuration = duration ?? { amount: 10, unit: 'minutes' as const };
    next.estimatedDuration = toIsoDuration(resolvedDuration.amount, resolvedDuration.unit);
    next.endAt = new Date(start + calendarDurationMs(resolvedDuration.amount, resolvedDuration.unit)).toISOString();
  } else delete next.endAt;
  return next;
};

export const scheduleWithEnd = (schedule: Schedule, endAt?: string): Schedule => {
  const next = { ...schedule };
  if (!endAt) { delete next.endAt; return next; }
  next.endAt = endAt;
  const start = next.startAt ? Date.parse(next.startAt) : Number.NaN;
  const end = Date.parse(endAt);
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    const duration = calendarDuration(next.startAt, endAt);
    next.estimatedDuration = toIsoDuration(duration.amount, duration.unit);
  }
  return next;
};
