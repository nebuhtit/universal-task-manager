import type { WorkspaceDocument } from '@utm/core';
import type { agendaWidgetSnapshot } from './nativeAgendaWidget';
import { recordDiagnostic } from './diagnostics';

/** Include every input read by the agenda and recurrence projection, not editor metadata. */
export function agendaInput(workspace: WorkspaceDocument): { key: string; workspace: WorkspaceDocument } {
  const items = Object.fromEntries(Object.entries(workspace.items).map(([id, item]) => [id, {
    id: item.id, title: item.title, state: item.state, role: item.role,
    deletedAt: item.deletedAt,
    schedule: item.schedule && Object.fromEntries(['startAt', 'endAt', 'dueAt', 'timezone', 'plannedDate', 'allDay', 'dueDateOnly', 'travelDuration', 'travelBackDuration'].map(key => [key, item.schedule![key as keyof typeof item.schedule]])),
    recurrence: item.recurrence,
    occurrence: item.occurrence && { seriesId: item.occurrence.seriesId, recurrenceId: item.occurrence.recurrenceId },
    recurrenceOverride: item.recurrenceOverride && { kind: item.recurrenceOverride.kind },
    eventProgram: item.eventProgram && { blocks: item.eventProgram.blocks.map(block => ({ id: block.id, title: block.title, startOffsetSeconds: block.startOffsetSeconds, endOffsetSeconds: block.endOffsetSeconds })) }, reminders: [],
  }]));
  const prefs = workspace.calendarPreferences;
  const key = JSON.stringify({ workspaceId: workspace.workspaceId, items, tombstones: workspace.tombstones,
    calendarPreferences: { language: prefs.language, timezone: prefs.timezone,
      appearance: { headerDueMode: prefs.appearance.headerDueMode }, timeline: { sleepItemId: prefs.timeline?.sleepItemId } } });
  // Also detach Automerge proxies before structured cloning into the worker.
  return { key, workspace: JSON.parse(key) as WorkspaceDocument };
}

export function calculateAgendaInWorker(workspace: WorkspaceDocument, now: number, signal: AbortSignal): Promise<ReturnType<typeof agendaWidgetSnapshot>> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Agenda calculation cancelled')); return; }
    // Never fall back to the expensive calculation on the UI thread.
    const worker = new Worker(new URL('../agenda.worker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = (error?: Error, result?: ReturnType<typeof agendaWidgetSnapshot>) => {
      if (settled) return;
      settled = true; clearTimeout(timeout); signal.removeEventListener('abort', abort); worker.terminate();
      if (error) reject(error); else resolve(result!);
    };
    const abort = () => finish(new Error('Agenda calculation cancelled'));
    const timeout = setTimeout(() => finish(new Error('Agenda calculation timed out')), 60_000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = event => {
      if (event.data.ok) {
        recordDiagnostic({ kind: 'result', operation: 'Agenda worker calculation', message: 'Background agenda calculated', durationMs: Math.round(event.data.durationMs) });
        finish(undefined, event.data.snapshot);
      } else finish(new Error('Agenda calculation failed'));
    };
    worker.onerror = () => finish(new Error('Agenda worker failed'));
    try { worker.postMessage({ workspace, now }); } catch { finish(new Error('Agenda worker transfer failed')); }
  });
}
