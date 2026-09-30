import { APP_VERSION } from '@utm/core';
import { beginProfileSpan, currentProfileActionId, recordWorkerProfileSpan } from './performanceProfile';

const KEY = 'utm:sync-trace:v1';
const events = ['storage-worker-load-failed', 'storage-worker-runtime-failed', 'storage-worker-message-failed', 'storage-worker-transfer-failed', 'storage-worker-calculation-failed', 'boot', 'begin', 'end', 'failed', 'heartbeat', 'visibility', 'pagehide', 'queue-start', 'queue-end', 'download-start', 'download-end', 'snapshot-start', 'snapshot-end', 'calculate-start', 'calculate-end', 'apply-start', 'apply-end', 'persist-start', 'persist-end', 'patch-check-start', 'patch-check-end', 'patch-write-start', 'patch-write-progress', 'patch-write-end', 'commit-start', 'commit-end', 'react-enqueued', 'react-committed', 'serialize-start', 'serialize-end', 'storage-worker-start', 'storage-worker-end', 'storage-fallback', 'encrypt-start', 'encrypt-end', 'indexeddb-start', 'indexeddb-end', 'worker-post-start', 'worker-post-end', 'worker-result', 'save-begin', 'save-end', 'save-failed', 'save-timeout', 'export-filter-start', 'export-filter-end', 'export-encode-start', 'export-encode-end', 'mirror-start', 'mirror-end'] as const;
type TraceEvent = typeof events[number];
const metricKeys = ['elapsedMs', 'durationMs', 'lagMs', 'items', 'patches', 'processed', 'bytes', 'visible', 'events', 'calendars', 'pipelineVersion'] as const;
type Metrics = Partial<Record<typeof metricKeys[number], number>>;
type Entry = { at: string; run: string; event: TraceEvent; version: string; traceVersion: number; metrics: Metrics };
let run = '';
let start = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let pending: Entry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;

