/// <reference lib="webworker" />
import * as Automerge from '@automerge/automerge/slim';
import automergeWasmUrl from '@automerge/automerge/automerge.wasm?url';
import type { WorkspaceDocument } from '@utm/core';
import { persistenceExportSafeSnapshot } from './services/persistencePrivacy';

type PersistenceRequest = {
  id: number;
  binary: Uint8Array;
};

type PersistenceResponse =
  | { id: number; ok: true; binary: Uint8Array; exportSafeBinary?: Uint8Array }
  | { id: number; ok: false; error: string };

const workerScope = self as unknown as DedicatedWorkerGlobalScope;
const automergeReady = Automerge.initializeWasm(automergeWasmUrl);

workerScope.onmessage = (event: MessageEvent<PersistenceRequest>) => {
  const { id, binary } = event.data;
  void (async () => {
    try {
      await automergeReady;
      const document = Automerge.load<WorkspaceDocument>(binary);
      try {
      let exportSafeBinary: Uint8Array | undefined;
      const exportSafeSnapshot = persistenceExportSafeSnapshot(document, Automerge.getAllChanges(document));
      if (exportSafeSnapshot) {
        const safeDocument = Automerge.from(exportSafeSnapshot as unknown as Record<string, unknown>);
        try { exportSafeBinary = Automerge.save(safeDocument); }
        finally { Automerge.free(safeDocument); }
        const verified = Automerge.load<WorkspaceDocument>(exportSafeBinary);
        Automerge.free(verified);
      }
      const response = { id, ok: true, binary, ...(exportSafeBinary ? { exportSafeBinary } : {}) } satisfies PersistenceResponse;
      workerScope.postMessage(response, [binary.buffer, ...(exportSafeBinary ? [exportSafeBinary.buffer] : [])]);
      } finally { Automerge.free(document); }
    } catch (reason) {
      workerScope.postMessage({ id, ok: false, error: reason instanceof Error ? reason.message : String(reason) } satisfies PersistenceResponse);
    }
  })();
};

export {};
