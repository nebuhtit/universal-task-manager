import { createWorkspace } from '@utm/core';
import { afterEach, expect, it, vi } from 'vitest';
import { unsubscribeBackgroundPush } from './push';

afterEach(() => vi.unstubAllGlobals());

function setup(response: Response | Error, localFailure = false) {
  const workspace = createWorkspace('Push removal');
  workspace.pushPreferences = { enabled: true, contentMode: 'generic', deviceId: 'device-a', deviceSecret: 'test-device-secret', serviceUrl: 'https://example.test' };
  const unsubscribe = vi.fn(async () => { if (localFailure) throw new Error('Browser cleanup failed'); return true; });
  const getRegistration = vi.fn(async () => ({ pushManager: { getSubscription: async () => ({ unsubscribe }) } }));
  vi.stubGlobal('navigator', { serviceWorker: { getRegistration } });
  const fetch = vi.fn(async () => { if (response instanceof Error) throw response; return response; });
  vi.stubGlobal('fetch', fetch);
  return { workspace, fetch, unsubscribe, getRegistration };
}

it.each([new Error('offline'), new Response('Service unavailable', { status: 503 })])('preserves server credentials and browser subscription after a failed removal', async response => {
  const { workspace, getRegistration } = setup(response);
  await expect(unsubscribeBackgroundPush(workspace)).rejects.toThrow();
  expect(getRegistration).not.toHaveBeenCalled();
  expect(workspace.pushPreferences.enabled).toBe(true);
  expect(workspace.pushPreferences.deviceSecret).toBe('test-device-secret');
});

it.each([false, true])('removes server data before browser cleanup and accepts a successful server deletion (local failure=%s)', async localFailure => {
  const { workspace, fetch, unsubscribe } = setup(new Response('{}'), localFailure);
  await expect(unsubscribeBackgroundPush(workspace)).resolves.toBeUndefined();
  expect(fetch).toHaveBeenCalledWith('https://example.test/v1/subscriptions', expect.objectContaining({ method: 'DELETE' }));
  expect(fetch.mock.invocationCallOrder[0]).toBeLessThan(unsubscribe.mock.invocationCallOrder[0]!);
});
