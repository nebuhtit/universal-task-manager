import { Dialog } from '@base-ui/react/dialog';
import type { ComponentProps, ReactNode, RefObject } from 'react';

export interface ResponsiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  initialFocus?: boolean | RefObject<HTMLElement | null>;
  finalFocus?: ComponentProps<typeof Dialog.Popup>['finalFocus'];
  closeLabel?: string;
  ariaLabel?: string;
}

/**
 * One accessible modal contract: centered dialog on desktop and bottom sheet
 * presentation on narrow screens. Base UI owns focus trapping/restoration,
 * Escape handling, outside interaction, and portal behavior.
 */
export function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  initialFocus,
  finalFocus,
  closeLabel = 'Close dialog',
  ariaLabel,
}: ResponsiveDialogProps) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Backdrop className="ui-dialog-backdrop" />
      <Dialog.Viewport className="ui-dialog-viewport">
        <Dialog.Popup
          className={['ui-dialog-popup', className].filter(Boolean).join(' ')}
          aria-label={ariaLabel}
          initialFocus={initialFocus}
          finalFocus={finalFocus}
        >
          <header className="ui-dialog-header">
            <div>
              <Dialog.Title className="ui-dialog-title" aria-label={ariaLabel}>{title}</Dialog.Title>
              {description && <Dialog.Description className="ui-dialog-description">{description}</Dialog.Description>}
            </div>
            <Dialog.Close className="ui-dialog-close" aria-label={closeLabel}>×</Dialog.Close>
          </header>
          <div className="ui-dialog-content">{children}</div>
          {footer && <footer className="ui-dialog-footer">{footer}</footer>}
        </Dialog.Popup>
      </Dialog.Viewport>
    </Dialog.Portal>
  </Dialog.Root>;
}
