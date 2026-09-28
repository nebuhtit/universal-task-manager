import { afterEach, expect, it, vi } from 'vitest';
import { beginSyncTrace, beginPersistenceTrace, endSyncTrace, readSyncTrace, syncTrace } from './syncTrace';
afterEach(() => { endSyncTrace(false); vi.unstubAllGlobals(); });
function storage() {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
}
it('traces standalone saves independently from concurrent Google sync', () => {
  storage();
  const save = beginPersistenceTrace();
  save.trace('export-encode-end', { bytes: 123 });
  beginSyncTrace(); endSyncTrace(false);
  save.trace('indexeddb-end'); save.finish(false);
  const entries = readSyncTrace();
  expect(entries.at(-1)?.event).toBe('save-end');
  expect(entries.at(-1)?.run).toBe(entries[0]?.run);
  expect(entries.find(entry => entry.event === 'begin')?.run).not.toBe(entries[0]?.run);
});
it('persists bounded checkpoints and strips arbitrary metric content', () => {
  storage(); beginSyncTrace();
  syncTrace('worker-result', { patches: 2192, title: 'private', bytes: Infinity } as never);
  expect(readSyncTrace().at(-1)?.metrics).toMatchObject({ patches: 2192 });
  expect(JSON.stringify(readSyncTrace())).not.toContain('private');
  for (let i = 0; i < 250; i++) syncTrace('patch-write-progress', { processed: i });
  expect(readSyncTrace()).toHaveLength(240);
  endSyncTrace(false);
  expect(readSyncTrace().at(-1)?.event).toBe('end');
});
it('respects disabled diagnostics and survives unavailable storage', () => {
  storage(); localStorage.setItem('utm:diagnostics-enabled:v1', 'false');
  beginSyncTrace(); syncTrace('commit-start'); endSyncTrace(true);
  expect(readSyncTrace()).toEqual([]);
  vi.stubGlobal('localStorage', { getItem() { throw new Error('unavailable'); } });
  expect(() => { beginSyncTrace(); syncTrace('commit-start'); endSyncTrace(true); }).not.toThrow();
});
