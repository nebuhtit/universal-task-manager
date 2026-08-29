import { useId, useRef, type HTMLAttributes, type ReactNode } from 'react';

type DragState = { from: number; target: number; after: boolean };

function moveEntry<T>(items: T[], from: number, target: number, after = false) {
  const next = [...items];
  const [entry] = next.splice(from, 1);
  if (entry === undefined) return next;
  const adjustedTarget = target > from ? target - 1 : target;
  next.splice(Math.max(0, Math.min(next.length, adjustedTarget + (after ? 1 : 0))), 0, entry);
  return next;
}

/** Pointer/touch reorder with an explicit handle; Arrow/Home/End keep it keyboard accessible. */
export function useReorderList<T>(items: T[], onChange: (items: T[]) => void) {
  const listId = useId();
  const container = useRef<HTMLDivElement | null>(null);
  const drag = useRef<DragState | null>(null);
  const rowProps = (index: number): HTMLAttributes<HTMLDivElement> => ({
    'data-reorder-list': listId,
    'data-reorder-index': String(index),
    onDragOver: (event) => { event.preventDefault(); updateDragTarget(event.clientY); },
    onDrop: (event) => {
      event.preventDefault();
      updateDragTarget(event.clientY);
      const current = drag.current;
      if (current && current.target !== current.from) onChange(moveEntry(items, current.from, current.target, current.after));
      drag.current = null;
    },
  } as HTMLAttributes<HTMLDivElement>);
  const updateDragTarget = (clientY: number) => {
    if (!drag.current) return;
    const rows = [...(container.current?.children ?? [])].filter((element): element is HTMLElement => element instanceof HTMLElement && element.dataset.reorderList === listId);
    const row = rows.find((candidate) => {
      const bounds = candidate.getBoundingClientRect();
      return clientY >= bounds.top && clientY <= bounds.bottom;
    }) ?? rows.sort((left, right) => {
      const leftBounds = left.getBoundingClientRect();
      const rightBounds = right.getBoundingClientRect();
      return Math.abs(clientY - (leftBounds.top + leftBounds.height / 2)) - Math.abs(clientY - (rightBounds.top + rightBounds.height / 2));
    })[0];
    if (!row) return;
    const target = Number(row.dataset.reorderIndex);
    if (!Number.isInteger(target)) return;
    const bounds = row.getBoundingClientRect();
    drag.current.target = target;
    drag.current.after = clientY >= bounds.top + bounds.height / 2;
  };
  const handle = (index: number, label: string): ReactNode => <button
    type="button"
    draggable
    className="ui-reorder-handle"
    aria-label={`Reorder ${label}`}
    onDragStart={(event) => {
      drag.current = { from: index, target: index, after: false };
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
    }}
    onDragEnd={() => { drag.current = null; }}
    onKeyDown={(event) => {
      const target = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : index;
      if (target === index || target < 0 || target >= items.length) return;
      event.preventDefault();
      onChange(moveEntry(items, index, target, target > index));
    }}
    onPointerDown={(event) => {
      const target = event.currentTarget;
      target.focus();
      drag.current = { from: index, target: index, after: false };
      const move = (pointerEvent: PointerEvent) => updateDragTarget(pointerEvent.clientY);
      const cleanup = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', cancel);
      };
      const finish = (pointerEvent: PointerEvent) => {
        updateDragTarget(pointerEvent.clientY);
        const current = drag.current;
        if (current && current.target !== current.from) onChange(moveEntry(items, current.from, current.target, current.after));
        drag.current = null;
        cleanup();
      };
      const cancel = () => {
        drag.current = null;
        cleanup();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', cancel);
    }}
    onMouseDown={(event) => {
      event.preventDefault();
      event.currentTarget.focus();
      drag.current ??= { from: index, target: index, after: false };
      const move = (mouseEvent: MouseEvent) => updateDragTarget(mouseEvent.clientY);
      const finish = (mouseEvent: MouseEvent) => {
        updateDragTarget(mouseEvent.clientY);
        const current = drag.current;
        if (current && current.target !== current.from) onChange(moveEntry(items, current.from, current.target, current.after));
        drag.current = null;
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', finish);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', finish);
    }}
  ><svg viewBox="0 0 16 24" width="16" height="24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="5" r="1.35"/><circle cx="11" cy="5" r="1.35"/><circle cx="5" cy="12" r="1.35"/><circle cx="11" cy="12" r="1.35"/><circle cx="5" cy="19" r="1.35"/><circle cx="11" cy="19" r="1.35"/></svg></button>;
  return { container, rowProps, handle };
}
