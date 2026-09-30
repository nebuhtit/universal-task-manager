import { profileInput, type ProfileActionKind } from './performanceProfile';

export function inputDispatchDelay(timestamp: number, now: number, origin: number): number {
  const at = timestamp > 1e12 ? timestamp - origin : timestamp;
  return Number.isFinite(at) && at > 0 && at <= now ? now - at : 0;
}

/** No target, text, key, selector, coordinates or entered value is inspected. */
export function installInputLatency(profile = profileInput) {
  const kinds = { pointerdown: 'pointer', click: 'click', input: 'input', keydown: 'keydown' } as const;
  const ids = new WeakMap<Event, number>();
  let waiting: number[] = [], frame: number | undefined, timer: ReturnType<typeof setTimeout> | undefined, disposed = false;
  const onInput = (event: Event) => {
    if (document.visibilityState !== 'visible' || !event.isTrusted) return;
    const start = performance.now();
    const id = profile.start(kinds[event.type as keyof typeof kinds] as ProfileActionKind, inputDispatchDelay(event.timeStamp, start, performance.timeOrigin));
    if (id === undefined) return;
    ids.set(event, id);
    waiting.push(id); if (waiting.length > 8) waiting.shift();
    if (frame !== undefined || timer !== undefined) return;
    // rAF + the following task is a frame opportunity, never proof of paint
    // or completion of a network request. A single callback serves a burst.
    frame = requestAnimationFrame(() => {
      frame = undefined;
      timer = setTimeout(() => {
        timer = undefined;
        const completed = waiting; waiting = [];
        if (!disposed && document.visibilityState === 'visible') completed.forEach(profile.frame);
      }, 0);
    });
  };
  const afterHandlers = (event: Event) => { const id = ids.get(event); if (id !== undefined) profile.handling(id); };
  const pause = () => {
    if (document.visibilityState !== 'hidden') return;
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (timer !== undefined) clearTimeout(timer);
    frame = undefined; timer = undefined; waiting = []; profile.abandon();
  };
  for (const event of Object.keys(kinds)) {
    document.addEventListener(event, onInput, { capture: true, passive: true });
    document.addEventListener(event, afterHandlers, { passive: true });
  }
  document.addEventListener('visibilitychange', pause);
  return () => {
    disposed = true;
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (timer !== undefined) clearTimeout(timer);
    waiting = [];
    profile.abandon(); document.removeEventListener('visibilitychange', pause);
    for (const event of Object.keys(kinds)) { document.removeEventListener(event, onInput, true); document.removeEventListener(event, afterHandlers); }
  };
}
