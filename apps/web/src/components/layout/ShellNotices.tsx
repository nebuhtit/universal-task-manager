import { CloseIcon } from '../ui/icons';
import { Button, IconButton } from '../ui/primitives';

export function ShellNotices({ backupReminder, toast, onBackup, onDismissBackup }: {
  backupReminder: boolean;
  toast: string;
  onBackup: () => void;
  onDismissBackup: () => void;
}) {
  return <>
    {backupReminder && <div className="toast backup-reminder" role="alert"><span>It is time to create an encrypted backup.</span><Button size="compact" onClick={onBackup}>Back up now</Button><IconButton size="compact" variant="ghost" aria-label="Dismiss backup reminder" onClick={onDismissBackup}><CloseIcon /></IconButton></div>}
    {toast && <div className="toast" role="status">{toast}</div>}
  </>;
}
