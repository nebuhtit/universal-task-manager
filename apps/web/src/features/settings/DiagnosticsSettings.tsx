import type { WorkspaceDocument } from '@utm/core';
import { useState } from 'react';
import { Button } from '../../components/ui/primitives';
import { clearEntityJournal, entityJournalEnabled, readEntityJournal, setEntityJournalEnabled } from '../../services/entityJournal';

export function DiagnosticsSettings({ workspace, count, onEnabledChange, onDownload, onClear, getDataKey, downloadPrivate }: {
  workspace: WorkspaceDocument;
  count: number;
  onEnabledChange: (enabled: boolean) => void;
  onDownload: () => void;
  onClear: () => void;
  getDataKey: () => Uint8Array | null;
  downloadPrivate: (content: string, filename: string) => Promise<void>;
}) {
  const [privateEnabled, setPrivateEnabled] = useState(entityJournalEnabled);
  const [privateBusy, setPrivateBusy] = useState(false);
  const [privateMessage, setPrivateMessage] = useState('');
  const privateAction = async (clear: boolean) => {
    setPrivateBusy(true); setPrivateMessage('');
    try {
      if (clear) { await clearEntityJournal(workspace.workspaceId); setPrivateMessage('Private journal cleared.'); }
      else {
        const key = getDataKey();
        if (!key) throw new Error('Unlock the workspace first.');
        const journal = await readEntityJournal(workspace.workspaceId, key);
        await downloadPrivate(JSON.stringify(journal, null, 2), 'utm-private-item-view-journal.json');
      }
    } catch { setPrivateMessage('Could not read, export or clear the private journal. Workspace data is unchanged.'); }
    finally { setPrivateBusy(false); }
  };
  return <details className="settings-disclosure"><summary>Diagnostics</summary><section className="settings-card diagnostics-card">
    <p className="eyebrow">DIAGNOSTICS</p><h2>Actions, results and error log</h2>
    <p>Local diagnostics record operation names, results, durations and crashes without task content. Nothing is uploaded automatically.</p>
    <label className="check"><input type="checkbox" checked={workspace.calendarPreferences.diagnosticsEnabled !== false} onChange={(event) => onEnabledChange(event.target.checked)} />Record local diagnostics</label>
    <div className="diagnostics-actions"><span>{count} recorded entries</span><button className="secondary" onClick={onDownload} disabled={!count}>Download log</button><button className="secondary" onClick={onClear}>Clear log</button></div>
    <h3>Private item / view change journal</h3>
    <p>Optional JSON before/after edits, UTC time and operation. Contains personal text. Stored encrypted on this device; exported separately as readable JSON. Only future edits are recorded. Limited to 32 operations / 1 MB, 10 changed objects per operation; large values and bursts may be omitted. Not a backup or proof that saving finished. Turning off does not erase existing entries.</p>
    <label className="check"><input type="checkbox" checked={privateEnabled} onChange={event => { setEntityJournalEnabled(event.target.checked); setPrivateEnabled(entityJournalEnabled()); }} />Record private item / view JSON</label>
    <div className="diagnostics-actions"><Button disabled={privateBusy} onClick={() => void privateAction(false)}>Export private JSON</Button><Button disabled={privateBusy} onClick={() => void privateAction(true)}>Clear private journal</Button></div>
    {privateMessage && <p role="status">{privateMessage}</p>}
  </section></details>;
}
