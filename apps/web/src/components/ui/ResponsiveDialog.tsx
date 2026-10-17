import { Dialog } from '@base-ui/react/dialog';
import { useState, type ComponentProps, type ReactNode, type RefObject } from 'react';
import { WarningNoticeHost } from './WarningNotice';

export interface ResponsiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  backdropClassName?: string;
  initialFocus?: boolean | RefObject<HTMLElement | null>;
  finalFocus?: ComponentProps<typeof Dialog.Popup>['finalFocus'];
  closeLabel?: string;
  ariaLabel?: string;
  modal?: boolean;
  disablePointerDismissal?: boolean;
}

/**
 * One accessible dialog contract: modal by default, centered on desktop and bottom sheet
 * presentation on narrow screens. Base UI owns focus trapping/restoration,
 * Escape handling, outside interaction, and portal behavior. Non-modal windows
 * can keep app navigation and capture controls interactive.
 */
export function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  backdropClassName,
  initialFocus,
  finalFocus,
  closeLabel = 'Close dialog',
  ariaLabel,
  modal = true,
  disablePointerDismissal = false,
}: ResponsiveDialogProps) {
  const [noticeHost, setNoticeHost] = useState<HTMLDivElement | null>(null);
  return <Dialog.Root open={open} onOpenChange={onOpenChange} modal={modal} disablePointerDismissal={disablePointerDismissal}>
    <Dialog.Portal>
      {modal && <Dialog.Backdrop className={['ui-dialog-backdrop', 'is-glass', backdropClassName].filter(Boolean).join(' ')} />}
      <Dialog.Viewport className="ui-dialog-viewport">
        <Dialog.Popup
          className={['ui-dialog-popup', 'is-glass', className].filter(Boolean).join(' ')}
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
          <div className="warning-notice-stack" ref={setNoticeHost} />
          <WarningNoticeHost.Provider value={noticeHost}><div className="ui-dialog-content">{children}</div></WarningNoticeHost.Provider>
          {footer && <footer className="ui-dialog-footer">{footer}</footer>}
        </Dialog.Popup>
      </Dialog.Viewport>
    </Dialog.Portal>
  </Dialog.Root>;
}
