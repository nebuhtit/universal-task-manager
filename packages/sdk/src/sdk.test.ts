import * as Automerge from '@automerge/automerge';
import { describe, expect, it } from 'vitest';
import { createId, createItem, createWorkspace } from '@utm/core';
import { createAutomergeDocument, exportContainer, merge, toJSON, unlock, validateContainer } from './container.js';
import { encryptBytes, encryptWithKey, randomKey } from './crypto.js';
import { decryptWorkspaceFile, faceIdStatus } from './storage.js';

const password = 'correct horse battery staple';

describe('encrypted .utmb container', () => {
  it('does not offer Face ID when the platform authenticator API is unavailable', async () => {
    expect(await faceIdStatus()).toBe('unsupported');
  });

  it('round-trips without exposing plaintext', async () => {
    const workspace = createWorkspace('Private');
    const item = createItem('Secret task'); workspace.items[item.id] = item;
    const source = await exportContainer(createAutomergeDocument(workspace), password);
    expect(source).not.toContain('Secret task');
    expect((await validateContainer(source, password)).itemCount).toBe(1);
    expect(await toJSON(source, password)).toContain('Secret task');
  });

  it('decrypts an arbitrary portable backup to documented readable JSON without importing it', async () => {
    const workspace = createWorkspace('Readable recovery');
    const item = createItem('Human-readable task'); workspace.items[item.id] = item;
    const source = await exportContainer(createAutomergeDocument(workspace), password);
    const readable = await decryptWorkspaceFile(source, password);
    expect(readable.format).toBe('utm-readable-workspace');
    expect(readable.source.magic).toBe('UTM-ENCRYPTED');
    expect(readable.readme.importantFields.extensions).toContain('Lossless');
    expect(readable.workspace.items[item.id]?.title).toBe('Human-readable task');
  });

  it.each([
    ['utm:workspace-key:v1', 'utm:local:workspace:v1'],
    ['utm:workspace-key', 'utm:local:block:v1'],
    ['utm:local:key:v1', 'utm:workspace:v1'],
  ])('decrypts local recovery variants inside .utmb (%s / %s)', async (keyAad, blockAad) => {
    const workspace = createWorkspace('Local recovery');
    const item = createItem('Recovered local item'); workspace.items[item.id] = item;
    const dataKey = await randomKey();
    const metadata = { version: 1, wrappedKey: await encryptBytes(dataKey, password, keyAad), createdAt: new Date().toISOString() };
    const encrypted = await encryptWithKey(Automerge.save(createAutomergeDocument(workspace)), dataKey, blockAad);
    const source = JSON.stringify({ magic: 'UTM-LOCAL-ENCRYPTED', version: 1, metadata, workspace: { version: 1, ...encrypted } });
    const readable = await decryptWorkspaceFile(source, password);
    expect(readable.source.magic).toBe('UTM-LOCAL-ENCRYPTED');
    expect(readable.workspace.items[item.id]?.title).toBe('Recovered local item');
  });

  it('keeps computed fields and saved-view defaults through encrypted transfer', async () => {
    const workspace = createWorkspace('Portable calculations');
    const item = createItem('Countdown');
    item.schedule = { timezone: 'UTC', startAt: '2026-08-24T12:00:00.000Z' };
    item.scripts = [{ id: createId(), key: 'seconds_left', label: 'Seconds left', source: 'secondsUntil(schedule.startAt)', resultKind: 'number' }];
    workspace.items[item.id] = item;
    const view = { id: createId(), name: 'Countdowns', query: { source: '' }, renderer: 'table' as const, sort: [], fields: ['title', 'script.seconds_left'], accent: '#00A6A6', creationDefaults: { priority: 3 } };
    workspace.views[view.id] = view;
    const transferred = await exportContainer(createAutomergeDocument(workspace), password);
    const restored = await unlock(transferred, password);
    expect(restored.document.items[item.id]?.scripts).toEqual(item.scripts);
    expect(restored.document.views[view.id]?.accent).toBe('#00A6A6');
    expect(restored.document.views[view.id]?.creationDefaults).toEqual({ priority: 3 });
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
