const FACE_ID_HINT_KEY = 'utm:face-id-configured:v1';

/**
 * A non-secret startup hint only. The actual wrapped key remains in native
 * secure storage and unlock still fails closed if this hint is stale.
 */
export function hasFaceIdConfiguredHint(): boolean {
  try { return globalThis.localStorage.getItem(FACE_ID_HINT_KEY) === '1'; }
  catch { return false; }
}

export function setFaceIdConfiguredHint(configured: boolean): void {
  try {
    if (configured) globalThis.localStorage.setItem(FACE_ID_HINT_KEY, '1');
    else globalThis.localStorage.removeItem(FACE_ID_HINT_KEY);
  } catch { /* Best effort; IndexedDB/native secure storage remain authoritative. */ }
}
