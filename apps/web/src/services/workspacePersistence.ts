import * as Automerge from '@automerge/automerge';
import {
  commitPreparedLocalWorkspaceSave,
  prepareLocalWorkspaceSave,
  prepareLocalWorkspaceSaveFromVerifiedBinaries,
  type PreparedLocalWorkspaceSave,
  type UnlockedWorkspace,
} from '@utm/sdk';
import { type WorkspaceDocument } from '@utm/core';
import { persistObsidianWorkspace } from './obsidianBridge';
import { beginPersistenceTrace } from './syncTrace';
import { beginProfileSpan, currentProfileActionId, recordProfileCache, recordProfileSpan, recordWorkerProfileSpan } from './performanceProfile';
type SaveTrace = ReturnType<typeof beginPersistenceTrace>['trace'];

type PersistenceResponse =
  | { ready: true; postedAt: number }
  | { id: number; stage: 'export-filter-start' | 'export-filter-end' | 'export-encode-start' | 'export-encode-end'; bytes?: number; durationMs?: number }
  | { id: number; ok: true; binary: Uint8Array; exportSafeBinary?: Uint8Array; workerDurationMs?: number; postedAt?: number }
  | { id: number; ok: false; error: string };

let worker: Worker | undefined;
let nextRequestId = 1;
const requests = new Map<number, { trace: SaveTrace; actionId: number | null; resolve: (value: { binary: Uint8Array; exportSafeBinary?: Uint8Array }) => void; reject: (reason: Error) => void }>();
const WORKER_PREPARE_TIMEOUT_MS = 15_000;
type VerifiedBinaries = { binary: Uint8Array; exportSafeBinary?: Uint8Array };
// One immutable snapshot only, weakly held and bounded in bytes. Never retain
// keys or treat a cache hit as a durable write. Large documents still save normally.
const MAX_PREPARATION_CACHE_BYTES = 16 * 1024 * 1024;
let preparedSnapshots = new WeakMap<UnlockedWorkspace['document'], VerifiedBinaries>();
let lastPrepared: { document: WeakRef<UnlockedWorkspace['document']>; heads: string } | undefined;

async function encryptSnapshot(verified: VerifiedBinaries, session: UnlockedWorkspace, trace: SaveTrace) {
  const dataKey = session.dataKey.slice();
  try {
    trace('encrypt-start');
    const result = await prepareLocalWorkspaceSaveFromVerifiedBinaries(verified.binary, verified.exportSafeBinary, dataKey, session.storageMode);
    trace('encrypt-end');
    return result;
  } finally { dataKey.fill(0); }
}

const resetWorkspaceWorker = (reason: Error) => {
  requests.forEach(({ reject }) => reject(reason));
  requests.clear();
  worker?.terminate();
  worker = undefined;
};

const workspaceWorker = (actionId: number | null): Worker | undefined => {
  if (typeof Worker === 'undefined') return undefined;
  if (worker) return worker;
  const finishStartup = beginProfileSpan('save.worker-startup', actionId);
  const target = new Worker(new URL('../workspacePersistence.worker.ts', import.meta.url), { type: 'module' });
  worker = target;
  let ready = false;
  target.onmessage = (event: MessageEvent<PersistenceResponse>) => {
    if (worker !== target) return;
    if ('ready' in event.data) { ready = true; finishStartup(); return; }
    const request = requests.get(event.data.id);
    if (!request) return;
    if ('stage' in event.data) {
      request.trace(event.data.stage, { ...(event.data.bytes === undefined ? {} : { bytes: event.data.bytes }), ...(event.data.durationMs === undefined ? {} : { durationMs: event.data.durationMs }) });
      return;
    }
    requests.delete(event.data.id);
    if (event.data.ok) {
      // Same-device wall clock: receive minus post, not worker CPU time.
      // Ignore clock adjustments or malformed values rather than exporting them.
      if (event.data.postedAt !== undefined) {
        const deliveryMs = Date.now() - event.data.postedAt;
        if (Number.isFinite(deliveryMs) && deliveryMs >= 0 && deliveryMs < WORKER_PREPARE_TIMEOUT_MS) recordProfileSpan('save.worker-delivery', deliveryMs, {}, request.actionId);
      }
      if (event.data.workerDurationMs !== undefined) recordWorkerProfileSpan('save.worker-work', event.data.workerDurationMs, {}, request.actionId);
      request.resolve({ binary: event.data.binary, ...(event.data.exportSafeBinary ? { exportSafeBinary: event.data.exportSafeBinary } : {}) });
    }
    else { request.trace('storage-worker-calculation-failed'); request.reject(new Error(event.data.error)); }
    // This worker only filters/encodes JSON; it no longer loads a WASM document.
    // Reuse the module between saves, with no retained snapshots or binaries.
  };
  target.onerror = () => {
    if (worker !== target) return;
    requests.forEach(request => request.trace(ready ? 'storage-worker-runtime-failed' : 'storage-worker-load-failed'));
    resetWorkspaceWorker(new Error('Workspace persistence worker failed'));
  };
  target.onmessageerror = () => {
    if (worker !== target) return;
    requests.forEach(request => request.trace('storage-worker-message-failed'));
    resetWorkspaceWorker(new Error('Workspace persistence worker response failed'));
  };
  return target;
};

