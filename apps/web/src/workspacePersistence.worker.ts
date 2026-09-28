/// <reference lib="webworker" />
import { encodeRecoverySnapshot, workspaceForExport, type WorkspaceDocument } from '@utm/core';

type PersistenceRequest = {
  id: number;
  binary: Uint8Array;
  snapshot: WorkspaceDocument;
};

type PersistenceResponse =
  | { id: number; ok: true; binary: Uint8Array; exportSafeBinary?: Uint8Array }
  | { id: number; ok: false; error: string };

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<PersistenceRequest>) => {
  const { id, binary, snapshot } = event.data;
  const stage = (name: string, bytes?: number) => workerScope.postMessage({ id, stage: name, ...(bytes === undefined ? {} : { bytes }) });
  try {
    // Preserve live history verbatim; encrypt and verify bytes before commit.
    // This worker has no WASM backend and never constructs a second CRDT.
    stage('export-filter-start');
    const safe = workspaceForExport(snapshot);
    stage('export-filter-end');
    stage('export-encode-start');
    const exportSafeBinary = encodeRecoverySnapshot(safe);
    stage('export-encode-end', exportSafeBinary.byteLength);
    const response = { id, ok: true, binary, exportSafeBinary } satisfies PersistenceResponse;
    workerScope.postMessage(response, [binary.buffer, exportSafeBinary.buffer]);
  } catch {
    workerScope.postMessage({ id, ok: false, error: 'Recovery snapshot preparation failed' } satisfies PersistenceResponse);
  }
};

export {};
