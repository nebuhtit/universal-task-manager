import { expect, it } from 'vitest';
import { createItem } from '@utm/core';
import { retainCompletionPositions, setCompletionHold } from './viewSelectors';

it('holds the same row with fresh data, then releases it to sorting on expiry or undo', () => {
  const a = createItem('A'), b = createItem('B'), c = createItem('C');
  const done = { ...a, state: 'done' as const };
  const previous = [a.id, b.id, c.id];
  const sorted = [b, c, done];
  setCompletionHold(a.id, { previous: a, undoUntil: Date.now() + 3000, removeAt: Date.now() + 3200 });
  expect(retainCompletionPositions(sorted, previous)).toEqual([done, b, c]);
  expect(retainCompletionPositions([b, c], previous)).toEqual([b, c]);
  setCompletionHold(a.id);
  expect(retainCompletionPositions(sorted, previous)).toBe(sorted);
  setCompletionHold(a.id, { previous: a, undoUntil: 0, removeAt: 0 });
  expect(retainCompletionPositions(sorted, previous)).toBe(sorted);
});
