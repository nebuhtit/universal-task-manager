import * as Automerge from '@automerge/automerge';
import type { ReconcileResult, WorkspaceDocument } from '@utm/core';

const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function commitWorkspaceDocument(document: Automerge.Doc<WorkspaceDocument>, message: string, mutation: (draft: WorkspaceDocument) => void, now = new Date()): Automerge.Doc<WorkspaceDocument> {
  return Automerge.change(document, message, (draft) => { mutation(draft as unknown as WorkspaceDocument); draft.updatedAt = now.toISOString(); });
}

export function applyReconciliationResult(document: Automerge.Doc<WorkspaceDocument>, result: ReconcileResult, now: Date, message = 'Workspace reconciliation'): Automerge.Doc<WorkspaceDocument> {
  return commitWorkspaceDocument(document, message, (workspace) => {
    result.created.forEach((item) => { if (!workspace.items[item.id]) workspace.items[item.id] = clean(item); });
    [...result.updated, ...result.autoClosed].forEach((item) => { workspace.items[item.id] = clean(item); });
    result.removedIds.forEach((id) => { workspace.tombstones[id] = now.toISOString(); delete workspace.items[id]; });
  }, now);
}
