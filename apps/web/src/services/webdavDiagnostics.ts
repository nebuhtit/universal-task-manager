import { APP_VERSION, SCHEMA_VERSION } from '@utm/core';

const key = 'utm:webdav-audit:v1';
let enabled = false;
let entries: object[] | undefined;
const runtimeError = (event: ErrorEvent) => auditDav('runtime-error', { line: event.lineno, column: event.colno, frames: event.error instanceof Error ? event.error.stack?.match(/[\w.-]+\.js:\d+:\d+/g)?.slice(0, 20) : undefined });
const rejection = (event: PromiseRejectionEvent) => auditDav('unhandled-rejection', { frames: event.reason instanceof Error ? event.reason.stack?.match(/[\w.-]+\.js:\d+:\d+/g)?.slice(0, 20) : undefined });
const lifecycle = () => auditDav('lifecycle', { visibility: document.visibilityState, online: navigator.onLine, width: window.visualViewport?.width, height: window.visualViewport?.height, scale: window.visualViewport?.scale });
export function setDavDiagnosticsEnabled(value: boolean): void {
  if (enabled === value) return;
  enabled = value;
  if (typeof window === 'undefined') return;
  if (value) {
    window.addEventListener('error', runtimeError); window.addEventListener('unhandledrejection', rejection);
    document.addEventListener('visibilitychange', lifecycle); window.addEventListener('online', lifecycle); window.addEventListener('offline', lifecycle);
    lifecycle();
  } else {
    window.removeEventListener('error', runtimeError); window.removeEventListener('unhandledrejection', rejection);
    document.removeEventListener('visibilitychange', lifecycle); window.removeEventListener('online', lifecycle); window.removeEventListener('offline', lifecycle);
  }
}
export function clearDavDiagnostics(): void {
  entries = [];
  try { localStorage.removeItem(key); } catch { /* Optional diagnostic storage. */ }
}
export function readDavDiagnostics(): object[] {
  if (!entries) {
    try { const stored: unknown = JSON.parse(localStorage.getItem(key) ?? '[]'); entries = Array.isArray(stored) ? stored.slice(-4000) : []; }
    catch { entries = []; }
  }
  return entries;
}
/** Callers supply structural metadata only, never bodies, headers or credentials. */
export function auditDav(event: string, data: object = {}): void {
  if (!enabled) return;
  const entry = { at: new Date().toISOString(), event, appVersion: APP_VERSION, schemaVersion: SCHEMA_VERSION, commit: import.meta.env.VITE_COMMIT_SHA ?? 'local', ...data };
  entries = [...readDavDiagnostics(), entry].slice(-4000);
  try {
    let text = JSON.stringify(entries);
    while (text.length > 3_000_000 && entries.length > 1) { entries = entries.slice(Math.floor(entries.length / 4)); text = JSON.stringify(entries); }
    localStorage.setItem(key, text);
  } catch { /* Diagnostic storage must not prevent saving tasks. */ }
}
export async function snapshotEvidence(snapshot: Record<string, unknown>): Promise<object> {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(snapshot)));
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  const counts = Object.fromEntries(Object.entries(snapshot).map(([field, value]) => [field, Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value).length : 0]));
  const items = snapshot.items as Record<string, { revision?: number; updatedAt?: string; state?: string }> | undefined;
  return { sha256: hash, bytes: bytes.length, counts, items: Object.entries(items ?? {}).map(([id, item]) => ({ id, revision: item.revision, updatedAt: item.updatedAt, state: item.state })) };
}
