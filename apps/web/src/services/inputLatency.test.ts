import { afterEach, expect, it, vi } from 'vitest';
import { inputDispatchDelay, installInputLatency } from './inputLatency';
import { createPerformanceProfiler } from './performanceProfile';
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('measures monotonic and epoch event timestamps without private event data', () => {
  expect(inputDispatchDelay(100, 2100, 1700000000000)).toBe(2000);
  expect(inputDispatchDelay(1700000000100, 2100, 1700000000000)).toBe(2000);
  expect(inputDispatchDelay(0, 2100, 1700000000000)).toBe(0);
  expect(inputDispatchDelay(NaN, 2100, 1700000000000)).toBe(0);
  expect(inputDispatchDelay(3000, 2100, 1700000000000)).toBe(0);
});

it('observes capture, handler completion and a shared frame without inspecting private input', () => {
  vi.useFakeTimers();
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  let now = 100;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  let frame: FrameRequestCallback | undefined;
  const request = vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1; });
  vi.stubGlobal('requestAnimationFrame', request); vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const added = vi.spyOn(document, 'addEventListener');
  const removed = vi.spyOn(document, 'removeEventListener');
  const storage = { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() };
  const profile = createPerformanceProfiler({ storage, now: () => now });
  const cleanup = installInputLatency({ start: profile.startAction, handling: profile.handling, frame: profile.frame, abandon: profile.abandonAction });
  const [capture, bubble] = added.mock.calls.filter(([type]) => type === 'input').map(([, callback]) => callback as EventListener);
  const event = { type: 'input', isTrusted: true, timeStamp: 90, get target() { throw new Error('PRIVATE INPUT MUST NOT BE READ'); }, get key() { throw new Error('SECRET KEY'); } } as unknown as Event;
  try {
    capture!(event); now = 115; bubble!(event);
    capture!({ type: 'input', isTrusted: false } as Event);
    expect(request).toHaveBeenCalledTimes(1);
    now = 140; frame!(now); vi.advanceTimersByTime(0);
    expect(profile.read()[0]!.actions[0]).toMatchObject({ kind: 'input', dispatchMs: 10, handlingMs: 15, frameMs: 40 });
    expect(profile.read()[0]!.actions).toHaveLength(1);
    expect(storage.setItem).not.toHaveBeenCalled();
  } finally { cleanup(); }
  expect(removed).toHaveBeenCalledTimes(9);
  expect(vi.getTimerCount()).toBe(0);
});
