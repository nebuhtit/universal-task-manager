import type { WorkspaceDocument } from '@utm/core';

export function DiagnosticsSettings({ workspace, count, onEnabledChange, onDownload, onClear }: {
  workspace: WorkspaceDocument;
  count: number;
  onEnabledChange: (enabled: boolean) => void;
  onDownload: () => void;
  onClear: () => void;
}) {
  return <details className="settings-disclosure"><summary>Diagnostics</summary><section className="settings-card diagnostics-card">
    <p className="eyebrow">DIAGNOSTICS</p><h2>Actions, results and error log</h2>
    <p>Local diagnostics record operation names, results, durations and crashes without task content. Nothing is uploaded automatically.</p>
    <label className="check"><input type="checkbox" checked={workspace.calendarPreferences.diagnosticsEnabled !== false} onChange={(event) => onEnabledChange(event.target.checked)} />Record local diagnostics</label>
    <div className="diagnostics-actions"><span>{count} recorded entries</span><button className="secondary" onClick={onDownload} disabled={!count}>Download log</button><button className="secondary" onClick={onClear}>Clear log</button></div>
  </section></details>;
}
