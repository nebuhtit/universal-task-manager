import * as Automerge from '@automerge/automerge';
import { createWorkspace, type SavedView, type WorkspaceDocument } from '@utm/core';
import { describe, expect, it } from 'vitest';
import { applyViewFilterDraft, saveViewDraft } from './viewDraft';

const makeView = (): SavedView => ({
  id: 'view-1', name: 'Work', query: { source: 'state == "open"' }, renderer: 'list', sort: [], fields: ['title'],
  extensions: { filterPython: 'return True', 'utm:custom': { nested: { enabled: true } } },
});

const makeDocument = () => {
  const workspace = createWorkspace('View draft test');
  workspace.views['view-1'] = makeView();
  return Automerge.from(workspace as unknown as Record<string, unknown>) as unknown as Automerge.Doc<WorkspaceDocument>;
};

describe('Automerge-safe view updates', () => {
  it('updates an existing view using detached values without replacing the CRDT map entry', () => {
    const doc = makeDocument();
    const saved = { ...makeView(), name: 'Updated', extensions: { filterPython: 'return False', 'utm:custom': { nested: { enabled: false } } } };
    const next = Automerge.change(doc, draft => saveViewDraft(draft as unknown as WorkspaceDocument, saved));
    expect(next.views['view-1']?.name).toBe('Updated');
    expect(next.views['view-1']?.extensions?.['utm:custom']).toEqual({ nested: { enabled: false } });
  });

  it('changes filter leaves without reassigning existing nested extension proxies', () => {
    const doc = makeDocument();
    const next = Automerge.change(doc, draft => applyViewFilterDraft(draft.views['view-1'] as SavedView, 'state == "done"', 'return False'));
    expect(next.views['view-1']?.query.source).toBe('state == "done"');
    expect(next.views['view-1']?.extensions?.filterPython).toBe('return False');
    expect(next.views['view-1']?.extensions?.['utm:custom']).toEqual({ nested: { enabled: true } });
  });
});
