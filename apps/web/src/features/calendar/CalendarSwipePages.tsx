import type { ReactNode, RefObject } from 'react';

export type CalendarSwipePage = { key: string; content: ReactNode };

/** Exactly one interactive slide. Neighbours are already laid out, but inert. */
export function CalendarSwipePages({ current, previous, next, trackRef, className }: {
  current: CalendarSwipePage; previous?: CalendarSwipePage | undefined; next?: CalendarSwipePage | undefined;
  trackRef: RefObject<HTMLDivElement | null>; className: string;
}) {
  return <div className={`calendar-swipe-viewport ${className}-viewport`}><div ref={trackRef} className={`calendar-swipe-track ${className}`}>
    {[{ ...current, position: 'current' }, previous && { ...previous, position: 'previous' }, next && { ...next, position: 'next' }].filter(Boolean).map(slide => {
      if (!slide) return null;
      const active = slide.position === 'current';
      return <div key={slide.key} className="calendar-swipe-page" data-calendar-slide={slide.position} data-slide-key={slide.key} inert={!active} aria-hidden={active ? undefined : true}>{slide.content}</div>;
    })}
  </div></div>;
}
