export const DIAGNOSTICS_KEY = 'utm:diagnostics:v1';
export const DIAGNOSTICS_ENABLED_KEY = 'utm:diagnostics-enabled:v1';
export const DIAGNOSTICS_CHANGED_EVENT = 'utm:diagnostics-changed';
export const MAX_DIAGNOSTICS_BYTES = 40 * 1024 * 1024;
export const MAX_DIAGNOSTIC_ENTRIES = 1_000;

export type DiagnosticKind = 'action' | 'result' | 'error' | 'unhandledrejection' | 'usage';
export type DiagnosticEntry = {
  at: string;
  kind: DiagnosticKind;
  message: string;
  operation?: string;
  outcome?: 'started' | 'succeeded' | 'failed';
  durationMs?: number;
  page?: string;
  details?: string;
};

const bounded = (value: string | undefined, limit: number): string | undefined => value?.slice(0, limit);

/**
 * Unlock failures happen before the encrypted workspace can be opened. Keep a
 * useful category for troubleshooting, but never copy arbitrary exception text
 * into the pre-unlock log because it could contain user-controlled data.
 */
export const diagnosticFailureCode = (reason: unknown): string => {
  const message = reason instanceof Error ? reason.message.toLowerCase() : String(reason).toLowerCase();
  if (/wrong password|encrypted data|decrypt|damaged/.test(message)) return 'password-or-encrypted-data';
  if (/indexeddb|browser storage|transaction/.test(message)) return 'browser-storage';
  if (/automerge|outdated document|workspace document|schema/.test(message)) return 'workspace-document';
  if (/recurrence|worker/.test(message)) return 'recurrence-processing';
  return 'unexpected';
};

export const diagnosticsEnabled = (): boolean => {
  try { return localStorage.getItem(DIAGNOSTICS_ENABLED_KEY) !== 'false'; }
  catch { return true; }
};

export const setDiagnosticsEnabled = (enabled: boolean): void => {
  try {
    localStorage.setItem(DIAGNOSTICS_ENABLED_KEY, String(enabled));
    window.dispatchEvent(new Event(DIAGNOSTICS_CHANGED_EVENT));
  } catch {
    // Diagnostics preferences must never interfere with application behavior.
  }
};

export const readDiagnostics = (): DiagnosticEntry[] => {
  try {
    const value = JSON.parse(localStorage.getItem(DIAGNOSTICS_KEY) ?? '[]');
    return Array.isArray(value) ? value as DiagnosticEntry[] : [];
  } catch {
    return [];
  }
};

/**
 * Records local operational metadata only. Callers must not include item titles,
 * descriptions, passwords, encryption keys or exported workspace contents.
 */
export const recordDiagnostic = (entry: Omit<DiagnosticEntry, 'at'>): void => {
  try {
    if (!diagnosticsEnabled()) return;
    const safeEntry: DiagnosticEntry = {
      ...(entry.operation ? { operation: entry.operation.slice(0, 160) } : {}),
      ...(entry.outcome ? { outcome: entry.outcome } : {}),
      ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
      ...(entry.page ? { page: entry.page.slice(0, 160) } : {}),
      ...(entry.details ? { details: entry.details.slice(0, 4_000) } : {}),
      kind: entry.kind,
      message: bounded(entry.message, 500) ?? '',
      at: new Date().toISOString(),
    };
    const next = [...readDiagnostics(), safeEntry].slice(-MAX_DIAGNOSTIC_ENTRIES);
    while (next.length > 1 && new TextEncoder().encode(JSON.stringify(next)).byteLength > MAX_DIAGNOSTICS_BYTES) next.shift();
    localStorage.setItem(DIAGNOSTICS_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(DIAGNOSTICS_CHANGED_EVENT));
  } catch {
    // Diagnostics must never interfere with application behavior.
  }
};

export const clearDiagnostics = (): void => {
  try {
    localStorage.removeItem(DIAGNOSTICS_KEY);
    window.dispatchEvent(new Event(DIAGNOSTICS_CHANGED_EVENT));
  } catch {
    // Diagnostics must never interfere with application behavior.
  }
};
