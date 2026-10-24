import { afterEach, describe, expect, it, vi } from 'vitest';
import { createItem, createWorkspace, type WorkspaceDocument } from '@utm/core';
import { applySyncSnapshot, mergeSync, syncSnapshot } from './webdavMerge';
import { decodeDavState, encodeDavState, runDavSync, testDavConnection, safeDavLog, type DavPayload, type DavSettings } from './webdavSync';
import { davBase, davRequest } from './webdavTransport';
import { downloadDavWorkspace, davWorkspacePath } from './webdavSync';
import { DIAGNOSTICS_KEY, recordDiagnostic } from './diagnostics';
import { exportSafeDiagnostics } from './diagnosticsExport';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const settings = (): DavSettings => ({ url: 'https://test.invalid/dav/', folder: 'Sync', username: 'test', password: 'test', syncPassword: 'synthetic-sync-password', enabled: true, logs: false, deviceId: crypto.randomUUID() });
function fixture() {
  const workspace = createWorkspace('Synthetic sync fixture');
  const item = createItem('Original'); workspace.items[item.id] = item;
  return { workspace, id: item.id };
}
const payload = (workspace: WorkspaceDocument): DavPayload => ({ format: 'utm-webdav-sync', version: 1, workspaceId: workspace.workspaceId, schemaVersion: workspace.schemaVersion, snapshot: syncSnapshot(workspace) });

function server() {
  const files = new Map<string, { text: string; etag: string }>();
  const locks = new Map<string, string>();
  let counter = 0;
  const requests: { method: string; path: string; ifNoneMatch: string | null }[] = [];
  let race: (() => void | Promise<void>) | undefined;
  let failStatus = 0;
  let noEtag = false;
  let noWriteEtag = false;
  let rejectCreate = false, unsafeMove = false;
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    const method = init.method!, path = new URL(url).pathname;
    const headers = new Headers(init.headers);
    requests.push({ method, path, ifNoneMatch: headers.get('If-None-Match') });
    if (failStatus) return new Response('', { status: failStatus });
    if (method === 'MKCOL') return new Response('', { status: 201 });
    if (method === 'LOCK') {
      const oldToken = locks.get(path);
      if (!init.body) return new Response('', { status: oldToken && headers.get('If') === `(${oldToken})` ? 200 : 412 });
      if (oldToken) return new Response('', { status: 423 });
      const token = `<opaquelocktoken:${crypto.randomUUID()}>`;
      locks.set(path, token);
      const created = !files.has(path);
      if (created) files.set(path, { text: '', etag: `"${++counter}"` });
      return new Response('', { status: created ? 201 : 200, headers: { 'Lock-Token': token, Timeout: 'Second-300' } });
    }
    if (method === 'UNLOCK') {
      if (locks.get(path) !== headers.get('Lock-Token')) return new Response('', { status: 409 });
      locks.delete(path); return new Response(null, { status: 204 });
    }
    if (method !== 'GET' && locks.has(path) && headers.get('If') !== `(${locks.get(path)})`) return new Response('', { status: 423 });
    let old = files.get(path);
    if (method === 'GET') {
      if (old && !noEtag && headers.get('If-None-Match') === old.etag) return new Response(null, { status: 304, headers: { ETag: old.etag } });
      return new Response(old?.text ?? '', { status: old ? 200 : 404, headers: old && !noEtag ? { ETag: old.etag } : {} });
    }
    if (race && path.includes('workspace-')) { const callback = race; race = undefined; await callback(); old = files.get(path); }
    if (headers.has('If') && headers.get('If') !== `(${locks.get(path)})`) return new Response('', { status: 412 });
    if (method === 'MOVE') {
      const target = new URL(headers.get('Destination')!).pathname;
      if (!old) return new Response('', { status: 404 });
      if (files.has(target) && !unsafeMove) return new Response('', { status: 412 });
      files.set(target, old); files.delete(path); return new Response('', { status: 201 });
    }
    if (rejectCreate && method === 'PUT' && headers.get('If-None-Match') === '*') return new Response('', { status: 412 });
    if (headers.get('If-None-Match') === '*' && old) return new Response('', { status: 412 });
    if (headers.has('If-Match') && old?.etag !== headers.get('If-Match')) return new Response('', { status: 412 });
    if (method === 'DELETE') { files.delete(path); return new Response(null, { status: 204 }); }
    files.set(path, { text: String(init.body), etag: `"${++counter}"` });
    return new Response('', { status: 201, headers: noEtag || noWriteEtag ? {} : { ETag: `"${counter}"` } });
  });
  vi.stubGlobal('fetch', fetcher);
  return { files, requests, fetcher, expireLocks: () => locks.clear(), omitWriteEtag: () => { noWriteEtag = true; }, useMoveCreate: (unsafe = false) => { rejectCreate = true; unsafeMove = unsafe; }, race: (callback: () => void | Promise<void>) => { race = callback; }, fail: (status: number) => { failStatus = status; }, omitEtag: () => { noEtag = true; } };
}
function device(initial: WorkspaceDocument) {
  let document = clone(initial), config = settings();
  const flush = vi.fn(async () => {});
  const checkpoint = vi.fn(async (value: DavSettings) => { config = value; });
  const ports = { getWorkspace: () => document, flush, checkpoint, commit: (_: string, mutate: (draft: WorkspaceDocument) => void) => { document = clone(document); mutate(document); return true; } };
  return { get document() { return document; }, get config() { return config; }, ports, edit: (mutate: (draft: WorkspaceDocument) => void) => { document = clone(document); mutate(document); }, run: () => runDavSync(config, ports) };
}
afterEach(() => vi.unstubAllGlobals());

