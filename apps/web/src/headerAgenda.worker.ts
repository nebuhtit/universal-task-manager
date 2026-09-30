/// <reference lib="webworker" />
import type { WorkspaceDocument } from '@utm/core';
import { selectHeaderAgenda } from './components/layout/headerAgendaModel';

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (event: MessageEvent<{ id: number; workspace: WorkspaceDocument; now: number }>) => {
  const { id, workspace, now } = event.data;
  const start = performance.now();
  try {
    const agenda = selectHeaderAgenda(workspace, now);
    scope.postMessage({ id, ok: true, agenda, durationMs: performance.now() - start });
  } catch { scope.postMessage({ id, ok: false }); }
};
