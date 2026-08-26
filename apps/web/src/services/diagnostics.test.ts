import { beforeEach, describe, expect, it } from 'vitest';
import { DIAGNOSTICS_KEY, readDiagnostics, recordDiagnostic } from './diagnostics';

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

  it('records bounded operational results without requiring application state', () => {
    recordDiagnostic({ kind: 'result', message: 'saved', operation: 'Update item', outcome: 'succeeded', durationMs: 12, details: 'x'.repeat(5_000) });
    const [entry] = readDiagnostics();
    expect(entry).toMatchObject({ kind: 'result', message: 'saved', operation: 'Update item', outcome: 'succeeded', durationMs: 12 });
    expect(entry?.details).toHaveLength(4_000);
    expect(JSON.parse(localStorage.getItem(DIAGNOSTICS_KEY) ?? '[]')).toHaveLength(1);
  });

  it('retains only the latest 500 entries', () => {
    for (let index = 0; index < 505; index += 1) recordDiagnostic({ kind: 'action', message: String(index) });
    const entries = readDiagnostics();
    expect(entries).toHaveLength(500);
    expect(entries[0]?.message).toBe('5');
  });
});