describe('WebDAV three-way merge', () => {
  it('merges independent fields without mutating either branch', () => {
    const base = { items: { a: { title: 'A', body: '' } }, tombstones: {} };
    const left = clone(base), right = clone(base); left.items.a.title = 'B'; right.items.a.body = 'Note';
    const merged = mergeSync(base, left, right);
    expect(merged.conflicts).toEqual([]); expect(merged.snapshot.items).toEqual({ a: { title: 'B', body: 'Note' } });
    expect(left.items.a.body).toBe(''); expect(right.items.a.title).toBe('A');
  });
  it('does not silently resolve same-field or view-order conflicts', () => {
    const base = { viewOrder: ['a', 'b'], items: { a: { title: 'A' } } };
    const left = { viewOrder: ['b', 'a'], items: { a: { title: 'Left' } } };
    const right = { viewOrder: ['c', 'a'], items: { a: { title: 'Right' } } };
    expect(mergeSync(base, left, right).conflicts).toHaveLength(2);
    expect(mergeSync(base, left, right, 'remote').snapshot).toEqual(right);
  });
  it('preserves deletion and offers explicit recovery of a concurrent edit', () => {
    const base = { items: { a: { title: 'A', updatedAt: '2026-01-01' } }, tombstones: {} };
    const left = { items: { a: { title: 'Edited', updatedAt: '2026-01-03' } }, tombstones: {} };
    const right = { items: {}, tombstones: { a: '2026-01-02' } };
    expect(mergeSync(base, left, right).conflicts.length).toBeGreaterThan(0);
    expect(mergeSync(base, left, right, 'remote').snapshot.items).toEqual({});
    const recovered = mergeSync(base, left, right, 'local').snapshot;
    expect(recovered.items).toEqual(left.items); expect(recovered.tombstones).toEqual({});
    expect(mergeSync(base, base, right).snapshot.items).toEqual({});
  });
  it('excludes Google outbox, credentials and device preferences, preserving local Google linkage', () => {
    const { workspace, id } = fixture();
    const item = workspace.items[id]!;
    item.extensions = { 'utm:googleSave': { secret: 'device-outbox' } };
    item.external = { provider: 'google_calendar', calendarId: 'private-calendar', eventId: 'owned-event', readOnly: false, connectionId: 'device', sourceUrl: 'https://calendar.google.com/', syncedAt: item.updatedAt };
    const snapshot = syncSnapshot(workspace);
    expect(JSON.stringify(snapshot)).not.toContain('private-calendar');
    expect(JSON.stringify(snapshot)).not.toContain('device-outbox');
    expect(snapshot).not.toHaveProperty('calendarPreferences'); expect(snapshot).not.toHaveProperty('pushPreferences');
    applySyncSnapshot(workspace, snapshot);
    expect(workspace.items[id]!.external?.calendarId).toBe('private-calendar');
    expect(workspace.items[id]!.extensions?.['utm:googleSave']).toEqual({ secret: 'device-outbox' });
  });
});

