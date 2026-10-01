/// <reference lib="webworker" />
import { encodeRecoverySnapshot, workspaceForExport, type WorkspaceDocument } from '@utm/core';

type PersistenceRequest = {
  id: number;
  binary: Uint8Array;
  snapshotJson: string;
};

type PersistenceResponse =
  | { id: number; ok: true; binary: Uint8Array; exportSafeBinary?: Uint8Array; workerDurationMs: number; postedAt: number }
  | { id: number; ok: false; error: string };

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<PersistenceRequest>) => {
  const { id, binary, snapshotJson } = event.data;
  const startedAt = performance.now();
  const stage = (name: string, bytes?: number, durationMs?: number) => workerScope.postMessage({ id, stage: name, ...(bytes === undefined ? {} : { bytes }), ...(durationMs === undefined ? {} : { durationMs }) });
  try {
    // Preserve live history verbatim; encrypt and verify bytes before commit.
    // This worker has no WASM backend and never constructs a second CRDT.
    stage('export-filter-start');
    const filterStart = performance.now();
    // Parse here, avoiding a full object allocation and structured clone on UI.
    const safe = workspaceForExport(JSON.parse(snapshotJson) as WorkspaceDocument);
    stage('export-filter-end', undefined, performance.now() - filterStart);
    stage('export-encode-start');
    const encodeStart = performance.now();
    const exportSafeBinary = encodeRecoverySnapshot(safe);
    stage('export-encode-end', exportSafeBinary.byteLength, performance.now() - encodeStart);
    const response = { id, ok: true, binary, exportSafeBinary, workerDurationMs: performance.now() - startedAt, postedAt: Date.now() } satisfies PersistenceResponse;
    workerScope.postMessage(response, [binary.buffer, exportSafeBinary.buffer]);
  } catch {
    workerScope.postMessage({ id, ok: false, error: 'Recovery snapshot preparation failed' } satisfies PersistenceResponse);
  }
};

// Ready follows module imports and handler installation, before request work.
workerScope.postMessage({ ready: true, postedAt: Date.now() });
export {};
