import { Button } from '../ui/primitives';

export type UndoNotice = { id: string; label: string; secondsLeft: number };

export function ShellNotices({ toast, undoNotices = [], onUndo }: {
  toast: string;
  undoNotices?: UndoNotice[];
  onUndo?: (id: string) => void;
}) {
  return <>
    {undoNotices.length > 0 && <div className="undo-toast-stack">{undoNotices.map((notice) => <div className="toast undo-toast" role="status" key={notice.id}><span>{notice.label}</span><strong aria-label={`${notice.secondsLeft} seconds remaining`}>{notice.secondsLeft}</strong><Button size="compact" onClick={() => onUndo?.(notice.id)}>Undo</Button></div>)}</div>}
    {toast && <div className="toast" role="status">{toast}</div>}
  </>;
}
