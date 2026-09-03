import * as Automerge from '@automerge/automerge';
import {
  commitPreparedLocalWorkspaceSave,
  prepareLocalWorkspaceSave,
  prepareLocalWorkspaceSaveFromVerifiedBinaries,
  type PreparedLocalWorkspaceSave,
  type UnlockedWorkspace,
} from '@utm/sdk';
import type { WorkspaceDocument } from '@utm/core';

type PersistenceResponse =
  | { id: number; ok: true; binary: Uint8Array; exportSafeBinary?: Uint8Array }
  | { id: number; ok: false; error: string };

let worker: Worker | undefined;
let nextRequestId = 1;
const requests = new Map<number, { resolve: (value: { binary: Uint8Array; exportSafeBinary?: Uint8Array }) => void; reject: (reason: Error) => void }>();

const workspaceWorker = (): Worker | undefined => {
  if (typeof Worker === 'undefined') return undefined;
  if (worker) return worker;
  worker = new Worker(new URL('../workspacePersistence.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<PersistenceResponse>) => {
    const request = requests.get(event.data.id);
    if (!request) return;
    requests.delete(event.data.id);
    if (event.data.ok) request.resolve({ binary: event.data.binary, ...(event.data.exportSafeBinary ? { exportSafeBinary: event.data.exportSafeBinary } : {}) });
    else request.reject(new Error(event.data.error));
  };
  worker.onerror = () => {
    const error = new Error('Workspace persistence worker failed');
    requests.forEach(({ reject }) => reject(error));
    requests.clear();
    worker?.terminate();
    worker = undefined;
  };
  return worker;
};

async function prepareOffMainThread(session: UnlockedWorkspace): Promise<PreparedLocalWorkspaceSave> {
  const target = workspaceWorker();
  if (!target) return await prepareLocalWorkspaceSave(session.document, session.dataKey, session.storageMode);
  const id = nextRequestId++;
  // getAllChanges preserves the complete Automerge history. The expensive full
  // snapshot serialization, privacy-safe projection and Automerge round-trip
  // validations happen in the worker.
  const changes = Automerge.getAllChanges(session.document as Automerge.Doc<WorkspaceDocument>).map((change) => change.slice());
  const dataKey = session.dataKey.slice();
  try {
    const verified = await new Promise<{ binary: Uint8Array; exportSafeBinary?: Uint8Array }>((resolve, reject) => {
      requests.set(id, { resolve, reject });
      try {
        target.postMessage(
          { id, changes },
          changes.map((change) => change.buffer),
        );
      } catch (reason) {
        requests.delete(id);
        reject(reason instanceof Error ? reason : new Error(String(reason)));
      }
    });
    return await prepareLocalWorkspaceSaveFromVerifiedBinaries(
      verified.binary,
      verified.exportSafeBinary,
      dataKey,
      session.storageMode,
    );
  } finally {
    dataKey.fill(0);
  }
}

export async function persistWorkspace(session: UnlockedWorkspace): Promise<void> {
  const prepared = await prepareOffMainThread(session);
  await commitPreparedLocalWorkspaceSave(prepared);
}

export type PersistenceOperation = { session: UnlockedWorkspace; message: string; startedAt: number };

/**
 * Debounced, latest-wins persistence. At most one durable write is active;
 * changes arriving during it collapse into one following write.
 */
export class LatestPersistenceQueue<T> {
  private pending: T | undefined;
  private active: Promise<void> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failed = false;

  constructor(
    private readonly persist: (value: T) => Promise<void>,
    private readonly onSuccess: (value: T) => void,
    private readonly onFailure: (reason: unknown, value: T) => void,
    private readonly debounceMs = 80,
  ) {}

  enqueue(value: T): void {
    this.pending = value;
    this.failed = false;
    if (!this.active) this.schedule();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.start().catch(() => undefined);
    }, this.debounceMs);
  }

  private start(): Promise<void> {
    if (this.active) return this.active;
    const value = this.pending;
    if (value === undefined) return Promise.resolve();
    this.pending = undefined;
    const task = this.persist(value);
    this.active = task;
    void task.then(() => {
      this.onSuccess(value);
      this.failed = false;
    }, (reason) => {
      // A newer optimistic state supersedes a failed older write. Otherwise
      // retain this value so the next edit or explicit flush can retry it.
      if (this.pending === undefined) this.pending = value;
      this.failed = true;
      this.onFailure(reason, value);
    }).finally(() => {
      if (this.active === task) this.active = undefined;
      if (this.pending !== undefined && !this.failed) this.schedule();
    });
    return task;
  }

  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    this.failed = false;
    while (this.active || this.pending !== undefined) {
      if (this.active) await this.active;
      else await this.start();
    }
  }

  clearPending(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
    this.failed = false;
  }
}
