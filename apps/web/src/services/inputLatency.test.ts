import { expect, it } from 'vitest';
import { inputDispatchDelay } from './inputLatency';
it('measures monotonic and epoch event timestamps without private event data', () => {
  expect(inputDispatchDelay(100, 2100, 1700000000000)).toBe(2000);
  expect(inputDispatchDelay(1700000000100, 2100, 1700000000000)).toBe(2000);
  expect(inputDispatchDelay(0, 2100, 1700000000000)).toBe(0);
  expect(inputDispatchDelay(NaN, 2100, 1700000000000)).toBe(0);
  expect(inputDispatchDelay(3000, 2100, 1700000000000)).toBe(0);
});
