/// <reference lib="webworker" />
import * as Automerge from '@automerge/automerge/slim';
import automergeWasmUrl from '@automerge/automerge/automerge.wasm?url';
import type { WorkspaceDocument } from '@utm/core';
import { persistenceExportSafeSnapshot } from './services/persistencePrivacy';

type PersistenceRequest = {
  id: number;
  changes: Uint8Array[];
};

type PersistenceResponse =
  | { id: number; ok: true; binary: Uint8Array; exportSafeBinary?: Uint8Array }
  | { id: number; ok: false; error: string };

const workerScope = self as unknown as DedicatedWorkerGlobalScope;
const automergeReady = Automerge.initializeWasm(automergeWasmUrl);

workerScope.onmessage = (event: MessageEvent<PersistenceRequest>) => {
  const { id, changes } = event.data;
  void (async () => {
    try {
      await automergeReady;
      const [document] = Automerge.applyChanges(Automerge.init<WorkspaceDocument>(), changes);
      const binary = Automerge.save(document);
      Automerge.load<WorkspaceDocument>(binary);
      let exportSafeBinary: Uint8Array | undefined;
      const exportSafeSnapshot = persistenceExportSafeSnapshot(document, changes);
      if (exportSafeSnapshot) {
        exportSafeBinary = Automerge.save(Automerge.from(exportSafeSnapshot as unknown as Record<string, unknown>) as unknown as Automerge.Doc<WorkspaceDocument>);
        Automerge.load<WorkspaceDocument>(exportSafeBinary);
      }
      const response = { id, ok: true, binary, ...(exportSafeBinary ? { exportSafeBinary } : {}) } satisfies PersistenceResponse;
      workerScope.postMessage(response, [binary.buffer, ...(exportSafeBinary ? [exportSafeBinary.buffer] : [])]);
    } catch (reason) {
      workerScope.postMessage({ id, ok: false, error: reason instanceof Error ? reason.message : String(reason) } satisfies PersistenceResponse);
    }
  })();
};

export {};
