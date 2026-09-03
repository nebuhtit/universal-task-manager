import { reconcileRecurrences, type ReconcileResult, type WorkspaceDocument } from '@utm/core';

type WorkerResponse = { id: number; ok: true; result: ReconcileResult } | { id: number; ok: false; error: string };
type PendingRequest = { resolve: (result: ReconcileResult) => void; reject: (reason: Error) => void; timeout: ReturnType<typeof setTimeout> };

const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const WORKER_TIMEOUT_MS = 8_000;
let worker: Worker | undefined;
let nextRequestId = 1;
const pending = new Map<number, PendingRequest>();

function rejectPending(message: string): void {
  const error = new Error(message);
  pending.forEach((request) => { clearTimeout(request.timeout); request.reject(error); });
  pending.clear();
}

function resetWorker(message?: string): void {
  if (message) rejectPending(message);
  worker?.terminate();
  worker = undefined;
}

function recurrenceWorker(): Worker | undefined {
  if (typeof Worker === 'undefined') return undefined;
  if (worker) return worker;
  worker = new Worker(new URL('../recurrence.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const request = pending.get(event.data.id);
    if (!request) return;
    pending.delete(event.data.id);
    clearTimeout(request.timeout);
    if (event.data.ok) request.resolve(event.data.result);
    else request.reject(new Error(event.data.error));
  };
  worker.onerror = () => resetWorker('Recurrence worker failed');
  return worker;
}

/**
 * Reuses one worker for every recurrence pass. Requests are identified rather
 * than tied to a short-lived worker, so activation and background clocks share
 * the same compiled module and WASM/runtime setup.
 */
export async function reconcileOffMainThread(workspace: WorkspaceDocument, now: Date): Promise<ReconcileResult> {
  const target = recurrenceWorker();
  if (!target) return await Promise.race([
    Promise.resolve().then(() => reconcileRecurrences(clean(workspace), now)),
    new Promise<ReconcileResult>((_, reject) => globalThis.setTimeout(() => reject(new Error('Recurrence reconciliation timed out')), WORKER_TIMEOUT_MS)),
  ]);
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      pending.delete(id);
      reject(new Error('Recurrence worker timed out'));
      resetWorker();
    }, WORKER_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timeout });
    try { target.postMessage({ id, workspace: clean(workspace), now: now.toISOString() }); }
    catch (reason) {
      clearTimeout(timeout);
      pending.delete(id);
      reject(reason instanceof Error ? reason : new Error(String(reason)));
    }
  });
}

