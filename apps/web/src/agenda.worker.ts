/// <reference lib="webworker" />
import { agendaWidgetSnapshot } from './services/nativeAgendaWidget';
import { agendaWidgetWorkspace } from './services/agendaWorker';
import type { WorkspaceDocument } from '@utm/core';
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (event: MessageEvent<{ workspace: WorkspaceDocument; now: number }>) => {
  const start = performance.now();
  try {
    const snapshot = agendaWidgetSnapshot(agendaWidgetWorkspace(event.data.workspace, event.data.now), event.data.now);
    scope.postMessage({ ok: true, snapshot, durationMs: performance.now() - start });
  }
  catch { scope.postMessage({ ok: false }); }
};
