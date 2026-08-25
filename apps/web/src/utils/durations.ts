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
export const calendarDuration = (startAt?: string, endAt?: string): { amount: number; unit: FriendlyDurationUnit } => {
  const start = startAt ? Date.parse(startAt) : Number.NaN;
  const end = endAt ? Date.parse(endAt) : Number.NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return { amount: 10, unit: 'minutes' };
  const minutes = Math.max(1, Math.round((end - start) / 60_000));
  if (minutes % (7 * 24 * 60) === 0) return { amount: minutes / (7 * 24 * 60), unit: 'weeks' };
  if (minutes % (24 * 60) === 0) return { amount: minutes / (24 * 60), unit: 'days' };
  if (minutes % 60 === 0) return { amount: minutes / 60, unit: 'hours' };
  return { amount: minutes, unit: 'minutes' };
};
export const calendarDurationMs = (amount: number, unit: FriendlyDurationUnit) => {
  const minutes = unit === 'weeks' ? amount * 7 * 24 * 60 : unit === 'days' ? amount * 24 * 60 : unit === 'hours' ? amount * 60 : amount;
  return minutes * 60_000;
};
