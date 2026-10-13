import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';

/** Presentation only: gesture frames never update React or calendar calculations. */
export function useCalendarSwipeMotion(pageKey: string) {
  const ref = useRef<HTMLDivElement>(null);
  const pendingDirection = useRef<-1 | 1 | undefined>(undefined);
  const motion = useMemo(() => {
    let frame: number | undefined;
    let animation: Animation | undefined;
    let offset = 0;
    let width = 0;
    let pendingOffset = 0;
    let preparedTransition = false;
    const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const clear = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      animation?.cancel(); animation = undefined;
      if (ref.current) { ref.current.style.transform = ''; delete ref.current.dataset.swipeMotion; }
    };
    const animate = (from: Keyframe, phase: string) => {
      const node = ref.current;
      if (!node || reduced() || !node.animate) return;
      const css = getComputedStyle(node);
      const durationValue = css.getPropertyValue('--motion-default').trim();
      const duration = parseFloat(durationValue) * (durationValue.endsWith('ms') ? 1 : 1000);
      if (!Number.isFinite(duration) || duration <= 0) return;
      node.dataset.swipeMotion = phase;
      const current = node.animate([from, { transform: 'translateX(0)', opacity: 1 }], {
        duration, easing: css.getPropertyValue('--motion-easing-enter').trim() || 'linear',
      });
      animation = current;
      current.onfinish = () => { if (animation === current) { animation = undefined; delete node.dataset.swipeMotion; } };
    };
    return {
      ref,
      cancel() { clear(); width = 0; },
      reset() {
        const transform = ref.current?.style.transform;
        clear(); width = 0;
        if (transform) animate({ transform }, 'settling');
      },
      drag(dx: number) {
        if (!ref.current || reduced()) return;
        animation?.cancel(); animation = undefined;
        width ||= ref.current.getBoundingClientRect().width;
        const side = dx < 0 ? 'next' : 'previous';
        const prepared = ref.current.querySelector(`[data-calendar-slide="${side}"]`);
        // Reveal the real adjacent slide. Resist only if its first idle
        // preparation has not finished yet (never reveal an empty/stale slide).
        const limit = Math.max(1, width * 0.3);
        offset = prepared ? Math.max(-width, Math.min(width, dx)) : limit * Math.tanh(dx / limit);
        if (frame !== undefined) return;
        frame = requestAnimationFrame(() => {
          frame = undefined;
          if (ref.current) { ref.current.style.transform = `translateX(${offset}px)`; ref.current.dataset.swipeMotion = 'dragging'; }
        });
      },
      navigate(direction: -1 | 1, move: () => void) {
        pendingDirection.current = direction;
        preparedTransition = Boolean(ref.current?.querySelector(`[data-calendar-slide="${direction === 1 ? 'next' : 'previous'}"]`));
        pendingOffset = ref.current?.style.transform ? offset : 0;
        move();
      },
      enter(direction: -1 | 1) {
        clear(); width = 0;
        if (!ref.current || reduced()) return;
        const distance = preparedTransition ? direction * ref.current.getBoundingClientRect().width + pendingOffset : direction * Math.min(ref.current.getBoundingClientRect().width * 0.2, parseFloat(getComputedStyle(ref.current).getPropertyValue('--space-8')) * 2);
        if (Number.isFinite(distance)) animate({ transform: `translateX(${distance}px)`, opacity: preparedTransition ? 1 : 0.65 }, 'entering');
      },
    };
  }, []);
  useLayoutEffect(() => {
    const direction = pendingDirection.current;
    pendingDirection.current = undefined;
    if (direction !== undefined) motion.enter(direction);
    else motion.cancel();
  }, [pageKey, motion]);
  useEffect(() => () => motion.cancel(), [motion]);
  return motion;
}
