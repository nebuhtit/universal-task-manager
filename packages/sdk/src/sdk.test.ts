import * as Automerge from '@automerge/automerge';
import { describe, expect, it } from 'vitest';
import { createItem, createWorkspace } from '@utm/core';
import { createAutomergeDocument, exportContainer, merge, toJSON, unlock, validateContainer } from './container.js';

const password = 'correct horse battery staple';

describe('encrypted .utm container', () => {
  it('round-trips without exposing plaintext', async () => {
    const workspace = createWorkspace('Private');
    const item = createItem('Secret task'); workspace.items[item.id] = item;
    const source = await exportContainer(createAutomergeDocument(workspace), password);
    expect(source).not.toContain('Secret task');
    expect((await validateContainer(source, password)).itemCount).toBe(1);
    expect(await toJSON(source, password)).toContain('Secret task');
  });

  it('rejects a wrong password and tampering', async () => {
    const source = await exportContainer(createAutomergeDocument(createWorkspace()), password);
    await expect(unlock(source, 'this password is incorrect')).rejects.toThrow('Wrong password');
    const damaged = JSON.parse(source) as { envelope: { ciphertext: string } };
    damaged.envelope.ciphertext = `${damaged.envelope.ciphertext.slice(0, -2)}aa`;
    await expect(unlock(JSON.stringify(damaged), password)).rejects.toThrow('damaged');
  });

  it('merges edits made on two devices', async () => {
    const base = createAutomergeDocument(createWorkspace('Merge test'));
    const leftItem = createItem('From left');
    const rightItem = createItem('From right');
    const left = Automerge.change(Automerge.clone(base), (draft) => { draft.items[leftItem.id] = leftItem; });
    const right = Automerge.change(Automerge.clone(base), (draft) => { draft.items[rightItem.id] = rightItem; });
    const result = await merge(left, await exportContainer(right, password), password);
    expect(Object.values(result.document.items).map((item) => item.title).sort()).toEqual(['From left', 'From right']);
  });
});
