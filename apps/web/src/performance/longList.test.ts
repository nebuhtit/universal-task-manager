import { describe, expect, it } from 'vitest';
import { LONG_LIST_VIRTUALIZATION_THRESHOLD, longListClass } from './longList';

describe('long-list virtualization threshold', () => {
  it('keeps ordinary lists untouched', () => expect(longListClass('item-list', LONG_LIST_VIRTUALIZATION_THRESHOLD - 1)).toBe('item-list'));
  it('virtualizes only genuinely long lists', () => expect(longListClass('item-list', LONG_LIST_VIRTUALIZATION_THRESHOLD)).toBe('item-list long-list-virtualized'));
});

