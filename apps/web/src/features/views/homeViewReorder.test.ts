import { describe, expect, it } from 'vitest';
import { canReorderHomeViews } from './homeViewReorder';

describe('Home View reorder availability', () => {
  it('allows all collapsed, including small lists', () => {
    expect(canReorderHomeViews(3, 0)).toBe(true);
    expect(canReorderHomeViews(10, 0)).toBe(true);
  });
  it('requires strictly more than ten collapsed when some remain expanded', () => {
    expect(canReorderHomeViews(12, 2)).toBe(false);
    expect(canReorderHomeViews(12, 1)).toBe(true);
    expect(canReorderHomeViews(3, 1)).toBe(false);
    expect(canReorderHomeViews(0, 0)).toBe(false);
  });
});
