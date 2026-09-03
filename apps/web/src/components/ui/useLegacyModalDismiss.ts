import { useEffect } from 'react';

/**
 * Bridges older modal-backdrop dialogs until they are migrated to
 * ResponsiveDialog. A background click only dismisses the visible window;
 * it never reaches the page beneath it.
 */
export function useLegacyModalDismiss(open: boolean, onDismiss: () => void) {
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.classList.contains('modal-backdrop')) return;
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
    };
    document.addEventListener('click', dismiss, true);
    return () => document.removeEventListener('click', dismiss, true);
  }, [onDismiss, open]);
}
