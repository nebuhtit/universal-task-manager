import { describe, expect, it } from 'vitest';
import { calendarDuration, calendarDurationMs, effectiveScheduleDuration, parseEstimateDuration, parseReminderDuration, reminderIsoDuration, scheduleWithDue, scheduleWithDuration, scheduleWithEnd, scheduleWithStart, toIsoDuration } from './durations';

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
    expect(resized.estimatedDuration).toBe('PT45M');
    expect(scheduleWithStart(resized)).toEqual({ timezone: 'UTC', estimatedDuration: 'PT45M' });
    const dueOnly = scheduleWithDue(empty, '2026-08-30T12:00:00.000Z');
    expect(dueOnly).toEqual({ timezone: 'UTC', dueAt: '2026-08-30T12:00:00.000Z', estimatedDuration: 'PT10M' });
    expect(scheduleWithDue(dueOnly)).toEqual({ timezone: 'UTC', estimatedDuration: 'PT10M' });
  });

  it('derives old dated durations without inventing a value for empty items', () => {
    expect(effectiveScheduleDuration({})).toBeUndefined();
    expect(effectiveScheduleDuration({ estimatedDuration: 'broken' })).toBeUndefined();
    expect(effectiveScheduleDuration({ startAt: '2026-08-29T10:00:00.000Z', endAt: '2026-08-29T11:30:00.000Z' })).toEqual({ amount: 90, unit: 'minutes' });
  });
});
