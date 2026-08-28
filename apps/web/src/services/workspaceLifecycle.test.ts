import { describe, expect, it } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { createItem, createWorkspace, ensureAreaDefinition, ensureProjectDefinition, ensureTagDefinition, renameProjectDefinition, reorderTagSubset, type WorkspaceDocument } from '@utm/core';
import { applyReconciliationResult, commitWorkspaceDocument } from './workspaceLifecycle';

const document = () => Automerge.from(createWorkspace('Integration') as unknown as Record<string, unknown>) as unknown as Automerge.Doc<WorkspaceDocument>;

describe('workspace lifecycle integration', () => {
  it('commits a mutation and updates the workspace timestamp atomically', () => {
    const item = createItem('Persist me');
    const next = commitWorkspaceDocument(document(), 'Create item', (draft) => { draft.items[item.id] = item; }, new Date('2026-08-26T12:00:00Z'));
    expect(next.items[item.id]?.title).toBe('Persist me');
    expect(next.updatedAt).toBe('2026-08-26T12:00:00.000Z');
  });

  it('applies created, updated, auto-closed and removed recurrence changes in one document', () => {
    const base = document(); const removed = createItem('Removed'); const updated = createItem('Before');
    const seeded = commitWorkspaceDocument(base, 'Seed', (draft) => { draft.items[removed.id] = removed; draft.items[updated.id] = updated; });
    const created = createItem('Created'); const changed = { ...updated, title: 'After' }; const closed = createItem('Closed'); closed.state = 'auto_closed';
    const now = new Date('2026-08-26T13:00:00Z');
    const next = applyReconciliationResult(seeded, { created: [created], updated: [changed], autoClosed: [closed], removedIds: [removed.id], untouched: 0 }, now);
    expect(next.items[created.id]?.title).toBe('Created'); expect(next.items[updated.id]?.title).toBe('After'); expect(next.items[closed.id]?.state).toBe('auto_closed');
    expect(next.items[removed.id]).toBeUndefined(); expect(next.tombstones[removed.id]).toBe(now.toISOString());
  });

  it('renames a Project inside an Automerge transaction', () => {
    const base = createWorkspace('Rename integration');
    ensureAreaDefinition(base, 'Work'); ensureProjectDefinition(base, 'Launch', { areas: ['Work'] });
    const source = Automerge.from(base as unknown as Record<string, unknown>) as unknown as Automerge.Doc<WorkspaceDocument>;
    const next = commitWorkspaceDocument(source, 'Rename Project', (draft) => { renameProjectDefinition(draft, 'Launch', 'Release'); });
    expect(next.projectDefinitions.Launch).toBeUndefined();
    expect(next.projectDefinitions.Release).toMatchObject({ name: 'Release', areas: ['Work'] });
  });

  it('reorders Tags inside an Automerge transaction', () => {
    const base = createWorkspace('Tag reorder integration');
    ensureTagDefinition(base, 'a'); ensureTagDefinition(base, 'b');
    const source = Automerge.from(base as unknown as Record<string, unknown>) as unknown as Automerge.Doc<WorkspaceDocument>;
    const next = commitWorkspaceDocument(source, 'Reorder Tags', (draft) => { reorderTagSubset(draft, ['b', 'a']); });
    expect(next.organizationPreferences.tagOrder.filter(Boolean)).toEqual(['b', 'a']);
    expect(next.organizationPreferences.priorityOrder.filter((entry) => entry.kind === 'tag' && entry.name !== null).map((entry) => entry.name)).toEqual(['b', 'a']);
  });
});
