import { expect, it, vi } from 'vitest';
import https from 'node:https';
import { networkInterfaces } from 'node:os';
import { createItem, createWorkspace, type WorkspaceDocument } from '@utm/core';
import { runDavSync, uploadDavLog, safeDavLog, type DavSettings } from './webdavSync';
import { davBase } from './webdavTransport';
import { syncSnapshot } from './webdavMerge';

// Explicit opt-in only. Credentials come from the environment, never fixtures.
const enabled = Boolean(process.env.UTM_WEBDAV_TEST_URL && process.env.UTM_WEBDAV_TEST_USER && process.env.UTM_WEBDAV_TEST_PASSWORD);
it.skipIf(!enabled)('round-trips two synthetic devices and safe logs on an isolated real DAV directory', async () => {
  const config: DavSettings = { url: process.env.UTM_WEBDAV_TEST_URL!, username: process.env.UTM_WEBDAV_TEST_USER!, password: process.env.UTM_WEBDAV_TEST_PASSWORD!, folder: `utm-fixture-${crypto.randomUUID()}`, deviceId: crypto.randomUUID(), syncPassword: crypto.randomUUID(), enabled: true, logs: true };
  const workspace = createWorkspace('Synthetic WebDAV integration test');
  const item = createItem('Synthetic task'); workspace.items[item.id] = item;
  const base = davBase(config);
  const originalFetch = globalThis.fetch;
  const createdPaths = new Set<string>();
  const testFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new Error('Synthetic test escaped its folder');
    const response = process.env.UTM_WEBDAV_TEST_IP ? await new Promise<Response>((resolve, reject) => {
      const iface = process.env.UTM_WEBDAV_INTERFACE;
      const localAddress = iface ? networkInterfaces()[iface]?.find(a => a.family === 'IPv4')?.address : undefined;
      const req = https.request(url, { method: init?.method, headers: Object.fromEntries(new Headers(init?.headers).entries()), ...(localAddress ? { localAddress } : {}), lookup: (_host, _options, callback) => callback(null, process.env.UTM_WEBDAV_TEST_IP!, 4) }, reply => {
        const chunks: Buffer[] = []; reply.on('data', chunk => chunks.push(Buffer.from(chunk)));
        reply.on('end', () => resolve(new Response([204, 304].includes(reply.statusCode!) ? null : Buffer.concat(chunks), { status: reply.statusCode!, headers: Object.fromEntries(Object.entries(reply.headers).filter(([, v]) => typeof v === 'string') as [string, string][]) })));
        reply.on('error', reject);
      });
      req.on('error', reject); req.setTimeout(20_000, () => req.destroy(new Error('Synthetic test timeout'))); req.end(init?.body);
    }) : await originalFetch(input, init);
    if (response.ok && ['PUT', 'MKCOL', 'LOCK'].includes(init?.method ?? '')) createdPaths.add(url.pathname.slice(base.pathname.length));
    if (response.ok && init?.method === 'MOVE') {
      const destination = new URL(new Headers(init.headers).get('Destination')!);
      if (!destination.pathname.startsWith(base.pathname)) throw new Error('Invalid synthetic destination');
      createdPaths.add(destination.pathname.slice(base.pathname.length));
    }
    return response;
  };
  vi.stubGlobal('fetch', testFetch);
  const auth = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;
  const raw = (method: string, path: string) => fetch(new URL(path, base), { method, headers: { Authorization: auth }, redirect: 'error', signal: AbortSignal.timeout(15_000) });
  // A successful fresh MKCOL proves ownership of the exact cleanup scope.
  const created = await raw('MKCOL', ''); expect(created.status).toBe(201);
  const key = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(workspace.workspaceId))).toString('hex');
  const statePath = `workspace-${key}.json`;
  function device() {
    let document = structuredClone(workspace);
    let settings: DavSettings = { ...config, deviceId: crypto.randomUUID() };
    return {
      edit: (change: (draft: WorkspaceDocument) => void) => { document = structuredClone(document); change(document); },
      get document() { return document; },
      run: () => runDavSync(settings, { getWorkspace: () => document, flush: async () => {}, commit: (_message, change) => { document = structuredClone(document); change(document); return true; }, checkpoint: async next => { settings = next; } }),
    };
  }
  try {
    const a = device(), b = device(); await a.run(); await b.run();
    a.edit(draft => { draft.items[item.id]!.title = 'Synthetic device A edit'; });
    b.edit(draft => { draft.items[item.id]!.bodyMarkdown = 'Synthetic device B edit'; });
    const outcomes = await Promise.allSettled([a.run(), b.run()]);
    expect(outcomes.some(r => r.status === 'fulfilled')).toBe(true);
    for (const outcome of outcomes) if (outcome.status === 'rejected') expect(String(outcome.reason)).toContain('webdav-server-busy');
    await a.run(); await b.run(); await a.run();
    expect(syncSnapshot(a.document)).toEqual(syncSnapshot(b.document));
    const read = await raw('GET', statePath); expect(read.status).toBe(200);
    const encrypted = await read.text(); expect(encrypted).not.toContain('Synthetic device');
    await uploadDavLog(config, safeDavLog('webdav-succeeded', 0));
    const log = await raw('GET', `logs/device-${config.deviceId}.json`); expect(log.status).toBe(200);
    const text = await log.text(); expect(text).not.toContain(config.password); expect(text).not.toContain(config.url); expect(text).not.toContain('Synthetic task');
  } finally {
    // Only these generated paths are ours. Never enumerate/delete user files.
    try {
      for (const path of [...createdPaths].filter(Boolean).sort((a, b) => b.split('/').length - a.split('/').length || Number(a.endsWith('/')) - Number(b.endsWith('/')))) await raw('DELETE', path);
      const removed = await raw('DELETE', ''); expect(removed.status).toBe(204);
    } finally { vi.unstubAllGlobals(); }
  }
}, 90_000);
