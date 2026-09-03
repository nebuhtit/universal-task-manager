import { afterEach, describe, expect, it, vi } from 'vitest';
import { clockService } from './clockService';

describe('clock service', () => {
  afterEach(() => vi.useRealTimers());

  it('shares one timer and respects each subscriber cadence', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T10:00:00.000Z'));
    const everySecond = vi.fn();
    const everyTwoHundredMilliseconds = vi.fn();
    const unsubscribeSecond = clockService.subscribe(everySecond, 1_000);
    const unsubscribeFast = clockService.subscribe(everyTwoHundredMilliseconds, 200);

    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1_000);
    expect(everySecond).toHaveBeenCalledTimes(1);
    expect(everyTwoHundredMilliseconds).toHaveBeenCalledTimes(5);

    unsubscribeFast();
    expect(vi.getTimerCount()).toBe(1);
    unsubscribeSecond();
    expect(vi.getTimerCount()).toBe(0);
  });
});
