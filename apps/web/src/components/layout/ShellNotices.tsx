import { Button } from '../ui/primitives';
import { useClockMilliseconds } from '../../hooks/useClock';
import type { WorkspaceLanguage } from '@utm/core';
import { UserDataText, useTranslation } from '../../i18n-react';

export type UndoNotice = { id: string; label: string; expiresAt: number };

function UndoCountdown({ expiresAt, language }: { expiresAt: number; language: WorkspaceLanguage }) {
  const now = useClockMilliseconds(200);
  const t = useTranslation(language);
  const secondsLeft = Math.max(1, Math.ceil((expiresAt - Math.max(now, Date.now())) / 1_000));
  return <strong aria-label={t(`${secondsLeft} seconds remaining`)}>{secondsLeft}</strong>;
}

export function ShellNotices({ toast, undoNotices = [], onUndo, language = 'en' }: {
  toast: string;
  undoNotices?: UndoNotice[];
  onUndo?: (id: string) => void;
  language?: WorkspaceLanguage;
}) {
  const t = useTranslation(language);
  return <>
    {undoNotices.length > 0 && <div className="undo-toast-stack">{undoNotices.map((notice) => <div className="toast undo-toast" role="status" key={notice.id}><span>{t(notice.label)}</span><UndoCountdown expiresAt={notice.expiresAt} language={language} /><Button size="compact" onClick={() => onUndo?.(notice.id)}>{t('Undo')}</Button></div>)}</div>}
    {toast && <div className="toast" role="status"><UserDataText>{toast}</UserDataText></div>}
  </>;
}
