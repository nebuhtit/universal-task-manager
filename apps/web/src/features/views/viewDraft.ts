import type { SavedView, WorkspaceDocument } from '@utm/core';

const detached = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Replace view values without replacing the Automerge object stored in the map. */
export function saveViewDraft(draft: WorkspaceDocument, saved: SavedView): void {
  const snapshot = detached(saved) as unknown as Record<string, unknown>;
  const target = draft.views[saved.id] as unknown as Record<string, unknown> | undefined;
  if (!target) {
    draft.views[saved.id] = snapshot as unknown as SavedView;
    return;
  }
  for (const key of Object.keys(target)) if (!(key in snapshot)) delete target[key];
  Object.assign(target, snapshot);
}

/** Mutate only scalar filter leaves; spreading extensions can reattach CRDT proxies. */
export function applyViewFilterDraft(view: SavedView, source: string, python?: string): void {
  view.query.source = source;
  view.extensions ??= {};
  if (python === undefined) delete view.extensions.filterPython;
  else view.extensions.filterPython = python;
}
