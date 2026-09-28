import { recordDiagnostic } from './diagnostics';

export function inputDispatchDelay(timestamp: number, now: number, origin: number): number {
  const at = timestamp > 1e12 ? timestamp - origin : timestamp;
  return Number.isFinite(at) && at > 0 && at <= now ? now - at : 0;
}

/** No target, text, key, selector, coordinates or entered value is inspected. */
export function installInputLatency() {
  const recent = new Map<string, number>();
  let pending = false, disposed = false;
  const log = (operation: string, durationMs: number) => {
    const now = performance.now();
    if (durationMs < 1500 || now - (recent.get(operation) ?? -Infinity) < 3000) return;
    recent.set(operation, now);
    recordDiagnostic({ kind: 'result', operation, message: 'Slow input response', durationMs: Math.round(durationMs) });
  };
  const onInput = (event: Event) => {
    if (document.visibilityState !== 'visible' || !event.isTrusted) return;
    const start = performance.now();
    log('UI input dispatch', inputDispatchDelay(event.timeStamp, start, performance.timeOrigin));
    if (pending) return;
    pending = true;
    // An opportunity to paint, not a claim that every async action has finished.
    requestAnimationFrame(() => setTimeout(() => {
      pending = false;
      if (!disposed && document.visibilityState === 'visible') log('UI input to frame', performance.now() - start);
    }, 0));
  };
  document.addEventListener('pointerdown', onInput, { capture: true, passive: true });
  document.addEventListener('click', onInput, { capture: true, passive: true });
  return () => { disposed = true; document.removeEventListener('pointerdown', onInput, true); document.removeEventListener('click', onInput, true); };
}
