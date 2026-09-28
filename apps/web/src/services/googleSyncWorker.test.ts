import { afterEach, expect, it, vi } from 'vitest';
import { createWorkspace } from '@utm/core';
import { planGoogleSync } from './googleSyncWorker';
import type { GoogleSyncPlanInput } from './googleSyncPlan';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('terminates stalled computation, instead of a synchronous main-thread fallback', async () => {
  vi.useFakeTimers();
  const terminate = vi.fn();
  vi.stubGlobal('Worker', class { postMessage() {} terminate = terminate; });
  const result = expect(planGoogleSync({ workspace: createWorkspace('test') } as GoogleSyncPlanInput)).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(30_000);
  await result;
  expect(terminate).toHaveBeenCalled();
});
it('fails safely when workers are unavailable', async () => {
  vi.stubGlobal('Worker', undefined);
  await expect(planGoogleSync({} as GoogleSyncPlanInput)).rejects.toThrow('unavailable');
});
