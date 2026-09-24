import { afterEach, expect, it, vi } from 'vitest';
import { authorizeNativeGoogle, isNativeGoogleAuthAvailable } from './nativeGoogleAuth';

afterEach(() => vi.unstubAllGlobals());

it('does not use browser OAuth without the native bridge', async () => {
  vi.stubGlobal('window', {});
  expect(isNativeGoogleAuthAvailable()).toBe(false);
  await expect(authorizeNativeGoogle(['calendar'])).rejects.toThrow('unavailable');
});

it('waits for its own native response and propagates configuration failures', async () => {
  const events = new EventTarget();
  const postMessage = vi.fn();
  vi.stubGlobal('window', Object.assign(events, { webkit: { messageHandlers: { utmNativeGoogleAuth: { postMessage } } } }));
  const result = authorizeNativeGoogle(['calendar']);
  const rejection = expect(result).rejects.toThrow('Configure iOS client');
  events.dispatchEvent(new CustomEvent('utm-native-google-status', { detail: { id: 'unrelated', ok: true, accessToken: 'ignored' } }));
  events.dispatchEvent(new CustomEvent('utm-native-google-status', { detail: { id: postMessage.mock.calls[0]![0].id, ok: false, error: 'Configure iOS client' } }));
  await rejection;
});

it('returns native token and granted scopes without storing credentials', async () => {
  const events = new EventTarget();
  const postMessage = vi.fn();
  vi.stubGlobal('window', Object.assign(events, { webkit: { messageHandlers: { utmNativeGoogleAuth: { postMessage } } } }));
  const result = authorizeNativeGoogle(['calendar']);
  events.dispatchEvent(new CustomEvent('utm-native-google-status', { detail: { id: postMessage.mock.calls[0]![0].id, ok: true, accessToken: 'test-token', scope: 'calendar', expiresIn: 60 } }));
  await expect(result).resolves.toEqual({ accessToken: 'test-token', scope: 'calendar', expiresIn: 60 });
});
