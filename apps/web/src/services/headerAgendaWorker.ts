import type { WorkspaceDocument } from '@utm/core';
import type { HeaderAgenda } from '../components/layout/headerAgendaModel';
import { beginProfileSpan, measureProfile, recordWorkerProfileSpan } from './performanceProfile';

export type HeaderAgendaInput = { key: string; workspace: WorkspaceDocument };
type Response = { id: number; ok: true; agenda: HeaderAgenda; durationMs: number } | { id: number; ok: false };

/** Detached selection inputs only: no Google credentials, history or editor data. */
export function headerAgendaInput(workspace: WorkspaceDocument): HeaderAgendaInput {
  return measureProfile('agenda.header-input', () => {
    const items = Object.fromEntries(Object.entries(workspace.items).map(([id, item]) => [id, {
      id: item.id, title: item.title, state: item.state, role: item.role, deletedAt: item.deletedAt,
      schedule: item.schedule, recurrence: item.recurrence, occurrence: item.occurrence,
      recurrenceOverride: item.recurrenceOverride && { kind: item.recurrenceOverride.kind },
      eventProgram: item.eventProgram, reminders: [],
    }]));
    const key = JSON.stringify({ workspaceId: workspace.workspaceId, items, tombstones: workspace.tombstones,
      calendarPreferences: { appearance: { headerDueMode: workspace.calendarPreferences.appearance.headerDueMode },
        timeline: { sleepItemId: workspace.calendarPreferences.timeline?.sleepItemId } } });
    return { key, workspace: JSON.parse(key) as WorkspaceDocument };
  });
}

/** One worker, one active calculation, one latest desired input. Never blocks rendering. */
export function createHeaderAgendaRunner(
  onResult: (agenda: HeaderAgenda, workspaceId: string) => void,
  onFailure: () => void,
) {
  let worker: Worker | undefined;
  let desired: { input: HeaderAgendaInput; now: number } | undefined;
  let cached: { key: string; at: number; agenda: HeaderAgenda } | undefined;
  let pending: { id: number; key: string; at: number; finish: ReturnType<typeof beginProfileSpan> } | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let nextId = 0, retryAfter = 0, disposed = false;
  const stop = () => { if (timeout) clearTimeout(timeout); timeout = undefined; worker?.terminate(); worker = undefined; };
  const fail = () => {
    stop(); pending?.finish({ failed: 1 }); pending = undefined;
    retryAfter = performance.now() + 10_000;
    onFailure();
  };
  const pump = () => {
    if (disposed || pending || !desired || performance.now() < retryAfter) return;
    const { input, now } = desired;
    if (cached?.key === input.key && now >= cached.at && now < cached.agenda.validUntil) return;
    const id = ++nextId;
    pending = { id, key: input.key, at: now, finish: beginProfileSpan('agenda.header-wait') };
    try {
      if (!worker) {
        const target = new Worker(new URL('../headerAgenda.worker.ts', import.meta.url), { type: 'module' });
        worker = target;
        target.onmessage = (event: MessageEvent<Response>) => {
          if (disposed || worker !== target || !pending || event.data.id !== pending.id) return;
          if (!event.data.ok) { fail(); return; }
          const request = pending;
          if (timeout) clearTimeout(timeout); timeout = undefined; pending = undefined;
          request.finish();
          recordWorkerProfileSpan('agenda.header', event.data.durationMs, {}, null);
          // Superseded work and results from before a clock rewind never replace the display.
          if (desired?.input.key === request.key && desired.now >= request.at && desired.now < event.data.agenda.validUntil) {
            cached = { key: request.key, at: request.at, agenda: event.data.agenda };
            onResult(event.data.agenda, desired.input.workspace.workspaceId);
          }
          pump();
        };
        target.onerror = target.onmessageerror = () => { if (!disposed && worker === target) fail(); };
      }
      timeout = setTimeout(fail, 60_000);
      worker.postMessage({ id, workspace: input.workspace, now });
    } catch { fail(); }
  };
  return {
    update(input: HeaderAgendaInput, now: number) { if (disposed) return; desired = { input, now }; pump(); },
    dispose() { disposed = true; stop(); pending = undefined; desired = undefined; cached = undefined; },
  };
}
