import { describe, expect, it } from 'vitest';
import { calendarDateKey } from './dsl';

describe('cached calendar date formatting', () => {
  it('preserves timezone boundaries and daylight saving transitions on repeated calls', () => {
    for (let repeat = 0; repeat < 3; repeat += 1) {
      expect(calendarDateKey(new Date('2026-09-07T22:00:00Z'), 'Europe/Moscow')).toBe('2026-09-08');
      expect(calendarDateKey(new Date('2026-09-07T22:00:00Z'), 'America/New_York')).toBe('2026-09-07');
      expect(calendarDateKey(new Date('2026-03-08T06:59:00Z'), 'America/New_York')).toBe('2026-03-08');
      expect(calendarDateKey(new Date('2026-03-08T07:01:00Z'), 'America/New_York')).toBe('2026-03-08');
    }
  });
  it('retains the local-date fallback for invalid zones', () => {
    const date = new Date(2026, 8, 7, 12);
    expect(calendarDateKey(date, 'invalid/timezone')).toBe('2026-09-07');
    expect(calendarDateKey(date)).toBe('2026-09-07');
  });
});
