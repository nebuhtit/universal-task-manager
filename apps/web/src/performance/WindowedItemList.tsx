import { Children, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LONG_LIST_VIRTUALIZATION_THRESHOLD } from './longList';
import './windowed-list.css';

const CHUNK_SIZE = 20;
const ESTIMATED_ROW_HEIGHT = 96;
type Visibility = (visible: boolean) => void;

/** One observer per list. No scroll listeners or persisted UI state. */
function visibilityObserver() {
  const listeners = new Map<Element, Visibility>();
  let observer: IntersectionObserver | undefined;
  return {
    observe(element: Element, listener: Visibility) {
      observer ??= new IntersectionObserver(entries => {
        for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting);
      }, { rootMargin: '600px 0px' });
      listeners.set(element, listener); observer.observe(element);
      return () => { listeners.delete(element); observer?.unobserve(element); if (!listeners.size) { observer?.disconnect(); observer = undefined; } };
    },
  };
}

function WindowChunk({ children, observer }: { children: ReactNode[]; observer: ReturnType<typeof visibilityObserver> }) {
  const element = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  // Keep an interacted chunk mounted so dialog focus restoration and text
  // selection cannot lose their original DOM node during scrolling.
  const [retained, setRetained] = useState(false);
  const focusPending = useRef(false);
  const height = useRef(children.length * ESTIMATED_ROW_HEIGHT);
  const mounted = visible || retained;
  useEffect(() => observer.observe(element.current!, setVisible), [observer]);
  useLayoutEffect(() => {
    if (!mounted || !element.current) return;
    const target = element.current;
    const measure = () => { const value = target.getBoundingClientRect().height; if (value > 0) height.current = value; };
    measure();
    const resize = new ResizeObserver(measure); resize.observe(target);
    if (focusPending.current) {
      focusPending.current = false;
      target.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]')?.focus();
    }
    return () => resize.disconnect();
  }, [mounted, children]);
  return <div ref={element} data-window-row className="windowed-list-chunk" style={mounted ? undefined : { height: height.current }}
    tabIndex={mounted ? undefined : 0} aria-label={mounted ? undefined : 'More items'}
    onFocusCapture={() => { if (!mounted) focusPending.current = true; setRetained(true); }}
    onPointerDownCapture={() => setRetained(true)}>
    {mounted ? children : null}
  </div>;
}

/** Chunk windowing for non-reorderable All items lists only. Search stays global. */
export function WindowedItemList({ children, className }: { children: ReactNode; className: string }) {
  const rows = Children.toArray(children);
  const observer = useMemo(visibilityObserver, []);
  if (rows.length < LONG_LIST_VIRTUALIZATION_THRESHOLD || typeof IntersectionObserver === 'undefined') return <div className={className}>{children}</div>;
  const chunks: ReactNode[] = [];
  for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
    const chunk = rows.slice(index, index + CHUNK_SIZE);
    chunks.push(<WindowChunk key={`${index}:${(chunk[0] as { key?: string }).key ?? ''}`} observer={observer}>{chunk}</WindowChunk>);
  }
  return <div className={className.replace(' long-list-virtualized', '')} data-windowed-list>{chunks}</div>;
}
