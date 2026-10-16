import { expect, it } from 'vitest';
import { createItem } from '@utm/core';
import { applyQuickEntryText, parseQuickEntryForItem } from './quickEntry';
import { joinWithinText } from '../../../quick-entry-lab/relations';

it('validates the canonical text including hidden rr chips before attempting placement', () => {
  const now = new Date('2026-09-24T08:00:00Z');
  const item = createItem('Task');
  item.schedule = { timezone: 'UTC', dueAt: '2026-09-24T12:00:00Z', estimatedDuration: 'PT10M' };
  const visible = 'Task начало 24.09.2026 10:00 дл 30м обратно 15м';
  const canonical = joinWithinText(visible, ['rr [Work](item:work)']);
  expect(parseQuickEntryForItem(visible, now, item).errors).toEqual([]);
  expect(parseQuickEntryForItem(canonical, now, item).errors).toContain('Для дороги обратно нужно время конца события.');
  expect(() => applyQuickEntryText(item, canonical, now, { preserveUnspecifiedSchedule: true })).toThrow('Для дороги обратно');
});
