type Status = { id: string; ok: boolean; accessToken?: string; expiresIn?: number; scope?: string; error?: string };
const handler = () => window.webkit?.messageHandlers?.utmNativeGoogleAuth;
export const isNativeGoogleAuthAvailable = () => Boolean(handler());

function nativeGoogleRequest(kind: 'google.authorize' | 'google.disconnect', scopes?: string[]): Promise<Status> {
  const target = handler();
  if (!target) return Promise.reject(new Error('Native Google authorization is unavailable.'));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      window.removeEventListener('utm-native-google-status', receive);
      reject(new Error('Google authorization timed out. Please retry.'));
    }, 120_000);
    const receive = (event: Event) => {
      const result = (event as CustomEvent<Status>).detail;
      if (result?.id !== id) return;
      globalThis.clearTimeout(timeout);
      window.removeEventListener('utm-native-google-status', receive);
      if (!result.ok) reject(new Error(result.error || 'Google sign-in failed.'));
      else resolve(result);
    };
    window.addEventListener('utm-native-google-status', receive);
    try { target.postMessage({ id, kind, ...(scopes ? { scopes } : {}) }); }
    catch (error) { globalThis.clearTimeout(timeout); window.removeEventListener('utm-native-google-status', receive); reject(error); }
  });
}

export async function authorizeNativeGoogle(scopes: string[]): Promise<{ accessToken: string; expiresIn: number; scope: string }> {
  const result = await nativeGoogleRequest('google.authorize', scopes);
  if (!result.accessToken) throw new Error('Google sign-in returned no access token.');
  return { accessToken: result.accessToken, expiresIn: result.expiresIn ?? 3600, scope: result.scope ?? '' };
}

/** Removes only the native device grant; refresh credentials never enter JS. */
export async function disconnectNativeGoogle(): Promise<void> {
  if (isNativeGoogleAuthAvailable()) await nativeGoogleRequest('google.disconnect');
}
