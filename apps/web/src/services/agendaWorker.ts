import { buildRecurrenceRule, createOccurrence, durationToMs, itemDeletionTime, recurrenceAnchor, type UniversalItem, type WorkspaceDocument } from '@utm/core';
import type { agendaWidgetSnapshot } from './nativeAgendaWidget';
import { recordDiagnostic } from './diagnostics';
import { measureProfile } from './performanceProfile';

/** Include every input read by the agenda and recurrence projection, not editor metadata. */
export function agendaInput(workspace: WorkspaceDocument, now = Date.now()): { key: string; workspace: WorkspaceDocument } {
  return measureProfile('agenda.input', () => prepareAgendaInput(workspace, now), value => ({ rows: Object.keys(value.workspace.items).length }));
}

function prepareAgendaInput(workspace: WorkspaceDocument, now: number): { key: string; workspace: WorkspaceDocument } {
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

/** Materialize only the requested widget horizon; no series projection enters the worker. */
export function agendaWidgetWorkspace(workspace: WorkspaceDocument, now: number, horizonHours = 48): WorkspaceDocument {
  return measureProfile('agenda.project', () => projectAgendaWorkspace(workspace, now, horizonHours), value => ({ rows: Object.keys(value.items).length }));
}

function projectAgendaWorkspace(workspace: WorkspaceDocument, now: number, horizonHours: number): WorkspaceDocument {
  const until = now + horizonHours * 3600_000;
  const items = Object.values(workspace.items);
  const retained = new Map<string, UniversalItem>();
  for (const item of items) {
    if (item.role === 'series_template') continue;
    const moments = agendaMoments(item);
    const start = timestamp(item.schedule?.startAt), end = timestamp(item.schedule?.endAt);
    const active = Number.isFinite(start) && start <= now && Number.isFinite(end) && end > now;
    if (active || moments.some(at => at >= now && at <= until)) retained.set(item.id, item);
  }
  for (const series of items) {
    const anchorValue = series.role === 'series_template' ? recurrenceAnchor(series) : undefined;
    if (!anchorValue || !series.recurrence || series.state !== 'open' || itemDeletionTime(workspace, series)) continue;
    const origin = new Date(anchorValue);
    const sample = createOccurrence(series, origin, 0);
    const offsets = [timestamp(sample.schedule?.endAt), timestamp(sample.schedule?.dueAt), ...(sample.eventProgram?.blocks ?? []).map(block => origin.getTime() + block.endOffsetSeconds * 1000)];
    const lookback = Math.max(0, ...offsets.filter(Number.isFinite).map(at => at - origin.getTime()));
    const overrides = new Set(items.filter(item => item.occurrence?.seriesId === series.id).map(item => item.occurrence!.recurrenceId));
    for (const anchor of buildRecurrenceRule(series).between(new Date(now - lookback), new Date(until + 1), true)) {
      if (overrides.has(anchor.toISOString())) continue;
      const occurrence = createOccurrence(series, anchor, 0);
      if (occurrence.state === 'open' && !itemDeletionTime(workspace, occurrence)) retained.set(occurrence.id, occurrence);
    }
  }
  const filteredItems = Object.fromEntries(retained);
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