describe('encrypted WebDAV protocol', () => {
  it('reports the actual connection safety-check stages', async () => {
    server(); const stages: string[] = [];
    await testDavConnection(settings(), stage => stages.push(stage));
    expect(stages).toEqual(['folder', 'create', 'read', 'conditions', 'lock', 'locked-write']);
  });
  it('retains an interrupted owned lease and releases it before the next exchange', async () => {
    const remote = server(), a = device(fixture().workspace);
    const originalFetch = remote.fetcher.getMockImplementation()!;
    let loseUnlock = true;
    remote.fetcher.mockImplementation(async (url, init) => {
      if (loseUnlock && init.method === 'UNLOCK' && url.includes('workspace-')) throw new TypeError('network');
      return originalFetch(url, init);
    });
    const records = new Map<string, { path: string; token: string }>();
    const leaseJournal = { read: async (scope: string) => records.get(scope) ?? null, write: async (scope: string, lease: { path: string; token: string } | null) => { if (lease) records.set(scope, lease); else records.delete(scope); } };
    await runDavSync(a.config, { ...a.ports, leaseJournal });
    expect(records.size).toBe(1);
    loseUnlock = false;
    const start = remote.requests.length;
    await runDavSync(a.config, { ...a.ports, leaseJournal });
    expect(remote.requests[start]?.method).toBe('UNLOCK');
    expect(records.size).toBe(0);
  });
  it('does not write a workspace if its lease cannot be journaled safely', async () => {
    const remote = server(), a = device(fixture().workspace);
    await expect(runDavSync(a.config, { ...a.ports, leaseJournal: { read: async () => null, write: async (_scope, lease) => { if (lease) throw new Error('local-storage'); } } })).rejects.toThrow('local-storage');
    expect(remote.requests.filter(r => r.method === 'PUT' && r.path.includes('workspace-'))).toHaveLength(0);
    expect(remote.requests.some(r => r.method === 'UNLOCK' && r.path.includes('workspace-'))).toBe(true);
  });
  it('converges simultaneous first synchronization without dropping newly created tasks', async () => {
    server(); const { workspace } = fixture(); const a = device(workspace), b = device(workspace);
    const left = createItem('Left task'), right = createItem('Right task');
    a.edit(draft => { draft.items[left.id] = left; }); b.edit(draft => { draft.items[right.id] = right; });
    const outcomes = await Promise.allSettled([a.run(), b.run()]);
    expect(outcomes.some(result => result.status === 'fulfilled')).toBe(true);
    for (const result of outcomes) if (result.status === 'rejected') expect(String(result.reason)).toContain('webdav-server-busy');
    await a.run(); await b.run(); await a.run();
    expect(a.document.items[left.id]?.title).toBe('Left task');
    expect(a.document.items[right.id]?.title).toBe('Right task');
    expect(syncSnapshot(a.document)).toEqual(syncSnapshot(b.document));
  });
  it('blocks workspace writes if the server does not support exclusive locks', async () => {
    const remote = server(); const a = device(fixture().workspace);
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => init.method === 'LOCK' ? new Response('', { status: 405 }) : remote.fetcher(url, init)));
    await expect(a.run()).rejects.toThrow('webdav-lock-required');
    expect(remote.requests.some(request => request.method === 'PUT' && request.path.includes('workspace-'))).toBe(false);
  });
  it('recovers a committed write whose HTTP response was lost without discarding either device edit', async () => {
    const remote = server(); const { workspace, id } = fixture(); const a = device(workspace), b = device(workspace);
    await a.run(); await b.run();
    a.edit(draft => { draft.items[id]!.title = 'A'; });
    const baseline = a.config.baseline;
    let lost = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const response = await remote.fetcher(url, init);
      if (!lost && init.method === 'PUT' && new URL(url).pathname.includes('workspace-') && response.ok) { lost = true; throw new Error('Connection lost after commit'); }
      return response;
    }));
    await expect(a.run()).rejects.toThrow('webdav-network-or-cors');
    expect(a.config.baseline).toBe(baseline);
    expect(a.document.items[id]!.title).toBe('A');
    vi.stubGlobal('fetch', remote.fetcher);
    b.edit(draft => { draft.items[id]!.bodyMarkdown = 'B'; });
    await b.run(); await a.run();
    expect(a.document.items[id]).toMatchObject({ title: 'A', bodyMarkdown: 'B' });
    expect(syncSnapshot(a.document)).toEqual(syncSnapshot(b.document));
  });
  it('reacquires an expired lock and merges the intervening writer instead of using a stale token', async () => {
    const remote = server(); const { workspace, id } = fixture(); const a = device(workspace), b = device(workspace);
    await a.run(); await b.run();
    a.edit(draft => { draft.items[id]!.title = 'A'; });
    b.edit(draft => { draft.items[id]!.bodyMarkdown = 'B'; });
    remote.race(async () => { remote.expireLocks(); await b.run(); });
    await a.run(); await b.run();
    expect(a.document.items[id]).toMatchObject({ title: 'A', bodyMarkdown: 'B' });
    expect(syncSnapshot(a.document)).toEqual(syncSnapshot(b.document));
  });
  it('does not advance the checkpoint when write readback is damaged', async () => {
    const remote = server(); const { workspace, id } = fixture(); const a = device(workspace);
    await a.run(); const baseline = a.config.baseline;
    a.edit(draft => { draft.items[id]!.title = 'Keep locally'; });
    let written = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const response = await remote.fetcher(url, init);
      if (new URL(url).pathname.includes('workspace-')) {
        if (written && init.method === 'GET') return new Response('partial file', { status: 200, headers: { ETag: '"damaged"' } });
        if (init.method === 'PUT' && response.ok) written = true;
      }
      return response;
    }));
    await expect(a.run()).rejects.toThrow('webdav-password-or-damaged-file');
    expect(a.config.baseline).toBe(baseline);
    expect(a.document.items[id]!.title).toBe('Keep locally');
    vi.stubGlobal('fetch', remote.fetcher);
    await a.run();
    expect(a.document.items[id]!.title).toBe('Keep locally');
  });
  it('preserves both branches before applying incoming changes and blocks changes if recovery storage fails', async () => {
    const remote = server(); const { workspace, id } = fixture(); const a = device(workspace), b = device(workspace);
    await a.run(); await b.run();
    b.edit(draft => { draft.items[id]!.title = 'Incoming edit'; }); await b.run();
    const existing = new Set(remote.files.keys());
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => new URL(url).pathname.includes('/recovery/')
      ? new Response('', { status: 507 }) : remote.fetcher(url, init)));
    await expect(runDavSync({ ...a.config, logs: false }, a.ports)).rejects.toThrow('webdav-http-507');
    expect(a.document.items[id]!.title).toBe('Original');
    vi.stubGlobal('fetch', remote.fetcher);
    await runDavSync({ ...a.config, logs: false }, a.ports);
    expect(a.document.items[id]!.title).toBe('Incoming edit');
    const copies = [...remote.files.entries()].filter(([path]) => path.includes('/recovery/') && !existing.has(path));
    expect(copies).toHaveLength(2);
    const snapshots = await Promise.all(copies.map(([, file]) => decodeDavState(file.text, a.config.syncPassword, workspace)));
    expect(snapshots.map(s => (s.snapshot.items as WorkspaceDocument['items'])[id]!.title).sort()).toEqual(['Incoming edit', 'Original']);
    expect(copies.every(([, file]) => !file.text.includes('Incoming edit'))).toBe(true);
  });
  it('accepts a newer app version with the same protocol/schema and rejects an unknown schema before overwriting', async () => {
    const remote = server(); const { workspace } = fixture(); const a = device(workspace);
    const state = { ...payload(workspace), appVersion: '99.0.0' };
    expect((await decodeDavState(await encodeDavState(state, a.config.syncPassword), a.config.syncPassword, workspace)).appVersion).toBe('99.0.0');
    const path = `/dav/Sync/${await davWorkspacePath(workspace.workspaceId)}`;
    const text = await encodeDavState({ ...state, schemaVersion: '99.0.0' }, a.config.syncPassword);
    remote.files.set(path, { text, etag: '"future"' });
    await expect(a.run()).rejects.toThrow('webdav-schema-version');
    expect(remote.files.get(path)?.text).toBe(text);
    expect(remote.requests.some(r => r.method === 'PUT' && r.path === path)).toBe(false);
    expect(a.ports.checkpoint).not.toHaveBeenCalled();
  });
  it('uses 304 without downloading/decrypting the body, including after restart', async () => {
    const remote = server(); const { workspace } = fixture(); const first = device(workspace);
    await first.run();
    expect(first.config.remoteCache?.etag).toBeTruthy();
    const file = [...remote.files.entries()].find(([path]) => path.includes('workspace-'))!;
    // The body must not be read on a conditional 304 response.
    remote.files.set(file[0], { ...file[1], text: 'body not transferred' });
    const config = clone(first.config);
    const restarted = device(first.document);
    const before = remote.requests.length;
    await runDavSync(config, restarted.ports);
    const requests = remote.requests.slice(before).filter(request => request.method === 'GET' && request.path.includes('workspace-'));
    expect(requests).toHaveLength(1);
    expect(requests[0]?.ifNoneMatch).toBe(config.remoteCache!.etag);
    expect(restarted.document).toEqual(first.document);
  });
  it('still publishes local edits when the remote returns 304 and fetches other-device changes', async () => {
    server(); const { workspace, id } = fixture(); const first = device(workspace), second = device(workspace);
    await first.run(); await second.run();
    first.edit(draft => { draft.items[id]!.title = 'Local edit'; });
    await first.run();
    await second.run();
    expect(second.document.items[id]!.title).toBe('Local edit');
    second.edit(draft => { draft.items[id]!.bodyMarkdown = 'Remote edit'; });
    await second.run(); await first.run();
    expect(first.document.items[id]!.bodyMarkdown).toBe('Remote edit');
    expect(first.document.items[id]!.title).toBe('Local edit');
  });
  it('falls back to full GET without a valid cache and when credentials change', async () => {
    const remote = server(); const { workspace } = fixture(); const first = device(workspace);
    await first.run();
    let before = remote.requests.length;
    await runDavSync({ ...first.config, remoteCache: { ...first.config.remoteCache!, etag: 'W/"weak"' } }, first.ports);
    expect(remote.requests.slice(before).find(request => request.path.includes('workspace-'))?.ifNoneMatch).toBeNull();
    before = remote.requests.length;
    await runDavSync({ ...first.config, username: 'another-user' }, first.ports);
    expect(remote.requests.slice(before).find(request => request.method === 'GET' && request.path.includes('workspace-'))?.ifNoneMatch).toBeNull();
  });
  it('uses the verified readback ETag if PUT omits an ETag', async () => {
    const remote = server(); const { workspace } = fixture(); const first = device(workspace);
    remote.omitWriteEtag();
    await first.run();
    expect(first.config.remoteCache?.etag).toBeTruthy();
  });
  it('opens an existing workspace read-only with a checkpoint for a second device', async () => {
    const remote = server(); const { workspace, id } = fixture(); const config = settings();
    const path = `/dav/Sync/${await davWorkspacePath(workspace.workspaceId)}`;
    remote.files.set(path, { text: await encodeDavState(payload(workspace), config.syncPassword), etag: '"1"' });
    const restored = await downloadDavWorkspace(config, workspace.workspaceId);
    expect(restored.workspace.workspaceId).toBe(workspace.workspaceId);
    expect(restored.workspace.items[id]?.title).toBe('Original');
    expect(restored.settings.baseline).toEqual(syncSnapshot(workspace));
    expect(remote.requests.every(request => request.method === 'GET')).toBe(true);
    await expect(downloadDavWorkspace({ ...config, syncPassword: 'incorrect-password' }, workspace.workspaceId)).rejects.toThrow('password-or-damaged-file');
    await expect(downloadDavWorkspace(config, '../other')).rejects.toThrow('invalid-workspace-code');
  });
  it('authenticates encryption and validates workspace identity', async () => {
    const { workspace } = fixture(); const config = settings();
    const wire = await encodeDavState(payload(workspace), config.syncPassword);
    expect(wire).not.toContain('Original');
    expect((await decodeDavState(wire, config.syncPassword, workspace)).snapshot).toEqual(syncSnapshot(workspace));
    await expect(decodeDavState(wire, 'other-long-password', workspace)).rejects.toThrow('password-or-damaged');
    await expect(decodeDavState(wire, config.syncPassword, createWorkspace('Other'))).rejects.toThrow('wrong-workspace');
  });
  it('rejects authenticated payloads containing private device fields', async () => {
    const { workspace } = fixture(); const config = settings(); const state = payload(workspace);
    state.snapshot.calendarPreferences = {};
    await expect(decodeDavState(await encodeDavState(state, config.syncPassword), config.syncPassword, workspace)).rejects.toThrow('invalid-state');
  });
  it('supports two devices, offline independent edits, and a second converging sync', async () => {
    server(); const { workspace, id } = fixture(); const a = device(workspace), b = device(workspace);
    await a.run(); await b.run();
    a.edit(draft => { draft.items[id]!.title = 'Device A'; });
    b.edit(draft => { draft.items[id]!.bodyMarkdown = 'Device B note'; });
    await a.run(); await b.run(); await a.run();
    expect(syncSnapshot(a.document)).toEqual(syncSnapshot(b.document));
    expect(a.document.items[id]).toMatchObject({ title: 'Device A', bodyMarkdown: 'Device B note' });
  });
  it('backs up conflict branch and leaves remote unchanged until explicit resolution', async () => {
    const remote = server(); const { workspace, id } = fixture(); const a = device(workspace), b = device(workspace);
    await a.run(); await b.run();
    a.edit(draft => { draft.items[id]!.title = 'A'; }); b.edit(draft => { draft.items[id]!.title = 'B'; });
    await a.run(); const before = [...remote.files.values()][0]!.text;
    let etag = '';
    try { await b.run(); } catch (error) { etag = (error as { etag: string }).etag; }
    expect(etag).not.toBe(''); expect([...remote.files.keys()].some(key => key.includes('conflict-'))).toBe(true);
    expect([...remote.files.values()][0]!.text).toBe(before); expect(b.document.items[id]!.title).toBe('B');
    await runDavSync(b.config, b.ports, { resolution: 'local', etag }); await a.run();
    expect(a.document.items[id]!.title).toBe('B');
  });
  it('keeps edits typed during network upload for the next sync', async () => {
    const remote = server(); const { workspace, id } = fixture(); const a = device(workspace);
    remote.race(() => a.edit(draft => { draft.items[id]!.title = 'Typed while uploading'; }));
    await a.run(); expect(a.document.items[id]!.title).toBe('Typed while uploading');
    await a.run(); const record = [...remote.files.values()][0]!;
    const decoded = await decodeDavState(record.text, a.config.syncPassword, workspace);
    expect((decoded.snapshot.items as WorkspaceDocument['items'])[id]!.title).toBe('Typed while uploading');
  });
  it('retries a conditional-write race instead of overwriting the winning device', async () => {
    const remote = server(); const { workspace, id } = fixture(); const a = device(workspace), b = device(workspace);
    await a.run(); await b.run();
    a.edit(draft => { draft.items[id]!.title = 'A'; });
    b.edit(draft => { draft.items[id]!.bodyMarkdown = 'B'; });
    remote.race(async () => { await expect(b.run()).rejects.toThrow('webdav-server-busy'); });
    await a.run(); await b.run(); await a.run();
    expect(a.document.items[id]).toMatchObject({ title: 'A', bodyMarkdown: 'B' });
    expect(syncSnapshot(a.document)).toEqual(syncSnapshot(b.document));
  });
  it('retains the previous checkpoint if applying received data cannot be saved locally', async () => {
    server(); const { workspace, id } = fixture(); const a = device(workspace), b = device(workspace);
    await a.run(); await b.run(); const baseline = b.config.baseline;
    a.edit(draft => { draft.items[id]!.title = 'Remote'; }); await a.run();
    b.ports.flush.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('disk-failed'));
    await expect(b.run()).rejects.toThrow('disk-failed'); expect(b.config.baseline).toBe(baseline);
  });
  it('does not publish before local persistence succeeds', async () => {
    const remote = server(); const a = device(fixture().workspace); a.ports.flush.mockRejectedValue(new Error('disk-failed'));
    await expect(a.run()).rejects.toThrow('disk-failed'); expect(remote.requests).toEqual([]); expect(a.ports.checkpoint).not.toHaveBeenCalled();
  });
  it('never replaces an inaccessible or unversioned remote state', async () => {
    const remote = server(); const a = device(fixture().workspace); await a.run();
    remote.omitEtag(); await expect(a.run()).rejects.toThrow('etag-required');
    remote.fail(403); await expect(a.run()).rejects.toThrow('webdav-forbidden');
    expect(remote.requests.filter(request => request.method === 'PUT' && request.path.includes('workspace-'))).toHaveLength(1);
  });
  it('requires conditional-write support during connection check', async () => {
    server(); await expect(testDavConnection(settings())).resolves.toBeUndefined();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 412 })));
    await expect(testDavConnection(settings())).rejects.toThrow();
  });
  it('safely creates files on embedded DAV servers using MOVE without overwrite', async () => {
    const remote = server(); remote.useMoveCreate();
    const { workspace, id } = fixture(); const a = device(workspace), b = device(workspace);
    await a.run(); await b.run(); a.edit(draft => { draft.items[id]!.title = 'Native DAV'; });
    await a.run(); await b.run(); expect(b.document.items[id]!.title).toBe('Native DAV');
    expect(remote.requests.some(request => request.method === 'MOVE')).toBe(true);
    expect([...remote.files.keys()].filter(path => path.includes('probe-'))).toEqual([]);
  });
  it('rejects a server that ignores MOVE Overwrite:F before publishing user data', async () => {
    const remote = server(); remote.useMoveCreate(true);
    const a = device(fixture().workspace);
    await expect(a.run()).rejects.toThrow('conditional-writes-required');
    expect([...remote.files.keys()].some(path => path.includes('workspace-'))).toBe(false);
  });
  it('does not allow HTTP, embedded credentials, traversal or cross-origin paths', async () => {
    expect(() => davBase({ ...settings(), url: 'http://test.invalid/' })).toThrow();
    expect(() => davBase({ ...settings(), url: 'https://user:password@test.invalid/' })).toThrow();
    expect(() => davBase({ ...settings(), folder: '../other' })).toThrow();
    await expect(davRequest(settings(), 'GET', '//other.invalid/file')).rejects.toThrow('invalid-path');
    await expect(davRequest(settings(), 'GET', '../file')).rejects.toThrow('invalid-path');
  });
  it('never exports arbitrary failure messages to logs', () => {
    const text = JSON.stringify(safeDavLog('https://private.invalid/password', 14));
    expect(text).not.toContain('private.invalid'); expect(text).not.toContain('password'); expect(text).toContain('webdav-unexpected');
  });
  it('exports the same full safe journal manually and through WebDAV', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });
    localStorage.removeItem(DIAGNOSTICS_KEY);
    for (let index = 0; index < 205; index++) {
      recordDiagnostic({ kind: 'result', operation: 'WebDAV sync', outcome: 'succeeded', message: 'WebDAV sync succeeded', details: 'webdav-succeeded' });
    }
    recordDiagnostic({ kind: 'error', operation: 'WebDAV log upload', outcome: 'failed', message: 'WebDAV log upload failed', details: 'webdav-http-404' });
    recordDiagnostic({ kind: 'error', operation: 'WebDAV connection', message: 'WebDAV connection failed', details: 'https://private.invalid/secret' });
    const manual = exportSafeDiagnostics();
    const uploaded = safeDavLog('webdav-succeeded', 10) as { entries: unknown[] };
    expect(uploaded.entries).toEqual(manual);
    expect(manual.filter(entry => entry.operation === 'WebDAV sync')).toHaveLength(205);
    expect(manual.find(entry => entry.operation === 'WebDAV log upload')?.details).toBe('webdav-http-404');
    expect(JSON.stringify(uploaded)).not.toContain('private.invalid');
    localStorage.removeItem(DIAGNOSTICS_KEY);
  });
});
