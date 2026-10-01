import { expect, it } from 'vitest';
import { createItem } from '@utm/core';
import { calendarListOrder } from './calendarPlanning';

it('orders displayed rows without changing schedules, duplicating rows or resurrecting missing ones', () => {
  const a = createItem('A'), b = createItem('B'), c = createItem('C');
  const rows = [a, b, c];
  expect(calendarListOrder(rows)).toBe(rows);
  expect(calendarListOrder(rows, [b.id, 'missing', b.id])).toEqual([b, a, c]);
  expect(rows).toEqual([a, b, c]);
});
