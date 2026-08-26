export const DIAGNOSTICS_KEY = 'utm:diagnostics:v1';
export const DIAGNOSTICS_CHANGED_EVENT = 'utm:diagnostics-changed';

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
    const next = [...readDiagnostics(), safeEntry].slice(-500);
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
