type Reply = { available?: boolean; key?: string };
type BridgeWindow = { webkit?: { messageHandlers?: { utmNativeBiometrics?: { postMessage(value: unknown): Promise<Reply> } } } };
const handler = () => typeof window === 'undefined' ? undefined : (window as unknown as BridgeWindow).webkit?.messageHandlers?.utmNativeBiometrics;
export const hasNativeBiometrics = () => Boolean(handler());

/** Native replies never enter diagnostics or persistent browser storage. */
export async function nativeBiometrics(kind: 'status' | 'create' | 'read' | 'remove', id?: string): Promise<Reply> {
  const bridge = handler();
  if (!bridge) throw new Error('Native Face ID is unavailable. Use your workspace password.');
  const language = typeof document === 'undefined' ? 'en' : document.documentElement.lang;
  try { return await bridge.postMessage({ kind, language, ...(id ? { id } : {}) }); }
  catch { throw new Error('Face ID was cancelled or unavailable. Use your workspace password, or enable Face ID again in Settings.'); }
}
