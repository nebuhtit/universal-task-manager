const activeGuards = new WeakMap<Document, () => void>();

/** Layout can change on pointerup before Safari dispatches touchend/click.
 * Consume that release at document capture, even if its target has changed.
 * A fresh press or keyboard action immediately restores normal interaction. */
export function consumeReleaseClick(document: Document): void {
  activeGuards.get(document)?.();
  const capture = { capture: true };
  const consume = (event: Event) => {
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
  };
  const clear = () => {
    clearTimeout(timer);
    document.removeEventListener('click', consume, capture);
    document.removeEventListener('touchend', consume, capture);
    document.removeEventListener('pointerdown', clear, capture);
    document.removeEventListener('keydown', clear, capture);
    activeGuards.delete(document);
  };
  const timer = setTimeout(clear, 800);
  document.addEventListener('click', consume, capture);
  document.addEventListener('touchend', consume, { capture: true, passive: false });
  document.addEventListener('pointerdown', clear, capture);
  document.addEventListener('keydown', clear, capture);
  activeGuards.set(document, clear);
}
