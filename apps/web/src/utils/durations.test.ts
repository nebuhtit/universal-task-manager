import { describe, expect, it } from 'vitest';
import { calendarDuration, calendarDurationMs, parseEstimateDuration, parseReminderDuration, reminderIsoDuration, toIsoDuration } from './durations';

describe('duration utilities', () => {
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
    expect(calendarDuration(start, start)).toEqual({ amount: 10, unit: 'minutes' });
    expect(calendarDurationMs(2, 'hours')).toBe(7_200_000);
  });
});
