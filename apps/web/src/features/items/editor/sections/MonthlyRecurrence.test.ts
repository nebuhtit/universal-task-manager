import { describe, expect, it } from 'vitest';
import { buildRecurrenceRule, createItem } from '@utm/core';
import { monthlyRule } from './MonthlyRecurrence';

describe('monthly recurrence calendar semantics', () => {
  it('skips a missing month date and supports the last weekday', () => {
    for (const [choice, expected] of [
      [{ mode: 'date' as const, ordinal: 1, day: 'MO', date: 31 }, ['2024-01-31', '2024-03-31']],
      [{ mode: 'weekday' as const, ordinal: -1, day: 'TU', date: 1 }, ['2024-01-30', '2024-02-27', '2024-03-26']],
    ] as const) {
      const patch = monthlyRule(choice);
      const item = createItem('Monthly'); item.schedule = { startAt: '2024-01-01T09:00:00Z', timezone: 'UTC' };
      item.recurrence = { rrule: `FREQ=MONTHLY;INTERVAL=1;${Object.entries(patch).filter(([, value]) => value).map(([key, value]) => `${key}=${value}`).join(';')}`, timezone: 'UTC', rdates: [], exdates: [], activationOffset: 'PT0M', closeAt: 'never', anchor: 'schedule', autoRenew: false };
      expect(buildRecurrenceRule(item).between(new Date('2024-01-01'), new Date('2024-04-01'), false).map(date => date.toISOString().slice(0, 10))).toEqual(expected);
    }
  });
  it('matches independently calculated weekdays across leap years and month boundaries', () => {
    for (const mode of ['weekday', 'full', 'partial'] as const) for (const [weekday, day] of ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].entries()) for (const ordinal of [1, 2, 3]) {
      const patch = monthlyRule({ mode, ordinal, day, date: 1 });
      const item = createItem('Monthly');
      item.schedule = { startAt: '2024-01-01T09:00:00Z', timezone: 'UTC' };
      item.recurrence = { rrule: `FREQ=MONTHLY;INTERVAL=1;${Object.entries(patch).filter(([, value]) => value).map(([key, value]) => `${key}=${value}`).join(';')}`, timezone: 'UTC', rdates: [], exdates: [], activationOffset: 'PT0M', closeAt: 'never', anchor: 'schedule', autoRenew: false };
      const rule = buildRecurrenceRule(item);
      for (const year of [2024, 2025, 2026]) for (let month = 0; month < 12; month++) {
        const start = new Date(Date.UTC(year, month, 1));
        const end = new Date(Date.UTC(year, month + 1, 1));
        const firstWeekday = (start.getUTCDay() + 6) % 7;
        const firstMonday = 1 + (7 - firstWeekday) % 7;
        const expected = mode === 'weekday' ? 1 + (weekday - firstWeekday + 7) % 7 + (ordinal - 1) * 7
          : mode === 'full' ? firstMonday + weekday + (ordinal - 1) * 7
          : 1 - firstWeekday + weekday + (ordinal - 1) * 7;
        const actual = rule.between(start, new Date(end.getTime() - 1), true).map(date => date.getUTCDate());
        const daysInMonth = (end.getTime() - start.getTime()) / 86400000;
        expect(actual, `${mode} ${ordinal} ${day} ${year}-${month + 1}`).toEqual(expected >= 1 && expected <= daysInMonth ? [expected] : []);
      }
    }
  });
});
