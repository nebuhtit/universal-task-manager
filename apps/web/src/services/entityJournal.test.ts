import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { createItem, createWorkspace } from '@utm/core';
import { createAutomergeDocument, randomKey } from '@utm/sdk';
import { clearEntityJournal, journalSnapshot, readEntityJournal, recordEntityChanges, setEntityJournalEnabled } from './entityJournal';

let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
});
afterEach(() => vi.unstubAllGlobals());

it('is opt-in and stores encrypted before/after snapshots of edits and deletions', async () => {
  const key = await randomKey(), initial = createAutomergeDocument(createWorkspace('Test'));
  const item = createItem('Private sentinel');
  const added = Automerge.change(initial, draft => { draft.items[item.id] = item; });
  recordEntityChanges(initial, added, 'Create item', key);
  expect((await readEntityJournal(initial.workspaceId, key)).entries).toEqual([]);
  setEntityJournalEnabled(true);
  recordEntityChanges(initial, added, 'Create item', key);
  const edited = Automerge.change(added, draft => { draft.items[item.id]!.title = 'Edited sentinel'; });
  recordEntityChanges(added, edited, 'Edit item', key);
  const deleted = Automerge.change(edited, draft => { delete draft.items[item.id]; });
  recordEntityChanges(edited, deleted, 'Delete item', key);
  const journal = await readEntityJournal(initial.workspaceId, key);
  expect(journal.entries).toHaveLength(3);
  expect(journal.entries[1]).toMatchObject({ operation: 'Edit item', changes: [{ id: item.id, before: { value: { title: 'Private sentinel' } }, after: { value: { title: 'Edited sentinel' } } }] });
  expect(journal.entries[2]).toMatchObject({ changes: [{ after: { value: null } }] });
  expect(JSON.stringify([...storage.values()])).not.toContain('sentinel');
  await expect(readEntityJournal(initial.workspaceId, await randomKey())).rejects.toThrow();
  expect((await readEntityJournal('another-workspace', key)).entries).toEqual([]);
  await clearEntityJournal(initial.workspaceId);
  expect((await readEntityJournal(initial.workspaceId, key)).entries).toEqual([]);
});

it('records view JSON but not preference-only changes, and bounds history', async () => {
  setEntityJournalEnabled(true);
  const key = await randomKey();
  let doc = createAutomergeDocument(createWorkspace('Test'));
  const viewId = Object.keys(doc.views)[0]!;
  for (let n = 0; n < 35; n++) {
    const next = Automerge.change(doc, draft => { draft.views[viewId]!.name = `View ${n}`; });
    recordEntityChanges(doc, next, 'Edit view', key);
    await readEntityJournal(doc.workspaceId, key);
    doc = next;
  }
  expect((await readEntityJournal(doc.workspaceId, key)).entries).toHaveLength(32);
  const next = Automerge.change(doc, draft => { draft.name = 'Changed workspace only'; });
  recordEntityChanges(doc, next, 'Preferences', key);
  expect((await readEntityJournal(doc.workspaceId, key)).entries).toHaveLength(32);
});

it('redacts credential fields and bounds large snapshots', () => {
  expect(journalSnapshot({ accessToken: 'secret', title: 'kept' }).value).toEqual({ accessToken: '[redacted]', title: 'kept' });
  expect(journalSnapshot({ body: 'x'.repeat(20000) }).truncated).toBe(true);
});

it('bounds queued work and contains storage failures without rejecting edits', async () => {
  setEntityJournalEnabled(true);
  const key = await randomKey();
  let doc = createAutomergeDocument(createWorkspace('Test'));
  const item = createItem('Burst item');
  doc = Automerge.change(doc, draft => { draft.items[item.id] = item; });
  for (let n = 0; n < 12; n++) {
    const next = Automerge.change(doc, draft => { draft.items[item.id]!.title = `Edit ${n}`; });
    recordEntityChanges(doc, next, 'Edit', key); doc = next;
  }
  expect((await readEntityJournal(doc.workspaceId, key)).entries).toHaveLength(4);
  const next = Automerge.change(doc, draft => { draft.items[item.id]!.title = 'Final'; });
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
  expect(() => recordEntityChanges(doc, next, 'Edit', key)).not.toThrow();
  await expect(readEntityJournal(doc.workspaceId, key)).resolves.toMatchObject({ format: 'utm-private-entity-journal-v1' });
  expect(next.items[item.id]!.title).toBe('Final');
});
