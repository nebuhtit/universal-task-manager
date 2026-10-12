import { createContext, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './primitives';
import './warning-notice.css';

export const WarningNoticeHost = createContext<HTMLElement | null>(null);

/** Non-modal, dismissible messages stay outside a dialog's scrolling content. */
export function WarningNotice({ message, children, onDismiss, language = 'en' }: { message: string; children?: ReactNode; onDismiss?: () => void; language?: string }) {
  const host = useContext(WarningNoticeHost);
  const [dismissed, setDismissed] = useState<string>();
  if (!message || dismissed === message) return null;
  const notice = <div className="warning-notice" role="alert">
    <div><p>{message}</p>{children}</div>
    <IconButton aria-label={language === 'ru' ? 'Закрыть предупреждение' : 'Dismiss warning'} onClick={() => { setDismissed(message); onDismiss?.(); }}>×</IconButton>
  </div>;
  return host ? createPortal(notice, host) : notice;
}
