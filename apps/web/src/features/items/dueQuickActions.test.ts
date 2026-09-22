import { describe, expect, it } from 'vitest';
import { createItem } from '@utm/core';
import { dueQuickOptions, dueWallInputToIso, dueWallTimeToIso } from './dueQuickActions';

describe('quick Due choices', () => {
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
});
