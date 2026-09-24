type Status = { id: string; ok: boolean; accessToken?: string; expiresIn?: number; scope?: string; error?: string };
const handler = () => window.webkit?.messageHandlers?.utmNativeGoogleAuth;
export const isNativeGoogleAuthAvailable = () => Boolean(handler());

export function authorizeNativeGoogle(scopes: string[]): Promise<{ accessToken: string; expiresIn: number; scope: string }> {
  const target = handler();
  if (!target) return Promise.reject(new Error('Native Google authorization is unavailable.'));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const receive = (event: Event) => {
      const result = (event as CustomEvent<Status>).detail;
      if (result?.id !== id) return;
      window.removeEventListener('utm-native-google-status', receive);
      if (!result.ok || !result.accessToken) reject(new Error(result.error || 'Google sign-in failed.'));
      else resolve({ accessToken: result.accessToken, expiresIn: result.expiresIn ?? 3600, scope: result.scope ?? '' });
    };
    window.addEventListener('utm-native-google-status', receive);
    try { target.postMessage({ id, kind: 'google.authorize', scopes }); }
    catch (error) { window.removeEventListener('utm-native-google-status', receive); reject(error); }
  });
}
