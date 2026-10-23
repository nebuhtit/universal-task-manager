import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function databaseFixture() {
  const transactions: any[] = [], connections: any[] = [], opens: any[] = [];
  let completeWrites = false;
  vi.stubGlobal('indexedDB', { open: () => {
    const request: any = {}; opens.push(request);
    const db = { close: vi.fn(), transaction: vi.fn((_store: string, mode: string) => {
      const tx: any = { error: null, abort: vi.fn(() => { tx.onabort?.(); }), objectStore: () => ({ put: vi.fn(), delete: vi.fn(), get: () => ({}) }) };
      transactions.push(tx);
      if (completeWrites && mode === 'readwrite') queueMicrotask(() => tx.oncomplete?.());
      return tx;
    }) };
    connections.push(db); request.result = db;
    queueMicrotask(() => request.onsuccess?.()); return request;
  } });
  return { transactions, connections, opens, completeWrites: () => { completeWrites = true; } };
}
const plaintext = { storageMode: 'plaintext' as const, workspace: { version: 1 as const, mode: 'plaintext' as const, binary: new Uint8Array([1]) } };

it('aborts a stalled durable write and reconnects for a successful retry', async () => {
  const fixture = databaseFixture();
  const { commitPreparedLocalWorkspaceSave } = await import('./storage.js');
  const first = commitPreparedLocalWorkspaceSave(plaintext);
  const rejected = expect(first).rejects.toThrow(/aborted|timed out/);
  await vi.advanceTimersByTimeAsync(30_000);
  await rejected;
  expect(fixture.transactions[0].abort).toHaveBeenCalledOnce();
  expect(fixture.connections[0].close).toHaveBeenCalledOnce();
  fixture.completeWrites();
  await commitPreparedLocalWorkspaceSave(plaintext);
  expect(fixture.opens).toHaveLength(2);
});

it('rejects a stalled read during encrypted save rather than waiting forever', async () => {
  const fixture = databaseFixture();
  const { commitPreparedLocalWorkspaceSave } = await import('./storage.js');
  const save = commitPreparedLocalWorkspaceSave({ storageMode: 'encrypted', workspace: { version: 1, nonce: 'nonce', ciphertext: 'data' }, exportSafeWorkspace: { version: 1, nonce: 'nonce', ciphertext: 'safe' } });
  const rejected = expect(save).rejects.toThrow(/read aborted|read timed out/);
  await vi.advanceTimersByTimeAsync(30_000); await rejected;
  expect(fixture.transactions[0].abort).toHaveBeenCalledOnce();
  expect(fixture.connections[0].close).toHaveBeenCalledOnce();
});

it('times out opening the database and closes a late connection', async () => {
  const requests: any[] = [];
  vi.stubGlobal('indexedDB', { open: () => { const request = {}; requests.push(request); return request; } });
  const { commitPreparedLocalWorkspaceSave } = await import('./storage.js');
  const save = commitPreparedLocalWorkspaceSave(plaintext);
  const rejected = expect(save).rejects.toThrow('did not open in time');
  await vi.advanceTimersByTimeAsync(30_000); await rejected;
  const close = vi.fn(); requests[0].result = { close }; requests[0].onsuccess();
  expect(close).toHaveBeenCalledOnce();
});
