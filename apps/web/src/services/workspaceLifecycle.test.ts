import { describe, expect, it } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { createItem, createOccurrence, createWorkspace, ensureAreaDefinition, ensureProjectDefinition, ensureTagDefinition, makeSeries, reconcileRecurrences, renameProjectDefinition, reorderTagSubset, type WorkspaceDocument } from '@utm/core';
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

  it('repairs premature legacy auto-close inside an Automerge transaction', () => {
    const now = new Date('2026-08-31T15:25:40.007Z');
    const workspace = createWorkspace('Recurrence repair', now);
    const source = createItem('Sleep', 'event', now);
    source.schedule = { timezone: 'Europe/Moscow', startAt: '2026-08-31T19:00:00.000Z', endAt: '2026-08-31T20:00:00.000Z', estimatedDuration: 'PT1H' };
    const series = makeSeries(source, 'FREQ=DAILY;INTERVAL=1', { activationOffset: 'P7D', autoRenew: true, closeAt: 'next_activation' });
    series.revision = 7;
    const occurrence = createOccurrence(series, new Date(series.schedule!.startAt!), 0);
    occurrence.state = 'auto_closed'; occurrence.occurrence!.templateRevision = 4;
    occurrence.closure = { actor: 'system', at: '2026-08-25T19:00:00.000Z', reason: 'auto_renew' };
    occurrence.cycleHistory = [{ actor: 'system', closedAt: occurrence.closure.at, reason: 'auto_renew', recurrenceId: occurrence.occurrence!.recurrenceId, state: 'auto_closed' }];
    workspace.items[series.id] = series; workspace.items[occurrence.id] = occurrence;
    const original = Automerge.from(workspace as unknown as Record<string, unknown>) as unknown as Automerge.Doc<WorkspaceDocument>;

    const repaired = commitWorkspaceDocument(original, 'Repair recurrence', (draft) => { reconcileRecurrences(draft, now); }, now);
    expect(repaired.items[occurrence.id]?.state).toBe('open');
    expect(repaired.items[occurrence.id]?.closure).toBeUndefined();
    expect(repaired.items[occurrence.id]?.cycleHistory).toEqual([]);
  });

  it('refreshes a rolling recurrence without writing undefined history to Automerge', () => {
    const now = new Date('2026-08-24T12:00:00.000Z');
    const workspace = createWorkspace('Recurring save', now);
    const source = createItem('Prepare lessons', 'task', new Date('2026-08-01T00:00:00.000Z'));
    source.schedule = { timezone: 'UTC', startAt: '2026-08-24T09:00:00.000Z', dueAt: '2026-08-24T18:00:00.000Z' };
    const series = makeSeries(source, 'FREQ=WEEKLY;BYDAY=MO', { activationOffset: 'PT0M', closeAt: 'due', autoRenew: true });
    workspace.items[series.id] = series;
    reconcileRecurrences(workspace, now);
    const occurrence = Object.values(workspace.items).find((item) => item.occurrence?.seriesId === series.id)!;
    delete occurrence.cycleHistory;
    const original = Automerge.from(workspace as unknown as Record<string, unknown>) as unknown as Automerge.Doc<WorkspaceDocument>;

    const saved = commitWorkspaceDocument(original, 'Save recurring item', (draft) => {
      const target = draft.items[series.id]!;
      target.revision += 1;
      target.updatedAt = '2026-08-24T12:01:00.000Z';
      reconcileRecurrences(draft, new Date(target.updatedAt));
    }, new Date('2026-08-24T12:01:00.000Z'));

    expect(saved.items[occurrence.id]?.state).toBe('open');
    expect(saved.items[occurrence.id]?.cycleHistory).toEqual([]);
    expect(saved.items[occurrence.id]?.occurrence?.templateRevision).toBe(saved.items[series.id]?.revision);
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
