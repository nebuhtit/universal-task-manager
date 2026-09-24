import { useRef } from 'react';
import { moveManualItem } from '../views/viewSelectors';

/** Native keyboard control and pointer capture; only the handle consumes touch scrolling. */
export function CalendarOrderHandle({ id, title, ids, onReorder, style }: {
  id: string; title: string; ids: string[]; onReorder: (ids: string[], movedId: string) => void; style?: React.CSSProperties;
}) {
  const target = useRef<{ id: string; after: boolean } | null>(null);
  return <button type="button" data-calendar-handle-id={id} className="view-drag-handle calendar-order-handle" style={style} aria-label={`Reorder ${title}`} title="Drag or use Arrow Up / Arrow Down"
    onClick={event => { event.preventDefault(); event.stopPropagation(); }}
    onKeyDown={event => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault(); event.stopPropagation();
      const direction = event.key === 'ArrowUp' ? -1 : 1, next = ids[ids.indexOf(id) + direction];
      if (next) onReorder(moveManualItem(ids, id, next, direction > 0), id);
    }}
    onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); target.current = null; event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={event => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      let node = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-calendar-order-id], [data-view-item-id]');
      if (!node) {
        const axis = event.currentTarget.closest('.timeline-axis');
        const candidates = [...(axis?.querySelectorAll<HTMLElement>('[data-calendar-order-id]') ?? [])].filter(value => value.dataset.calendarOrderId !== id).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
        node = candidates.filter(value => value.getBoundingClientRect().top <= event.clientY).at(-1) ?? candidates[0];
      }
      const next = node?.dataset.calendarOrderId ?? node?.dataset.viewItemId;
      target.current = node && next && next !== id ? { id: next, after: event.clientY > node.getBoundingClientRect().top + node.getBoundingClientRect().height / 2 } : null;
    }}
    onPointerUp={event => { const next = target.current; target.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); if (next) onReorder(moveManualItem(ids, id, next.id, next.after), id); }}
    onPointerCancel={() => { target.current = null; }}><span aria-hidden>⠿</span></button>;
}
