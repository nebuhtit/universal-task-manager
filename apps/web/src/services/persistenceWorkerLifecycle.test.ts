import * as Automerge from '@automerge/automerge';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createItem, createWorkspace, encodeRecoverySnapshot, workspaceForExport, type WorkspaceDocument } from '@utm/core';
import { createAutomergeDocument } from '@utm/sdk';

const ports = vi.hoisted(() => ({ prepare: vi.fn(async (binary: Uint8Array) => ({ binary })), commit: vi.fn(async (): Promise<void> => undefined) }));
vi.mock('@utm/sdk', async original => ({ ...await original<typeof import('@utm/sdk')>(), prepareLocalWorkspaceSaveFromVerifiedBinaries: ports.prepare, commitPreparedLocalWorkspaceSave: ports.commit }));
beforeEach(() => { vi.resetModules(); ports.prepare.mockClear(); ports.commit.mockClear(); });
afterEach(() => vi.unstubAllGlobals());

it('shares adjacent pending saves but waits for the durable write and retries after completion', async () => {
  workerFixture();
  const { persistWorkspace } = await import('./workspacePersistence');
  const session = { document: createAutomergeDocument(createWorkspace('test')), dataKey: new Uint8Array(32) };
  let release!: () => void;
  ports.commit.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  const first = persistWorkspace(session);
  const duplicate = persistWorkspace({ ...session });
  expect(duplicate).toBe(first);
  let settled = false;
  void duplicate.then(() => { settled = true; });
  await vi.waitFor(() => expect(ports.commit).toHaveBeenCalledTimes(1));
  expect(settled).toBe(false);
  expect(ports.prepare).toHaveBeenCalledTimes(1);
  release();
  await duplicate;
  await persistWorkspace(session);
  expect(ports.commit).toHaveBeenCalledTimes(2);
  Automerge.free(session.document);
});

it('preserves A B A order and does not share writes across keys or storage modes', async () => {
  workerFixture();
  const { persistWorkspace } = await import('./workspacePersistence');
  const a = createAutomergeDocument(createWorkspace('test'));
  const b = Automerge.change(Automerge.clone(a), draft => { draft.name = 'changed'; });
  const dataKey = new Uint8Array(32);
  const writes = [
    persistWorkspace({ document: a, dataKey }),
    persistWorkspace({ document: b, dataKey }),
    persistWorkspace({ document: a, dataKey }),
    persistWorkspace({ document: a, dataKey: new Uint8Array(32) }),
    persistWorkspace({ document: a, dataKey, storageMode: 'plaintext' }),
  ];
  await Promise.all(writes);
  expect(ports.commit).toHaveBeenCalledTimes(5);
  const heads = ports.prepare.mock.calls.slice(0, 3).map(([binary]) => {
    const loaded = Automerge.load(binary);
    const result = Automerge.getHeads(loaded);
    Automerge.free(loaded);
    return result;
  });
  expect(heads).toEqual([Automerge.getHeads(a), Automerge.getHeads(b), Automerge.getHeads(a)]);
  Automerge.free(a); Automerge.free(b);
});

it('rejects every shared caller on write failure and permits a fresh retry', async () => {
  workerFixture();
  const { persistWorkspace } = await import('./workspacePersistence');
  const session = { document: createAutomergeDocument(createWorkspace('test')), dataKey: new Uint8Array(32) };
  ports.commit.mockRejectedValueOnce(new Error('write failed'));
  const first = persistWorkspace(session);
  const duplicate = persistWorkspace(session);
  const outcomes = await Promise.allSettled([first, duplicate]);
  expect(outcomes.map(result => result.status)).toEqual(['rejected', 'rejected']);
  expect(ports.prepare).toHaveBeenCalledTimes(1);
  await persistWorkspace(session);
  expect(ports.prepare).toHaveBeenCalledTimes(2);
  expect(ports.commit).toHaveBeenCalledTimes(2);
  Automerge.free(session.document);
});

function workerFixture() {
  class FakeWorker {
    static instances: FakeWorker[] = [];
    onmessage?: (event: { data: unknown }) => void;
    onerror?: () => void;
    onmessageerror?: () => void;
    terminate = vi.fn();
    failNext = false;
    constructor() { FakeWorker.instances.push(this); }
    postMessage(request: { id: number; binary: Uint8Array; snapshotJson: string }, transfer: Transferable[]) {
      const copy = structuredClone(request, { transfer });
      queueMicrotask(() => {
        if (this.failNext) { this.onerror?.(); return; }
        this.onmessage?.({ data: { ready: true, postedAt: Date.now() } });
        this.onmessage?.({ data: { id: copy.id, ok: true, binary: copy.binary, exportSafeBinary: encodeRecoverySnapshot(workspaceForExport(JSON.parse(copy.snapshotJson) as WorkspaceDocument)), workerDurationMs: 1, postedAt: Date.now() } });
      });
    }
  }
  vi.stubGlobal('Worker', FakeWorker);
  return FakeWorker;
}

it('reuses the JSON worker across saves and preserves the latest Automerge history', async () => {
  const Worker = workerFixture();
  const { persistWorkspace } = await import('./workspacePersistence');
  let document = createAutomergeDocument(createWorkspace('test'));
  const dataKey = new Uint8Array(32);
  await persistWorkspace({ document, dataKey });
  document = Automerge.change(document, draft => { const item = createItem('new'); draft.items[item.id] = item; });
  await persistWorkspace({ document, dataKey });
  expect(Worker.instances).toHaveLength(1);
  expect(Worker.instances[0]!.terminate).not.toHaveBeenCalled();
  expect(ports.commit).toHaveBeenCalledTimes(2);
  const saved = ports.prepare.mock.lastCall![0];
  const loaded = Automerge.load(saved);
  expect(Automerge.getHeads(loaded)).toEqual(Automerge.getHeads(document));
  expect(Automerge.getAllChanges(loaded)).toEqual(Automerge.getAllChanges(document));
  Automerge.free(loaded); Automerge.free(document);
});

it('rejects a failed worker without durable writes and ignores its late errors after retry', async () => {
  const Worker = workerFixture();
  const originalPost = Worker.prototype.postMessage;
  let first = true;
  Worker.prototype.postMessage = function (request, transfer) { this.failNext = first; first = false; originalPost.call(this, request, transfer); };
  const { persistWorkspace } = await import('./workspacePersistence');
  const session = { document: createAutomergeDocument(createWorkspace('test')), dataKey: new Uint8Array(32) };
  await expect(persistWorkspace(session)).rejects.toThrow('Existing saved data is retained');
  expect(ports.commit).not.toHaveBeenCalled();
  await persistWorkspace(session);
  expect(ports.commit).toHaveBeenCalledTimes(1);
  Worker.instances[0]!.onerror?.();
  await persistWorkspace(session);
  expect(Worker.instances).toHaveLength(2);
  expect(Worker.instances[1]!.terminate).not.toHaveBeenCalled();
  expect(ports.commit).toHaveBeenCalledTimes(2);
  Automerge.free(session.document);
});
