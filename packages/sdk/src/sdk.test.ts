import * as Automerge from '@automerge/automerge';
import { describe, expect, it } from 'vitest';
import { createId, createItem, createWorkspace, googleCalendarEventToItem } from '@utm/core';
import { createAutomergeDocument, exportContainer, merge, toJSON, unlock, validateContainer } from './container.js';
import { encryptBytes, encryptWithKey, randomKey } from './crypto.js';
import { decryptWorkspaceFile, faceIdStatus, reencryptWorkspaceFile } from './storage.js';

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

  it('removes Google Calendar data from encrypted snapshots and Automerge history', async () => {
    const workspace = createWorkspace('Private calendar backup');
    const ordinary = createItem('Ordinary task');
    const external = googleCalendarEventToItem({
      id: 'private-event-id', summary: 'PRIVATE GOOGLE EVENT', description: 'PRIVATE GOOGLE DESCRIPTION',
      start: { dateTime: '2026-08-31T10:00:00.000Z' }, end: { dateTime: '2026-08-31T11:00:00.000Z' },
    }, 'private-account@example.com', 'private-connection', '2026-08-31T09:00:00.000Z')!;
    workspace.items[ordinary.id] = ordinary;
    workspace.items[external.id] = external;
    workspace.calendarPreferences.googleCalendar = {
      connectionId: 'private-connection', accountEmail: 'private-account@example.com',
      calendars: [{ id: 'private-account@example.com', name: 'Private calendar', selected: true }],
      syncTokens: { 'private-account@example.com': 'private-sync-token' },
    };

    const source = await exportContainer(createAutomergeDocument(workspace), password);
    const restored = await unlock(source, password);
    const readable = await toJSON(source, password);
    expect(restored.payload.manifest.historyMode).toBe('snapshot');
    expect(restored.document.items[ordinary.id]?.title).toBe('Ordinary task');
    expect(restored.document.items[external.id]).toBeUndefined();
    for (const value of [readable, JSON.stringify(restored.payload.snapshot), JSON.stringify(restored.document), JSON.stringify(Automerge.getHistory(restored.document))]) {
      expect(value).not.toContain('PRIVATE GOOGLE');
      expect(value).not.toContain('private-account@example.com');
      expect(value).not.toContain('private-event-id');
      expect(value).not.toContain('private-sync-token');
    }
  });

  it('removes Google Calendar values that only remain in Automerge history', async () => {
    let document = createAutomergeDocument(createWorkspace('History privacy'));
    document = Automerge.change(document, 'Mirror Google event', (draft) => {
      const external = googleCalendarEventToItem({
        id: 'old-event', summary: 'PRIVATE OLD GOOGLE EVENT',
        start: { dateTime: '2026-08-31T10:00:00.000Z' }, end: { dateTime: '2026-08-31T11:00:00.000Z' },
      }, 'private-calendar@example.com', 'private-connection', '2026-08-31T09:00:00.000Z')!;
      draft.items[external.id] = external;
    });
    document = Automerge.change(document, 'Remove external cache', (draft) => {
      Object.keys(draft.items).forEach((id) => { if (id.startsWith('google:')) delete draft.items[id]; });
    });

    const source = await exportContainer(document, password);
    const restored = await unlock(source, password);
    expect(restored.payload.manifest.historyMode).toBe('snapshot');
    expect(JSON.stringify(Automerge.getHistory(restored.document))).not.toContain('private-calendar@example.com');
    expect(JSON.stringify(restored.payload.snapshot)).not.toContain('PRIVATE OLD GOOGLE EVENT');
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

  it('re-encrypts a verified backup under a new password without changing the source', async () => {
    const workspace = createWorkspace('Rotated backup');
    const item = createItem('Still present'); workspace.items[item.id] = item;
    const source = await exportContainer(createAutomergeDocument(workspace), password);
    const nextPassword = 'another correct horse battery staple';
    const converted = await reencryptWorkspaceFile(source, password, nextPassword);
    expect(converted.source).not.toBe(source);
    expect(converted.workspaceId).toBe(workspace.workspaceId);
    expect(converted.itemCount).toBe(1);
    await expect(unlock(converted.source, password)).rejects.toThrow('Wrong password');
    expect((await unlock(converted.source, nextPassword)).document.items[item.id]?.title).toBe('Still present');
    expect((await unlock(source, password)).document.items[item.id]?.title).toBe('Still present');
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

  it('merges a privacy-safe snapshot without deleting the local Google cache', async () => {
    const baseWorkspace = createWorkspace('Private merge');
    const external = googleCalendarEventToItem({
      id: 'private-event-id', summary: 'PRIVATE GOOGLE EVENT',
      start: { dateTime: '2026-08-31T10:00:00.000Z' }, end: { dateTime: '2026-08-31T11:00:00.000Z' },
    }, 'private-account@example.com', 'private-connection', '2026-08-31T09:00:00.000Z')!;
    baseWorkspace.items[external.id] = external;
    const base = createAutomergeDocument(baseWorkspace);
    const leftItem = createItem('From left');
    const rightItem = createItem('From right');
    const left = Automerge.change(Automerge.clone(base), (draft) => { draft.items[leftItem.id] = leftItem; });
    const right = Automerge.change(Automerge.clone(base), (draft) => { draft.items[rightItem.id] = rightItem; draft.updatedAt = '2026-08-31T12:00:00.000Z'; });
    const source = await exportContainer(right, password);
    const result = await merge(left, source, password);
    expect(Object.values(result.document.items).map((item) => item.title).sort()).toEqual(['From left', 'From right', 'PRIVATE GOOGLE EVENT']);
  });
});
