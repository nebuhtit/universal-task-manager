import { describe, expect, it } from 'vitest';
import { createItem } from '@utm/core';
import { dueDateOnlyToIso, dueQuickOptions, dueWallInputToIso, dueWallTimeToIso, plannedDateQuickOptions } from './dueQuickActions';

describe('quick Due choices', () => {
  it('offers named date-only choices using the item local day, never timestamps', () => {
    const item = createItem('Planned'); item.schedule = { timezone: 'Pacific/Kiritimati', plannedDate: '2026-09-23' };
    const choices = plannedDateQuickOptions(item, new Date('2026-09-20T23:00:00Z'));
    expect(choices).toEqual([
      { id: 'today', at: '2026-09-21', disabled: false },
      { id: 'tomorrow', at: '2026-09-22', disabled: false },
      { id: 'day-after-tomorrow', at: '2026-09-23', disabled: false },
      { id: 'next-week', at: '2026-09-28', disabled: false },
      { id: 'next-monday', at: '2026-09-28', disabled: false },
    ]);
    expect(item.schedule).toEqual({ timezone: 'Pacific/Kiritimati', plannedDate: '2026-09-23' });
  });

  it('keeps date-only choices on the right calendar day across DST and year boundaries', () => {
    const item = createItem('Planned'); item.schedule = { timezone: 'America/New_York' };
    expect(plannedDateQuickOptions(item, new Date('2026-03-08T04:30:00Z')).find(choice => choice.id === 'next-monday')?.at).toBe('2026-03-09');
    expect(plannedDateQuickOptions(item, new Date('2027-01-01T01:00:00Z')).find(choice => choice.id === 'tomorrow')?.at).toBe('2027-01-01');
  });
  it('hides elapsed same-day times at the exact boundary', () => {
    const item = createItem('Due'); item.schedule = { timezone: 'Europe/Istanbul' };
    const before = dueQuickOptions(item, new Date('2026-09-21T09:59:59.000Z'));
    expect(before.some((choice) => choice.id === 'today-13')).toBe(true);
    const at = dueQuickOptions(item, new Date('2026-09-21T10:00:00.000Z'));
    expect(at.map((choice) => choice.id)).toEqual(['today-19', 'today-23', 'tomorrow', 'next-week', 'next-monday']);
    expect(at.find((choice) => choice.id === 'tomorrow')?.at).toBe('2026-09-22T06:00:00.000Z');
    expect(at.find((choice) => choice.id === 'next-week')?.at).toBe('2026-09-28T06:00:00.000Z');
  });

  it('disables choices before Event opens without changing other fields', () => {
    const item = createItem('Due'); item.schedule = { timezone: 'UTC', startAt: '2026-09-23T10:00:00.000Z', estimatedDuration: 'PT45M' };
    const choices = dueQuickOptions(item, new Date('2026-09-21T12:00:00.000Z'));
    expect(choices.find((choice) => choice.id === 'tomorrow')?.disabled).toBe(true);
    expect(choices.find((choice) => choice.id === 'next-week')?.disabled).toBe(false);
    expect(item.schedule.estimatedDuration).toBe('PT45M');
  });

  it('uses the same weekday next week and offers Monday separately', () => {
    const item = createItem('Due'); item.schedule = { timezone: 'UTC' };
    const choices = dueQuickOptions(item, new Date('2026-09-23T10:00:00.000Z'));
    expect(choices.find((choice) => choice.id === 'next-week')?.at).toBe('2026-09-30T09:00:00.000Z');
    expect(choices.find((choice) => choice.id === 'next-monday')?.at).toBe('2026-09-28T09:00:00.000Z');
  });

  it('handles DST and rejects nonexistent wall times', () => {
    expect(dueWallTimeToIso('2026-03-08', 2, 30, 'America/New_York')).toBeUndefined();
    expect(dueWallTimeToIso('2026-03-09', 9, 0, 'America/New_York')).toBe('2026-03-09T13:00:00.000Z');
    expect(dueWallInputToIso('2026-11-01T01:30', 'America/New_York')).toBe('2026-11-01T05:30:00.000Z');
  });
  it('anchors a date-only Due to the end of its local day, including DST changes', () => {
    expect(dueDateOnlyToIso('2026-03-08', 'America/New_York')).toBe('2026-03-09T03:59:59.999Z');
    expect(dueDateOnlyToIso('2026-02-30', 'UTC')).toBeUndefined();
  });
});