async function prepareOffMainThread(session: UnlockedWorkspace, syncTrace: SaveTrace, actionId: number | null): Promise<PreparedLocalWorkspaceSave> {
  const heads = JSON.stringify(Automerge.getHeads(session.document).sort());
  const previous = lastPrepared?.heads === heads ? lastPrepared.document.deref() : undefined;
  // Equal Automerge heads identify the same immutable history, including when
  // recovery/activation returned another JS wrapper. Encryption and commit still
  // run for every write, with the current key and storage mode.
  const cached = preparedSnapshots.get(session.document) ?? (previous ? preparedSnapshots.get(previous) : undefined);
  recordProfileCache('save.snapshot', Boolean(cached), cached ? 'unchanged' : 'workspace-reference');
  if (cached) return encryptSnapshot(cached, session, syncTrace);
  // Evict even on failure: A -> B -> A must not accumulate old snapshots.
  preparedSnapshots = new WeakMap();
  lastPrepared = undefined;
  let target: Worker | undefined;
  try { target = workspaceWorker(actionId); } catch { target = undefined; }
  if (!target) { syncTrace('storage-fallback'); return await prepareLocalWorkspaceSave(session.document, session.dataKey, session.storageMode); }
  const id = nextRequestId++;
  // Transfer the compressed document with its history instead of replaying
  // every historical operation into an empty document on each save.
  syncTrace('serialize-start');
  const binary = Automerge.save(session.document as Automerge.Doc<WorkspaceDocument>);
  syncTrace('serialize-end', { bytes: binary.byteLength });
  // Only current values go to the filtering worker. The original serialized
  // history is preserved verbatim, never loaded into a second WASM backend.
  syncTrace('snapshot-start');
  const snapshotJson = JSON.stringify(session.document);
  syncTrace('snapshot-end', { items: Object.keys(session.document.items).length });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    syncTrace('storage-worker-start');
    const verified = await new Promise<{ binary: Uint8Array; exportSafeBinary?: Uint8Array }>((resolve, reject) => {
      timeout = setTimeout(() => {
        syncTrace('save-timeout');
        requests.delete(id);
        const error = new Error('Workspace persistence worker timed out');
        resetWorkspaceWorker(error);
        reject(error);
      }, WORKER_PREPARE_TIMEOUT_MS);
      requests.set(id, { resolve, reject, trace: syncTrace, actionId });
      try {
        const finishTransfer = beginProfileSpan('save.transfer', actionId);
        try { target.postMessage({ id, binary, snapshotJson }, [binary.buffer]); }
        finally { finishTransfer(); }
      } catch (reason) {
        syncTrace('storage-worker-transfer-failed');
        requests.delete(id);
        if (timeout) clearTimeout(timeout);
        reject(reason instanceof Error ? reason : new Error(String(reason)));
      }
    });
    if (timeout) clearTimeout(timeout);
    syncTrace('storage-worker-end');
    const prepared = await encryptSnapshot(verified, session, syncTrace);
    if (verified.binary.byteLength + (verified.exportSafeBinary?.byteLength ?? 0) <= MAX_PREPARATION_CACHE_BYTES) {
      preparedSnapshots.set(session.document, verified);
      lastPrepared = { document: new WeakRef(session.document), heads };
    }
    return prepared;
  } catch (reason) {
    syncTrace('storage-fallback');
    if (timeout) clearTimeout(timeout);
    // Retrying the same memory-heavy work on the UI thread after a worker
    // failure can kill WebKit. Keep the old durable record and let the existing
    // persistence queue retain the unsaved document for an explicit retry.
    resetWorkspaceWorker(new Error('Workspace persistence worker stopped'));
    throw new Error('Workspace save preparation failed. Existing saved data is retained; retry saving.');
  }
}

