import { durationToMs, type UniversalItem, type WorkspaceDocument } from '@utm/core';
import type { agendaWidgetSnapshot } from './nativeAgendaWidget';
import { recordDiagnostic } from './diagnostics';

/** Include every input read by the agenda and recurrence projection, not editor metadata. */
export function agendaInput(workspace: WorkspaceDocument, now = Date.now()): { key: string; workspace: WorkspaceDocument } {
  // Reduce before JSON serialization and worker transfer. A 72-hour staging
  // window safely covers the widget's 30-minute refresh cadence; the worker
  // still applies the exact 48-hour window for the final snapshot.
  const relevant = agendaWidgetWorkspace(workspace, now, 72);
  const items = Object.fromEntries(Object.entries(relevant.items).map(([id, item]) => [id, {
    id: item.id, title: item.title, state: item.state, role: item.role,
    deletedAt: item.deletedAt,
    schedule: item.schedule && Object.fromEntries(['startAt', 'endAt', 'dueAt', 'timezone', 'plannedDate', 'allDay', 'dueDateOnly', 'travelDuration', 'travelBackDuration'].map(key => [key, item.schedule![key as keyof typeof item.schedule]])),
    recurrence: item.recurrence,
    occurrence: item.occurrence && { seriesId: item.occurrence.seriesId, recurrenceId: item.occurrence.recurrenceId },
    recurrenceOverride: item.recurrenceOverride && { kind: item.recurrenceOverride.kind },
    eventProgram: item.eventProgram && { blocks: item.eventProgram.blocks.map(block => ({ id: block.id, title: block.title, startOffsetSeconds: block.startOffsetSeconds, endOffsetSeconds: block.endOffsetSeconds })) }, reminders: [],
  }]));
  const prefs = relevant.calendarPreferences;
  const key = JSON.stringify({ workspaceId: relevant.workspaceId, items, tombstones: relevant.tombstones,
    calendarPreferences: { language: prefs.language, timezone: prefs.timezone,
      appearance: { headerDueMode: prefs.appearance.headerDueMode }, timeline: { sleepItemId: prefs.timeline?.sleepItemId } } });
  // Also detach Automerge proxies before structured cloning into the worker.
  return { key, workspace: JSON.parse(key) as WorkspaceDocument };
}

const timestamp = (value?: string) => Date.parse(value ?? '');
const safeDuration = (value?: string) => {
  try { return durationToMs(value ?? 'PT0S'); } catch { return 0; }
};

function agendaMoments(item: UniversalItem): number[] {
  const start = timestamp(item.schedule?.startAt);
  const end = timestamp(item.schedule?.endAt);
  const moments = [start, end, timestamp(item.schedule?.dueAt)];
  if (Number.isFinite(start)) moments.push(start - safeDuration(item.schedule?.travelDuration));
  if (Number.isFinite(end)) moments.push(end + safeDuration(item.schedule?.travelBackDuration));
  if (Number.isFinite(start)) for (const block of item.eventProgram?.blocks ?? []) moments.push(start + block.startOffsetSeconds * 1000, start + block.endOffsetSeconds * 1000);
  return moments.filter(Number.isFinite);
}

/** Keep the requested widget horizon while dropping unrelated generated history. */
export function agendaWidgetWorkspace(workspace: WorkspaceDocument, now: number, horizonHours = 48): WorkspaceDocument {
  const until = now + horizonHours * 3600_000;
  const items = Object.values(workspace.items);
  const retained = new Set<string>();
  let firstLaterAt = Number.POSITIVE_INFINITY;
  const later = new Map<string, number>();
  for (const item of items) {
    // Templates are needed to project future recurrences. Materialized
    // occurrences are ordinary candidates: retaining every one was the source
    // of multi-second widget transfers in old workspaces.
    if (item.role === 'series_template') { retained.add(item.id); continue; }
    const moments = agendaMoments(item);
    const start = timestamp(item.schedule?.startAt), end = timestamp(item.schedule?.endAt);
    const active = Number.isFinite(start) && start <= now && Number.isFinite(end) && end > now;
    if (active || moments.some(at => at >= now && at <= until)) { retained.add(item.id); continue; }
    const next = Math.min(...moments.filter(at => at > until));
    if (Number.isFinite(next)) { later.set(item.id, next); firstLaterAt = Math.min(firstLaterAt, next); }
  }
  for (const [id, at] of later) if (at === firstLaterAt) retained.add(id);
  const filteredItems = Object.fromEntries(Object.entries(workspace.items).filter(([id]) => retained.has(id)));
  // Recurrence projection can consult tombstones for deleted occurrences whose
  // item body no longer exists, so keep them until the recurrence layer can
  // provide an explicit bounded deletion index.
  return { ...workspace, items: filteredItems, tombstones: workspace.tombstones };
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
