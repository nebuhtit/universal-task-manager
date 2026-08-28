import { beforeEach, describe, expect, it } from 'vitest';
import { diagnosticFailureCode, DIAGNOSTICS_KEY, MAX_DIAGNOSTIC_ENTRIES, readDiagnostics, recordDiagnostic, setDiagnosticsEnabled } from './diagnostics';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('local diagnostics', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  });

  it('records bounded failures but ignores ordinary successful activity', () => {
    recordDiagnostic({ kind: 'result', message: 'saved', operation: 'Update item', outcome: 'succeeded', durationMs: 12 });
    expect(readDiagnostics()).toEqual([]);
    recordDiagnostic({ kind: 'error', message: 'save failed', operation: 'Update item', outcome: 'failed', durationMs: 12, details: 'x'.repeat(5_000) });
    const [entry] = readDiagnostics();
    expect(entry).toMatchObject({ kind: 'error', message: 'save failed', operation: 'Update item', outcome: 'failed', durationMs: 12 });
    expect(entry?.details).toHaveLength(4_000);
    expect(JSON.parse(localStorage.getItem(DIAGNOSTICS_KEY) ?? '[]')).toHaveLength(1);
  });

  it('retains failures while bounding the count', () => {
    for (let index = 0; index < MAX_DIAGNOSTIC_ENTRIES + 5; index += 1) recordDiagnostic({ kind: 'error', message: String(index) });
    const entries = readDiagnostics();
    expect(entries).toHaveLength(MAX_DIAGNOSTIC_ENTRIES);
    expect(entries[0]?.message).toBe('5');
  });

  it('can stop recording without deleting existing diagnostics', () => {
    recordDiagnostic({ kind: 'error', message: 'before' });
    setDiagnosticsEnabled(false);
    recordDiagnostic({ kind: 'error', message: 'after' });
    expect(readDiagnostics().map((entry) => entry.message)).toEqual(['before']);
  });

  it('classifies pre-unlock failures without retaining their arbitrary text', () => {
    expect(diagnosticFailureCode(new Error('Wrong password or damaged encrypted data'))).toBe('password-or-encrypted-data');
    expect(diagnosticFailureCode(new Error('IndexedDB transaction failed'))).toBe('browser-storage');
    expect(diagnosticFailureCode(new Error('Attempting to change an outdated document'))).toBe('workspace-document');
    expect(diagnosticFailureCode(new Error('Title: private item text'))).toBe('unexpected');
  });
});
