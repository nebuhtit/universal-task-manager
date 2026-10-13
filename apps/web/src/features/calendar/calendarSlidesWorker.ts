import type { WorkspaceDocument } from '@utm/core';
import type { CalendarPreparedSlides, CalendarSlideRequest } from './calendarPageCache';
import { recordDiagnostic } from '../../services/diagnostics';
import { measureProfile, recordWorkerProfileSpan } from '../../services/performanceProfile';

type Reply = { id: number; ok: true; result: CalendarPreparedSlides; durationMs: number } | { id: number; ok: false };
type WorkerPort = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'>;
const workerFactory = () => new Worker(new URL('../../calendarSlides.worker.ts', import.meta.url), { type: 'module' });

/** Optional, isolated from reminder/widget workers. Never falls back to heavy
 * main-thread prefetch. Abort releases snapshots and ignores all late replies. */
export function createCalendarSlidesRunner(factory: () => WorkerPort = workerFactory) {
  let worker: WorkerPort | undefined, source: WorkspaceDocument | undefined, snapshot = 0, nextId = 0, disabled = false;
  let cancelPending: (() => void) | undefined;
  const dispose = () => { cancelPending?.(); cancelPending = undefined; worker?.terminate(); worker = undefined; source = undefined; };
  return { dispose,
    async prepare(workspace: WorkspaceDocument, request: CalendarSlideRequest, signal: AbortSignal): Promise<CalendarPreparedSlides | undefined> {
      if (signal.aborted || disabled) return;
      // The hook issues only one job at a time. Cancelling navigation terminates
      // any old CPU job instead of queueing increasingly obsolete calculations.
      if (cancelPending) dispose();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let wake: (() => void) | undefined;
      let settled = false;
      const id = ++nextId;
      return new Promise(resolve => {
        const finish = (result?: CalendarPreparedSlides) => {
          if (settled) return;
          settled = true; if (timer) clearTimeout(timer); wake?.();
          signal.removeEventListener('abort', abort); cancelPending = undefined; resolve(result);
        };
        const abort = () => { finish(); worker?.terminate(); worker = undefined; source = undefined; };
        const fail = () => {
          disabled = true;
          recordDiagnostic({ kind: 'error', message: 'Adjacent calendar slide worker unavailable', operation: 'Calendar adjacent slides', outcome: 'failed' });
          abort();
        };
        cancelPending = abort;
        signal.addEventListener('abort', abort, { once: true });
        void (async () => {
          try {
            worker ??= factory();
            const target = worker;
            target.onmessage = (event: MessageEvent<Reply>) => {
              if (settled || worker !== target || event.data.id !== id) return;
              if (!event.data.ok) { fail(); return; }
              const { durationMs, result } = event.data;
              recordWorkerProfileSpan('calendar.prefetch-worker', durationMs, { days: result.timelines.length + result.ranges.reduce((count, range) => count + Object.keys(range.value.calendar.days).length, 0) }, null);
              if (durationMs >= 100) recordDiagnostic({ kind: 'result', message: 'Adjacent calendar slide prepared off main thread', operation: 'Calendar adjacent slides', outcome: 'succeeded', durationMs });
              finish(result);
            };
            target.onerror = target.onmessageerror = () => { if (worker === target) fail(); };
            if (source !== workspace) {
              // Automerge proxies cannot be structured-cloned. Detach in small,
              // cancellable batches, not JSON.stringify(the entire document).
              const version = ++snapshot;
              const keys = measureProfile('calendar.prefetch-input', () => {
                target.postMessage({ kind: 'snapshot', snapshot: version, json: JSON.stringify({ ...workspace, items: {} }) });
                return Object.keys(workspace.items);
              }, undefined, null);
              for (let index = 0; index < keys.length;) {
                if (signal.aborted || settled) return;
                measureProfile('calendar.prefetch-input', () => {
                  const started = performance.now(), items: Array<[string, string]> = [];
                  do {
                    const key = keys[index++]!; items.push([key, JSON.stringify(workspace.items[key])]);
                  } while (index < keys.length && items.length < 32 && performance.now() - started < 4);
                  target.postMessage({ kind: 'items', snapshot: version, items });
                  return items.length;
                }, scanned => ({ scanned }), null);
                if (index < keys.length) await new Promise<void>(resume => { wake = resume; timer = setTimeout(() => { timer = undefined; wake = undefined; resume(); }, 0); });
              }
              if (signal.aborted || settled) return;
              source = workspace;
            }
            timer = setTimeout(fail, 60_000);
            target.postMessage({ kind: 'prepare', snapshot, id, request });
          } catch { if (!settled) fail(); }
        })();
      });
    },
  };
}