let persistenceTail: Promise<void> = Promise.resolve();
let pendingTail: { session: UnlockedWorkspace; promise: Promise<void> } | undefined;
export function persistWorkspace(session: UnlockedWorkspace, actionId: number | null = currentProfileActionId() ?? null): Promise<void> {
  // Share only adjacent, still-pending writes of the exact immutable document.
  // Never reuse completed writes: A -> B -> A must still persist in that order,
  // and a failed write must remain retryable. All callers await the durable commit.
  if (pendingTail && pendingTail.session.document === session.document
    && pendingTail.session.dataKey === session.dataKey
    && pendingTail.session.storageMode === session.storageMode) return pendingTail.promise;
  const captured = { ...session };
  const enqueuedAt = performance.now();
  const next = persistenceTail.then(() => { recordProfileSpan('save.serial-queue', performance.now() - enqueuedAt, {}, actionId); return persistWorkspaceInOrder(captured, actionId); });
  const entry = { session: captured, promise: next };
  pendingTail = entry;
  const clear = () => { if (pendingTail === entry) pendingTail = undefined; };
  void next.then(clear, clear);
  persistenceTail = next.catch(() => undefined);
  return next;
}

async function persistWorkspaceInOrder(session: UnlockedWorkspace, actionId: number | null): Promise<void> {
  const log = beginPersistenceTrace(actionId);
  const syncTrace = log.trace;
  let failed = true;
  try {
    const preparation = beginProfileSpan('save.prepare', actionId);
    let prepared: PreparedLocalWorkspaceSave;
    try { prepared = await prepareOffMainThread(session, syncTrace, actionId); preparation(); }
    catch (reason) { preparation({ failed: 1 }); throw reason; }
    prepared.receipt = { sourceUpdatedAt: String(session.document.updatedAt), sourceItemCount: Object.keys(session.document.items).length, sourceHeads: Automerge.getHeads(session.document) };
    syncTrace('indexeddb-start');
    await commitPreparedLocalWorkspaceSave(prepared);
    syncTrace('indexeddb-end');
    syncTrace('mirror-start');
    if (session.storageMode !== 'plaintext') await persistObsidianWorkspace();
    syncTrace('mirror-end');
    failed = false;
  } finally { log.finish(failed); }
}

export type PersistenceOperation = { session: UnlockedWorkspace; message: string; startedAt: number; profileActionId?: number | null };

/**
 * Debounced, latest-wins persistence. At most one durable write is active;
 * changes arriving during it collapse into one following write.
 */
export class LatestPersistenceQueue<T> {
  private pending: T | undefined;
  private active: Promise<void> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failed = false;
  private enqueuedAt = 0;
  private actionId: number | null = null;
  private coalesced = 0;

  constructor(
    private readonly persist: (value: T) => Promise<void>,
    private readonly onSuccess: (value: T) => void,
    private readonly onFailure: (reason: unknown, value: T) => void,
    private readonly debounceMs = 80,
    private readonly profileActionIdForValue?: (value: T) => number | null,
  ) {}

  enqueue(value: T): void {
    if (this.pending !== undefined) this.coalesced++;
    this.enqueuedAt = performance.now();
    this.actionId = this.profileActionIdForValue ? this.profileActionIdForValue(value) : currentProfileActionId() ?? null;
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
    const actionId = this.actionId;
    recordProfileSpan('save.queue', performance.now() - this.enqueuedAt, { coalesced: this.coalesced }, actionId);
    this.coalesced = 0;
    this.pending = undefined;
    const task = this.persist(value);
    this.active = task;
    void task.then(() => {
      this.onSuccess(value);
      this.failed = false;
    }, (reason) => {
      // A newer optimistic state supersedes a failed older write. Otherwise
      // retain this value so the next edit or explicit flush can retry it.
      if (this.pending === undefined) { this.pending = value; this.enqueuedAt = performance.now(); this.actionId = actionId; }
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
    this.coalesced = 0;
  }
}
