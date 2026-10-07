import { expect, it } from 'vitest';
import { createCalendarDependencyTokens } from './calendarDependencyTokens';

it('reuses exact content, invalidates same-revision changes and does not collide after eviction', () => {
  const token = createCalendarDependencyTokens();
  const item = { id: 'a', revision: 1, custom: { value: 1 } };
  const first = token('a', item);
  expect(token('a', item)).toBe(first);
  expect(token('a', structuredClone(item))).toBe(first);
  expect(token('a', { ...item, custom: { value: 2 } })).not.toBe(first);
  for (let i = 0; i < 20_001; i++) token(String(i), { i });
  expect(token('a', structuredClone(item))).not.toBe(first);
  expect(token('a', item)).toBe(first);
});
