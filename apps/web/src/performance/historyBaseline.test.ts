import * as Automerge from '@automerge/automerge';
import { expect, it } from 'vitest';
import { createAutomergeDocument } from '@utm/sdk';
import { createItem, createWorkspace, type WorkspaceDocument } from '@utm/core';
import { commitWorkspaceDocument } from '../services/workspaceLifecycle';

const extended = process.env.UTM_PERF_BASELINE === '1';
it.skipIf(!extended)('measures save/load with 1,000 items and 2,000 historical edits', () => {
  const workspace = createWorkspace('Synthetic history');
  for (let index = 0; index < 1000; index++) { const item = createItem(`Task ${index}`); workspace.items[item.id] = item; }
  let doc = createAutomergeDocument(workspace);
  const ids = Object.keys(workspace.items);
  for (let index = 0; index < 2000; index++) doc = commitWorkspaceDocument(doc, 'Synthetic edit', draft => { const item = draft.items[ids[index % ids.length]!]!; item.title = `Revision ${index}`; item.revision++; });
  let start = performance.now(); const binary = Automerge.save(doc); const saveMs = performance.now() - start;
  start = performance.now(); const loaded = Automerge.load<WorkspaceDocument>(binary); const loadMs = performance.now() - start;
  start = performance.now(); const edited = commitWorkspaceDocument(loaded, 'Edit after reload', draft => { draft.items[ids[0]!]!.title = 'Final edit'; }); const editMs = performance.now() - start;
  expect(edited.items[ids[0]!]!.title).toBe('Final edit');
  expect(Object.keys(loaded.items)).toHaveLength(1000);
  expect(Automerge.getHeads(loaded)).toEqual(Automerge.getHeads(doc));
  console.info('[utm-history-performance]', JSON.stringify({ itemCount: 1000, historicalEdits: 2000, bytes: binary.byteLength, saveMs, loadMs, editMs }));
}, 120_000);
