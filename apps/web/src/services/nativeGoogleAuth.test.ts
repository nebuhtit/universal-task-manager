import { afterEach, expect, it, vi } from 'vitest';
import { authorizeNativeGoogle, disconnectNativeGoogle, isNativeGoogleAuthAvailable } from './nativeGoogleAuth';
import { forgetGoogleCalendarAuthorization, requestGoogleCalendarToken } from './googleCalendar';

afterEach(() => { forgetGoogleCalendarAuthorization(); vi.unstubAllGlobals(); });

it('coalesces simultaneous native token requests after a restart', async () => {
  const events = new EventTarget();
  const postMessage = vi.fn();
  vi.stubGlobal('window', Object.assign(events, { webkit: { messageHandlers: { utmNativeGoogleAuth: { postMessage } } } }));
  const first = requestGoogleCalendarToken();
  const second = requestGoogleCalendarToken();
  expect(postMessage).toHaveBeenCalledTimes(1);
  events.dispatchEvent(new CustomEvent('utm-native-google-status', { detail: {
    id: postMessage.mock.calls[0]![0].id, ok: true, accessToken: 'restored',
    expiresIn: 3600, scope: 'https://www.googleapis.com/auth/calendar.readonly',
  } }));
  expect((await first).accessToken).toBe('restored');
  expect((await second).accessToken).toBe('restored');
  expect(postMessage).toHaveBeenCalledTimes(1);
});

it('surfaces refresh failures without starting a second interactive attempt', async () => {
  const events = new EventTarget();
  const postMessage = vi.fn();
  vi.stubGlobal('window', Object.assign(events, { webkit: { messageHandlers: { utmNativeGoogleAuth: { postMessage } } } }));
  const pending = requestGoogleCalendarToken();
  const failure = expect(pending).rejects.toThrow('Check the connection');
  events.dispatchEvent(new CustomEvent('utm-native-google-status', { detail: {
    id: postMessage.mock.calls[0]![0].id, ok: false, error: 'Check the connection',
  } }));
  await failure;
  expect(postMessage).toHaveBeenCalledTimes(1);
});

it('disconnects the native saved grant without requesting a token', async () => {
  const events = new EventTarget();
  const postMessage = vi.fn();
  vi.stubGlobal('window', Object.assign(events, { webkit: { messageHandlers: { utmNativeGoogleAuth: { postMessage } } } }));
  const result = disconnectNativeGoogle();
  expect(postMessage.mock.calls[0]![0].kind).toBe('google.disconnect');
  events.dispatchEvent(new CustomEvent('utm-native-google-status', { detail: { id: postMessage.mock.calls[0]![0].id, ok: true } }));
  await expect(result).resolves.toBeUndefined();
});

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
