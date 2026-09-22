import { describe, expect, it } from 'vitest';
import { reminderSnoozedUntil } from './reminderSnooze';

describe('reminder snooze', () => {
  it('uses elapsed time for fixed options', () => {
    const now = new Date('2026-09-21T12:00:00.000Z');
    expect(reminderSnoozedUntil('15m', now)).toBe('2026-09-21T12:15:00.000Z');
    expect(reminderSnoozedUntil('1h', now)).toBe('2026-09-21T13:00:00.000Z');
    expect(reminderSnoozedUntil('5h', now)).toBe('2026-09-21T17:00:00.000Z');
  });
  it('uses 09:00 on the next local calendar day', () => {
    const now = new Date('2026-09-21T22:30:00.000Z');
    const until = new Date(reminderSnoozedUntil('tomorrow', now));
    const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
    expect(until.getFullYear()).toBe(tomorrow.getFullYear());
    expect(until.getMonth()).toBe(tomorrow.getMonth());
    expect(until.getDate()).toBe(tomorrow.getDate());
    expect(until.getHours()).toBe(9);
    expect(until.getMinutes()).toBe(0);
  });
});
