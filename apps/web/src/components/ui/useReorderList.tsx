import { useEffect, useId, useRef, type HTMLAttributes, type ReactNode } from 'react';
import './reorder-preview.css';

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
export function useReorderList<T>(items: T[], onChange: (items: T[]) => void, { enabled = true, visualPreview = false, holdDelayMs = 0 } = {}) {
  const listId = useId();
  const container = useRef<HTMLDivElement | null>(null);
  const drag = useRef<DragState | null>(null);
  const suppressClickUntil = useRef(0);
  const cancelSurface = useRef<(() => void) | undefined>(undefined);
  const preview = useRef<HTMLElement | null>(null);
  const clearPreview = () => {
    preview.current?.remove(); preview.current = null;
    container.current?.querySelectorAll('[data-reorder-dragging], [data-reorder-drop]').forEach((row) => {
      row.removeAttribute('data-reorder-dragging'); row.removeAttribute('data-reorder-drop');
    });
  };
  useEffect(() => { if (!enabled) cancelSurface.current?.(); return () => cancelSurface.current?.(); }, [enabled]);
  const rowProps = (index: number): HTMLAttributes<HTMLDivElement> => ({
    'data-reorder-list': listId,
    'data-reorder-index': String(index),
    onDragOver: (event) => { if (enabled) { event.preventDefault(); updateDragTarget(event.clientY); } },
    onDrop: (event) => {
      if (!enabled) return;
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
    if (visualPreview) {
      rows.forEach((candidate) => candidate.removeAttribute('data-reorder-drop'));
      if (target !== drag.current.from) row.dataset.reorderDrop = drag.current.after ? 'after' : 'before';
    }
  };
  const surface = (index: number): HTMLAttributes<HTMLElement> => ({
    onPointerDown: (event) => {
      if (!enabled) return;
      if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
      cancelSurface.current?.();
      const target = event.currentTarget;
      const startY = event.clientY;
      const startX = event.clientX;
      const pointerId = event.pointerId;
      const timer = window.setTimeout(() => {
        drag.current = { from: index, target: index, after: false };
        if (holdDelayMs > 0) {
          target.dataset.reorderHolding = 'true';
          try { target.setPointerCapture?.(pointerId); } catch { /* Window listeners remain active. */ }
        }
        if (visualPreview) {
          const bounds = target.getBoundingClientRect();
          const clone = target.cloneNode(true) as HTMLElement;
          clone.className = 'ui-reorder-preview';
          clone.setAttribute('aria-hidden', 'true'); clone.setAttribute('tabindex', '-1');
          clone.removeAttribute('id'); clone.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
          Object.assign(clone.style, { left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px`, color: getComputedStyle(target).color });
          document.body.appendChild(clone); preview.current = clone;
          target.closest<HTMLElement>('[data-reorder-index]')?.setAttribute('data-reorder-dragging', 'true');
        }
        try { navigator.vibrate?.(15); } catch { /* Haptics are optional. */ }
      }, holdDelayMs || 350);
      const move = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== pointerId) return;
        const distance = holdDelayMs > 0 ? Math.hypot(pointerEvent.clientX - startX, pointerEvent.clientY - startY) : Math.abs(pointerEvent.clientY - startY);
        if (!drag.current && distance > 10) { window.clearTimeout(timer); cleanup(); return; }
        if (drag.current) pointerEvent.preventDefault();
        if (preview.current) preview.current.style.transform = `translateY(${pointerEvent.clientY - startY}px)`;
        updateDragTarget(pointerEvent.clientY);
      };
      const finish = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== pointerId) return;
        window.clearTimeout(timer); updateDragTarget(pointerEvent.clientY);
        const current = drag.current;
        if (current) suppressClickUntil.current = performance.now() + 500;
        if (current && current.target !== current.from) onChange(moveEntry(items, current.from, current.target, current.after));
        drag.current = null; cleanup();
      };
      const cancel = () => { window.clearTimeout(timer); drag.current = null; cleanup(); };
      const touchMove = (touchEvent: TouchEvent) => { if (drag.current && touchEvent.cancelable) touchEvent.preventDefault(); };
      const cleanup = () => { delete target.dataset.reorderHolding; clearPreview(); cancelSurface.current = undefined; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', cancel); target.removeEventListener('touchmove', touchMove); };
      cancelSurface.current = cancel;
      window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', cancel);
      if (holdDelayMs > 0) target.addEventListener('touchmove', touchMove, { passive: false });
      else try { target.setPointerCapture?.(event.pointerId); } catch { /* Window listeners also cover unavailable or cancelled capture. */ }
    },
    onClick: (event) => { if (performance.now() < suppressClickUntil.current) { event.preventDefault(); event.stopPropagation(); } },
    onTouchEnd: (event) => { if (performance.now() < suppressClickUntil.current) event.preventDefault(); },
  });
  const handle = (index: number, label: string): ReactNode => <button
    type="button"
    draggable={holdDelayMs === 0}
    className={`ui-reorder-handle${holdDelayMs > 0 ? ' requires-hold' : ''}`}
    aria-label={`Reorder ${label}`}
    onContextMenu={(event) => { if (holdDelayMs > 0) event.preventDefault(); }}
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
      if (holdDelayMs > 0) { surface(index).onPointerDown?.(event); return; }
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
      if (holdDelayMs > 0) return;
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
  return { container, rowProps, handle, surface };
}
