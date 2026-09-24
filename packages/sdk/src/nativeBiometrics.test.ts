import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasNativeBiometrics, nativeBiometrics } from './nativeBiometrics.js';

afterEach(() => vi.unstubAllGlobals());
describe('native biometric bridge', () => {
  it('leaves non-native environments on the existing password/browser path', async () => {
    vi.stubGlobal('window', {});
    expect(hasNativeBiometrics()).toBe(false);
    await expect(nativeBiometrics('read', 'test')).rejects.toThrow('workspace password');
  });
  it('uses reply-based native calls without persisting keys or transmitting passwords', async () => {
    const postMessage = vi.fn().mockResolvedValue({ key: 'protected-key' });
    vi.stubGlobal('window', { webkit: { messageHandlers: { utmNativeBiometrics: { postMessage } } } });
    expect(hasNativeBiometrics()).toBe(true);
    expect(await nativeBiometrics('read', 'enrollment')).toEqual({ key: 'protected-key' });
    expect(postMessage).toHaveBeenCalledWith({ kind: 'read', id: 'enrollment' });
    await nativeBiometrics('remove');
    expect(postMessage).toHaveBeenLastCalledWith({ kind: 'remove' });
  });
  it('keeps password fallback on cancellation without leaking native error details', async () => {
    vi.stubGlobal('window', { webkit: { messageHandlers: { utmNativeBiometrics: { postMessage: vi.fn().mockRejectedValue(new Error('private native details')) } } } });
    await expect(nativeBiometrics('create', 'enrollment')).rejects.toThrow('workspace password');
    await expect(nativeBiometrics('read', 'enrollment')).rejects.not.toThrow('private native details');
  });
});
