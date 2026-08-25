import { describe, expect, it } from 'vitest';
import { dateInput, formatViewDate, fromDateInput, isSleepTime, scheduledTheme } from './dates';

describe('date utilities', () => {
  it('round-trips the local datetime input representation', () => {
    const original = new Date(2026, 7, 25, 22, 35, 0, 0);
    expect(fromDateInput(dateInput(original.toISOString()))).toBe(original.toISOString());
    expect(dateInput('not-a-date')).toBe('');
  });

  it('formats view dates without locale punctuation in date parts', () => {
    const value = new Date(2026, 7, 25, 22, 35);
    const formatted = formatViewDate(value, true, 'ru');
    expect(formatted).not.toContain('.');
    expect(formatted).toContain(', 22:35');
  });

  it('handles scheduled themes and overnight sleep ranges', () => {
    expect(scheduledTheme('08:00', '20:00', new Date(2026, 7, 25, 12, 0))).toBe('light');
    expect(scheduledTheme('08:00', '20:00', new Date(2026, 7, 25, 22, 0))).toBe('dark');
    expect(isSleepTime(new Date(2026, 7, 25, 23, 0), { wake: '08:00', sleep: '22:00' })).toBe(true);
    expect(isSleepTime(new Date(2026, 7, 25, 12, 0), { wake: '08:00', sleep: '22:00' })).toBe(false);
  });
});
