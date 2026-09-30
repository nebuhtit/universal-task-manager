import * as Automerge from '@automerge/automerge';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createItem, createWorkspace, encodeRecoverySnapshot, workspaceForExport, type WorkspaceDocument } from '@utm/core';
import { createAutomergeDocument } from '@utm/sdk';

const ports = vi.hoisted(() => ({ prepare: vi.fn(async (binary: Uint8Array) => ({ binary })), commit: vi.fn(async () => undefined) }));
vi.mock('@utm/sdk', async original => ({ ...await original<typeof import('@utm/sdk')>(), prepareLocalWorkspaceSaveFromVerifiedBinaries: ports.prepare, commitPreparedLocalWorkspaceSave: ports.commit }));
beforeEach(() => { vi.resetModules(); ports.prepare.mockClear(); ports.commit.mockClear(); });
afterEach(() => vi.unstubAllGlobals());

function workerFixture() {
  class FakeWorker {
    static instances: FakeWorker[] = [];
    onmessage?: (event: { data: unknown }) => void;
    onerror?: () => void;
    onmessageerror?: () => void;
    terminate = vi.fn();
    failNext = false;
    constructor() { FakeWorker.instances.push(this); }
    postMessage(request: { id: number; binary: Uint8Array; snapshot: WorkspaceDocument }, transfer: Transferable[]) {
      const copy = structuredClone(request, { transfer });
      queueMicrotask(() => {
        if (this.failNext) { this.onerror?.(); return; }
        this.onmessage?.({ data: { ready: true, postedAt: Date.now() } });
        this.onmessage?.({ data: { id: copy.id, ok: true, binary: copy.binary, exportSafeBinary: encodeRecoverySnapshot(workspaceForExport(copy.snapshot)), workerDurationMs: 1, postedAt: Date.now() } });
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
