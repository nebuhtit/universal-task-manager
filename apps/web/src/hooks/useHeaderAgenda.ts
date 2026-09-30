import { useEffect, useMemo, useRef, useState } from 'react';
import { itemDeletionTime, type WorkspaceDocument } from '@utm/core';
import type { AgendaEntry, HeaderAgenda } from '../components/layout/headerAgendaModel';
import { createHeaderAgendaRunner, headerAgendaInput } from '../services/headerAgendaWorker';
import { recordDiagnostic } from '../services/diagnostics';

export function useHeaderAgenda(workspace: WorkspaceDocument | undefined, now: number): HeaderAgenda | undefined {
  const input = useMemo(() => workspace ? headerAgendaInput(workspace) : undefined, [workspace]);
  const runner = useRef<ReturnType<typeof createHeaderAgendaRunner> | undefined>(undefined);
  const [result, setResult] = useState<{ workspaceId: string; agenda: HeaderAgenda }>();
  useEffect(() => {
    if (!input) { runner.current?.dispose(); runner.current = undefined; setResult(undefined); return; }
    runner.current ??= createHeaderAgendaRunner((agenda, workspaceId) => setResult({ agenda, workspaceId }), () => {
      recordDiagnostic({ kind: 'error', operation: 'Header agenda', message: 'Background header calculation failed; previous result retained' });
    });
    runner.current.update(input, now);
  }, [input, now]);
  useEffect(() => () => { runner.current?.dispose(); runner.current = undefined; }, []);
  if (!workspace || result?.workspaceId !== workspace.workspaceId) return undefined;
  // Keep the previous result while calculating, except explicitly deleted entries.
  const visible = (entry: AgendaEntry | undefined) => {
    if (!entry) return false;
    const id = entry.id.split('/')[0]!;
    const item = workspace.items[id];
    return !workspace.tombstones[id] && (!item || !itemDeletionTime(workspace, item));
  };
  const { current, next, concurrent, ...rest } = result.agenda;
  const kept = concurrent.filter(visible);
  return { ...rest, concurrent: kept, additional: kept.length,
    ...(visible(current) ? { current: current! } : {}), ...(visible(next) ? { next: next! } : {}) };
}