/** Independent small durable ring: never titles, IDs, errors, URLs or tokens. */
export function readSyncTrace(): Entry[] {
  let raw: unknown = [];
  try { raw = JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { /* Export pending entries even without storage. */ }
  try {
    return [...(Array.isArray(raw) ? raw : []), ...pending].slice(-240).flatMap((entry): Entry[] => {
      if (!entry || !events.includes(entry.event) || typeof entry.run !== 'string' || !/^[a-f\d-]{36}$/.test(entry.run) || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(entry.at) || !/^\d+\.\d+\.\d+$/.test(entry.version)) return [];
      const metrics: Metrics = {};
      for (const key of metricKeys) if (Number.isFinite(entry.metrics?.[key]) && entry.metrics[key] >= 0) metrics[key] = Math.round(entry.metrics[key]);
      return [{ at: entry.at, run: entry.run, event: entry.event, version: entry.version, traceVersion: 1, metrics }];
    });
  } catch { return []; }
}
export function flushSyncTrace(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = undefined;
  if (!pending.length) return;
  try { localStorage.setItem(KEY, JSON.stringify(readSyncTrace())); pending = []; } catch { /* Retry the bounded buffer on the next checkpoint. */ }
}
export function clearSyncTrace(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = undefined; pending = [];
  try { localStorage.removeItem(KEY); } catch { /* Optional diagnostics. */ }
}
export function syncTrace(event: TraceEvent, metrics: Metrics = {}, context = { run, start }): void {
  const { run, start } = context;
  if (!run) return;
  try {
    if (localStorage.getItem('utm:diagnostics-enabled:v1') === 'false') return;
    const safe: Metrics = { elapsedMs: Math.round(performance.now() - start) };
    for (const key of metricKeys) if (Number.isFinite(metrics[key]) && metrics[key]! >= 0) safe[key] = Math.round(metrics[key]!);
    pending.push({ at: new Date().toISOString(), run, version: APP_VERSION, traceVersion: 1, event, metrics: safe });
    if (pending.length > 240) pending.shift();
    // Keep interruption boundaries durable. Progress/heartbeat checkpoints are
    // batched instead of reading/stringifying/writing the ring on every stage.
    if (['boot', 'begin', 'end', 'failed', 'save-begin', 'save-end', 'save-failed'].includes(event)) flushSyncTrace();
    else if (!flushTimer) flushTimer = setTimeout(flushSyncTrace, 10_000);
  } catch { /* Logging cannot prevent saving. */ }
}
/** Every save has its own durable trace, including saves outside Google sync. */
export function beginPersistenceTrace(actionId: number | null = currentProfileActionId() ?? null) {
  const context = { run: crypto.randomUUID(), start: performance.now() };
  const total = beginProfileSpan('save.total', actionId);
  const phaseNames = { serialize: 'save.serialize', snapshot: 'save.snapshot', 'storage-worker': 'save.worker-wait', encrypt: 'save.encrypt', indexeddb: 'save.write', mirror: 'save.mirror' } as const;
  const phases = new Map<string, ReturnType<typeof beginProfileSpan>>();
  const trace = (event: TraceEvent, metrics: Metrics = {}) => {
    const name = event.replace(/-(start|end)$/, '') as keyof typeof phaseNames;
    if (phaseNames[name]) {
      if (event.endsWith('-start')) phases.set(name, beginProfileSpan(phaseNames[name], actionId));
      else if (event.endsWith('-end')) { phases.get(name)?.(metrics.bytes === undefined ? {} : { bytes: metrics.bytes }); phases.delete(name); }
    }
    if (metrics.durationMs !== undefined && (event === 'export-filter-end' || event === 'export-encode-end')) recordWorkerProfileSpan(event === 'export-filter-end' ? 'save.worker-filter' : 'save.worker-encode', metrics.durationMs, {}, actionId);
    syncTrace(event, metrics, context);
  };
  trace('save-begin', { pipelineVersion: 2 });
  let last = performance.now(), ticks = 0;
  const heartbeat = setInterval(() => {
    const now = performance.now(), lagMs = Math.max(0, now - last - 1000); last = now;
    if (++ticks % 5 === 0 || lagMs > 750) trace('heartbeat', { lagMs });
  }, 1000);
  return { trace, finish(failed: boolean) { clearInterval(heartbeat); phases.forEach(finish => finish({ failed: 1 })); phases.clear(); total({ failed: failed ? 1 : 0 }); trace(failed ? 'save-failed' : 'save-end'); } };
}
export function beginSyncTrace(): void {
  if (timer) clearInterval(timer);
  run = crypto.randomUUID(); start = performance.now();
  syncTrace('begin');
  let last = performance.now(), ticks = 0;
  timer = setInterval(() => {
    const now = performance.now(); const lagMs = Math.max(0, now - last - 1000); last = now;
    if (++ticks % 5 === 0 || lagMs > 750) syncTrace('heartbeat', { lagMs, visible: typeof document !== 'undefined' && document.visibilityState === 'visible' ? 1 : 0 });
  }, 1000);
}
export function endSyncTrace(failed: boolean): void {
  syncTrace(failed ? 'failed' : 'end');
  if (timer) clearInterval(timer); timer = undefined; run = '';
}
export function installSyncTraceLifecycle(): void {
  // Leave the previous run intact. A boot after an unmatched begin is evidence
  // of interruption, not proof of an iOS crash or memory pressure.
  run = crypto.randomUUID(); start = performance.now(); syncTrace('boot'); run = '';
  document.addEventListener('visibilitychange', () => { syncTrace('visibility', { visible: document.visibilityState === 'visible' ? 1 : 0 }); if (document.visibilityState === 'hidden') flushSyncTrace(); });
  window.addEventListener('pagehide', () => { syncTrace('pagehide'); flushSyncTrace(); });
}
