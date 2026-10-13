import { startTransition, useEffect, useRef, useState } from 'react';
import { recordDiagnostic } from '../../services/diagnostics';

/** Two bounded idle jobs; cancelled on edits/navigation/lock, never per frame. */
export function useCalendarAdjacentSlides(identity: unknown, prepare: (direction: -1 | 1, signal: AbortSignal) => Promise<void>) {
  const [, refreshed] = useState(0);
  const latest = useRef(prepare); latest.current = prepare;
  useEffect(() => {
    let controller: AbortController | undefined, running = false;
    let stopped = false, idle: number | undefined, timer: number | undefined, waitingForInput = false;
    const pending: Array<-1 | 1> = [1, -1];
    const cancel = () => {
      controller?.abort();
      if (idle !== undefined) window.cancelIdleCallback(idle);
      if (timer !== undefined) window.clearTimeout(timer);
      idle = undefined; timer = undefined;
      if (waitingForInput) document.removeEventListener('focusout', inputFinished);
      waitingForInput = false;
    };
    const inputFinished = () => { waitingForInput = false; timer = window.setTimeout(schedule, 32); };
    const schedule = () => {
      if (stopped || running || document.hidden || !pending.length) return;
      const run = async () => {
        idle = undefined; timer = undefined;
        if (stopped || document.hidden) return;
        if (document.activeElement?.matches('input, textarea, [contenteditable="true"]')) {
          waitingForInput = true; document.addEventListener('focusout', inputFinished, { once: true }); return;
        }
        if (document.querySelector('.calendar-page [data-swipe-motion]')) {
          timer = window.setTimeout(schedule, 100); return;
        }
        const direction = pending.shift();
        if (direction !== undefined) {
          running = true; controller = new AbortController();
          const started = performance.now();
          try {
            await latest.current(direction, controller.signal);
            if (stopped) return;
            if (controller.signal.aborted) pending.unshift(direction);
            else startTransition(() => refreshed(value => value + 1));
            const durationMs = Math.round(performance.now() - started);
            if (durationMs >= 100) recordDiagnostic({ kind: 'result', message: 'Adjacent calendar slide prepared', operation: 'Calendar adjacent slides', outcome: 'succeeded', durationMs });
          } catch {
            // Optional preparation must not take down the current calendar.
            recordDiagnostic({ kind: 'error', message: 'Adjacent calendar slide preparation failed', operation: 'Calendar adjacent slides', outcome: 'failed' });
          } finally { running = false; controller = undefined; }
        }
        schedule();
      };
      if (window.requestIdleCallback) idle = window.requestIdleCallback(run, { timeout: 1500 });
      else timer = window.setTimeout(run, 32);
    };
    const visibility = () => { cancel(); schedule(); };
    document.addEventListener('visibilitychange', visibility);
    // Let the selected slide commit and paint before optional neighbour work.
    const frame = requestAnimationFrame(schedule);
    return () => { stopped = true; cancelAnimationFrame(frame); cancel(); document.removeEventListener('visibilitychange', visibility); };
  }, [identity]);
}
