import { useRef, type MouseEvent, type TouchEvent } from 'react';

/** Navigator-only gesture: card swipes and the timeline's day gesture stay separate. */
export function useCalendarPeriodSwipe(move: (direction: -1 | 1) => void) {
  const start = useRef<{ x: number; y: number; at: number } | null>(null);
  const suppressClickUntil = useRef(0);
  return {
    onTouchStart(event: TouchEvent<HTMLDivElement>) {
      start.current = event.touches.length === 1
        ? { x: event.touches[0]!.clientX, y: event.touches[0]!.clientY, at: Date.now() } : null;
    },
    onTouchMove(event: TouchEvent<HTMLDivElement>) {
      if (event.touches.length !== 1) { start.current = null; return; }
      const origin = start.current;
      if (!origin) return;
      const dx = event.touches[0]!.clientX - origin.x, dy = event.touches[0]!.clientY - origin.y;
      // Once scrolling wins, this gesture can never turn into navigation.
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) start.current = null;
    },
    onTouchCancel() { start.current = null; },
    onTouchEnd(event: TouchEvent<HTMLDivElement>) {
      const origin = start.current; start.current = null;
      if (!origin || event.changedTouches.length !== 1) return;
      const dx = event.changedTouches[0]!.clientX - origin.x, dy = event.changedTouches[0]!.clientY - origin.y;
      if (Math.abs(dx) < 65 || Math.abs(dx) <= Math.abs(dy) * 1.5 || Date.now() - origin.at >= 900) return;
      suppressClickUntil.current = Date.now() + 500;
      move(dx < 0 ? 1 : -1);
    },
    onClickCapture(event: MouseEvent<HTMLDivElement>) {
      // Do not select a day through a synthesized click at the end of a swipe.
      // Keyboard activation (detail=0) remains available immediately.
      if (event.detail > 0 && Date.now() < suppressClickUntil.current) {
        event.preventDefault(); event.stopPropagation();
      }
    },
  };
}
