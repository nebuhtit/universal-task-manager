import { describe, expect, it } from 'vitest';
import { calendarDuration, calendarDurationMs, effectiveScheduleDuration, parseEstimateDuration, parseFriendlyDurationInput, parseReminderDuration, reminderIsoDuration, scheduleWithDue, scheduleWithDuration, scheduleWithEnd, scheduleWithLinkedEnd, scheduleWithStart, toIsoDuration } from './durations';

describe('duration utilities', () => {
  it('accepts English and Russian units with or without spaces', () => {
    for (const value of ['1m', '1min', '1 m', '1 min', '1м', '1 мин', '1 мин.', '1 MIN']) expect(parseFriendlyDurationInput(value)).toEqual({ amount: 1, unit: 'minutes' });
    for (const value of ['2h', '2 hour', '2 hours', '2ч', '2 часа', '2 часы']) expect(parseFriendlyDurationInput(value)).toEqual({ amount: 2, unit: 'hours' });
    for (const value of ['3s', '3 sec', '3 seconds', '3 с', '3 сек']) expect(parseFriendlyDurationInput(value)).toEqual({ amount: 3, unit: 'seconds' });
    for (const value of ['4d', '4 days', '4 д', '4 дня', '4 дни']) expect(parseFriendlyDurationInput(value)).toEqual({ amount: 4, unit: 'days' });
    expect(parseFriendlyDurationInput('2 weeks')).toEqual({ amount: 2, unit: 'weeks' });
    expect(parseFriendlyDurationInput('2', 'hours')).toEqual({ amount: 2, unit: 'hours' });
    for (const value of ['', '0min', '-1h', '1mi', '1month', '1h junk']) expect(parseFriendlyDurationInput(value)).toBeUndefined();
  });

  it('round-trips fractions and seconds through the schedule without changing their duration', () => {
    for (const [value, expectedMs] of [['1.5h', 5_400_000], ['1,5 мин', 90_000], ['30sec', 30_000]] as const) {
      const duration = parseFriendlyDurationInput(value)!;
      const startAt = '2026-10-08T10:00:00.000Z';
      const saved = scheduleWithDuration({ timezone: 'UTC', startAt }, duration);
      expect(Date.parse(saved.endAt!) - Date.parse(startAt)).toBe(expectedMs);
      const reopened = effectiveScheduleDuration(saved)!;
      expect(calendarDurationMs(reopened.amount, reopened.unit)).toBe(expectedMs);
    }
  });
  it('keeps calendar and reminder ISO units distinct', () => {
    expect(toIsoDuration(2, 'hours')).toBe('PT2H');
    expect(reminderIsoDuration(3, 'months')).toBe('P3M');
    expect(parseReminderDuration('-P3M')).toEqual({ amount: 3, unit: 'months', before: true });
    expect(parseReminderDuration('PT3M')).toEqual({ amount: 3, unit: 'minutes', before: false });
  });

  it('normalizes mixed estimates without losing minutes', () => {
    expect(parseEstimateDuration('PT2H')).toEqual({ amount: 2, unit: 'hours' });
    expect(parseEstimateDuration('PT1H30M')).toEqual({ amount: 90, unit: 'minutes' });
  });

  it('calculates friendly calendar durations and preserves the default', () => {
    const start = '2026-08-25T10:00:00.000Z';
    expect(calendarDuration(start, '2026-08-25T10:10:00.000Z')).toEqual({ amount: 10, unit: 'minutes' });
    expect(calendarDuration(start, '2026-08-25T12:00:00.000Z')).toEqual({ amount: 2, unit: 'hours' });
    expect(calendarDuration('2026-08-25T10:00:47.000Z', '2026-08-25T11:00:00.000Z')).toEqual({ amount: 1, unit: 'hours' });
    expect(calendarDuration(start, start)).toEqual({ amount: 10, unit: 'minutes' });
    expect(calendarDurationMs(2, 'hours')).toBe(7_200_000);
  });

  it('keeps Duration independent while synchronizing an optional calendar block', () => {
    const empty = { timezone: 'UTC' };
    const defaultStarted = scheduleWithStart(empty, '2026-08-29T09:00:00.000Z');
    expect(defaultStarted).toEqual({ timezone: 'UTC', startAt: '2026-08-29T09:00:00.000Z', estimatedDuration: 'PT10M', endAt: '2026-08-29T09:10:00.000Z' });
    const estimated = scheduleWithDuration(empty, { amount: 10, unit: 'minutes' });
    expect(estimated).toEqual({ timezone: 'UTC', estimatedDuration: 'PT10M' });
    const started = scheduleWithStart(estimated, '2026-08-29T10:00:00.000Z');
    expect(started.endAt).toBe('2026-08-29T10:10:00.000Z');
    const moved = scheduleWithStart(started, '2026-08-29T11:00:00.000Z');
    expect(moved.endAt).toBe('2026-08-29T11:10:00.000Z');
    const resized = scheduleWithEnd(moved, '2026-08-29T11:45:00.000Z');
    expect(resized.estimatedDuration).toBe('PT10M');
    expect(scheduleWithStart(resized)).toEqual({ timezone: 'UTC', estimatedDuration: 'PT10M' });
    const dueOnly = scheduleWithDue(empty, '2026-08-30T12:00:00.000Z');
    expect(dueOnly).toEqual({ timezone: 'UTC', dueAt: '2026-08-30T12:00:00.000Z', estimatedDuration: 'PT10M' });
    expect(scheduleWithDue(dueOnly)).toEqual({ timezone: 'UTC', estimatedDuration: 'PT10M' });
  });

  it('derives old dated durations without inventing a value for empty items', () => {
    expect(effectiveScheduleDuration({})).toBeUndefined();
    expect(effectiveScheduleDuration({ estimatedDuration: 'broken' })).toBeUndefined();
    expect(effectiveScheduleDuration({ startAt: '2026-08-29T10:00:00.000Z', endAt: '2026-08-29T11:30:00.000Z' })).toEqual({ amount: 90, unit: 'minutes' });
  });
  it('links explicit duration and end edits in both directions', () => {
    const initial = { timezone: 'UTC', startAt: '2026-09-26T18:00:00.000Z', endAt: '2026-09-26T19:00:00.000Z', estimatedDuration: 'PT1H' };
    const stretched = scheduleWithDuration(initial, { amount: 2, unit: 'hours' });
    expect(stretched.endAt).toBe('2026-09-26T20:00:00.000Z');
    const shortened = scheduleWithLinkedEnd(stretched, '2026-09-26T19:30:00.000Z');
    expect(shortened.estimatedDuration).toBe('PT90M');
    expect(scheduleWithDuration(shortened, { amount: 45, unit: 'minutes' }).endAt).toBe('2026-09-26T18:45:00.000Z');
    const withoutEnd = scheduleWithLinkedEnd(shortened);
    expect(withoutEnd.endAt).toBeUndefined();
    expect(withoutEnd.estimatedDuration).toBe('PT90M');
    expect(scheduleWithDuration(withoutEnd, { amount: 2, unit: 'hours' })).toMatchObject({ estimatedDuration: 'PT2H' });
    expect(scheduleWithDuration(withoutEnd, { amount: 2, unit: 'hours' }).endAt).toBe('2026-09-26T20:00:00.000Z');
    expect(scheduleWithDuration({ timezone: 'UTC', startAt: '2026-09-26T18:00:00.000Z' }, { amount: 1, unit: 'hours' }).endAt).toBe('2026-09-26T19:00:00.000Z');
  });
});
