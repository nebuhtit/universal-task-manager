import * as Automerge from '@automerge/automerge';
import type { ReconcileResult, WorkspaceDocument } from '@utm/core';

const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Reuse a freshly loaded backend; only a retried historical head needs a fork. */
export function writableWorkspaceDocument(document: Automerge.Doc<WorkspaceDocument>): Automerge.Doc<WorkspaceDocument> {
  try {
    // A no-op change checks writability without creating operations or a second
    // WASM backend. Cloning every loaded document doubles its full history,
    // even when only a handful of current items remain.
    return Automerge.change(document, () => undefined);
  } catch (reason) {
    if (reason instanceof RangeError && /outdated document/i.test(reason.message)) return Automerge.clone(document);
    throw reason;
  }
}

export function commitWorkspaceDocument(document: Automerge.Doc<WorkspaceDocument>, message: string, mutation: (draft: WorkspaceDocument) => void, now = new Date()): Automerge.Doc<WorkspaceDocument> {
  return Automerge.change(document, message, (draft) => { mutation(draft as unknown as WorkspaceDocument); draft.updatedAt = now.toISOString(); });
}

export function applyReconciliationResult(document: Automerge.Doc<WorkspaceDocument>, result: ReconcileResult, now: Date, message = 'Workspace reconciliation'): Automerge.Doc<WorkspaceDocument> {
  // An empty check must not grow CRDT history or request another full save.
  if (!result.created.length && !result.updated.length && !result.autoClosed.length && !result.removedIds.length) return document;
  return commitWorkspaceDocument(document, message, (workspace) => {
    result.created.forEach((item) => { if (!workspace.items[item.id]) workspace.items[item.id] = clean(item); });
    [...result.updated, ...result.autoClosed].forEach((item) => { workspace.items[item.id] = clean(item); });
    result.removedIds.forEach((id) => { workspace.tombstones[id] = now.toISOString(); delete workspace.items[id]; });
  }, now);
}
