import { CloseIcon } from '../ui/icons';
import { Button, IconButton } from '../ui/primitives';

export type UndoNotice = { id: string; label: string; secondsLeft: number };

export function ShellNotices({ backupReminder, toast, undoNotices = [], onUndo, onBackup, onDismissBackup }: {
  backupReminder: boolean;
  toast: string;
  undoNotices?: UndoNotice[];
  onUndo?: (id: string) => void;
  onBackup: () => void;
  onDismissBackup: () => void;
}) {
  return <>
    {backupReminder && <div className="toast backup-reminder" role="alert"><span>It is time to create an encrypted backup.</span><Button size="compact" onClick={onBackup}>Back up now</Button><IconButton size="compact" variant="ghost" aria-label="Dismiss backup reminder" onClick={onDismissBackup}><CloseIcon /></IconButton></div>}
    {undoNotices.length > 0 && <div className="undo-toast-stack">{undoNotices.map((notice) => <div className="toast undo-toast" role="status" key={notice.id}><span>{notice.label}</span><strong aria-label={`${notice.secondsLeft} seconds remaining`}>{notice.secondsLeft}</strong><Button size="compact" onClick={() => onUndo?.(notice.id)}>Undo</Button></div>)}</div>}
    {toast && <div className="toast" role="status">{toast}</div>}
  </>;
}
