export type ReminderSnoozeOption = '15m' | '1h' | '5h' | 'tomorrow';

export function reminderSnoozedUntil(option: ReminderSnoozeOption, now: Date): string {
  if (option === 'tomorrow') {
    const next = new Date(now);
    next.setDate(next.getDate() + 1);
    next.setHours(9, 0, 0, 0);
    return next.toISOString();
  }
  const minutes = option === '15m' ? 15 : option === '1h' ? 60 : 300;
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}
