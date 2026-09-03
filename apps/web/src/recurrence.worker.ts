/// <reference lib="webworker" />
import { reconcileRecurrences, type WorkspaceDocument } from '@utm/core';

interface Request { id: number; workspace: WorkspaceDocument; now: string }

self.onmessage = (event: MessageEvent<Request>) => {
  try {
    const result = reconcileRecurrences(event.data.workspace, new Date(event.data.now));
    self.postMessage({ id: event.data.id, ok: true, result });
  } catch (error) {
    self.postMessage({ id: event.data.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
