import { afterEach, expect, it, vi } from 'vitest';

type Request = { id: string; kind: string; url: string; method: string; headers: Record<string, string>; body?: string; timeoutMs: number };
const connection = { url: 'https://native-dav.example/webdav/', folder: 'UniversalSync', username: 'u', password: 'secret', proxyUrl: 'https://relay.example/dav' };
async function bridge(reply: (request: Request) => object) {
  vi.resetModules();
  const target = new EventTarget();
  const requests: Request[] = [];
  const postMessage = (request: Request) => {
    if (request.kind === 'cancel') return;
    requests.push(request);
    queueMicrotask(() => target.dispatchEvent(new CustomEvent('utm-webdav-response', { detail: { id: request.id, ...reply(request) } })));
  };
  Object.assign(target, { webkit: { messageHandlers: { utmNativeWebDAV: { postMessage } } } });
  vi.stubGlobal('window', target); vi.stubGlobal('fetch', vi.fn());
  return { requests, ...(await import('./webdavTransport')) };
}
afterEach(() => vi.unstubAllGlobals());

it('uses a configured HTTPS relay after a failed native read and keeps the original ETag', async () => {
  const api = await bridge(request => request.url.startsWith('https://relay.example')
    ? { status: 200, text: 'encrypted', etag: 'W/"v1"', originEtag: '"v1"' }
    : { error: 'network', errorCategory: 'timeout', errorCode: -1001 });
  expect((await api.davRequest(connection, 'GET', 'workspace-test.json')).etag).toBe('"v1"');
  expect(api.requests).toHaveLength(2);
  expect(api.requests[1]!.headers.Origin).toBe('https://nebuhtit.github.io');
  expect(api.requests[1]!.headers['X-UTM-WebDAV-Target']).toContain('/UniversalSync/workspace-test.json');
  expect(fetch).not.toHaveBeenCalled();
});

it('chooses the relay with a safe native probe before sending a mutation', async () => {
  const api = await bridge(request => request.method === 'OPTIONS' ? { error: 'network', errorCategory: 'timeout' } : { status: 201, text: '' });
  await api.davRequest(connection, 'PUT', 'workspace-test.json', 'encrypted', { etag: '"v1"' });
  expect(api.requests.map(r => r.method)).toEqual(['OPTIONS', 'PUT']);
  expect(api.requests[0]!.timeoutMs).toBe(8000);
  expect(api.requests[1]!.url).toBe(connection.proxyUrl);
  expect(api.requests[1]!.headers['If-Match']).toBe('"v1"');
});

it('never replays a native write whose response was lost; the following read can use the relay', async () => {
  const api = await bridge(request => request.method === 'OPTIONS' ? { status: 200 } : request.method === 'PUT' ? { error: 'network' } : { status: 200, text: 'readback' });
  await expect(api.davRequest(connection, 'PUT', 'workspace-test.json', 'encrypted')).rejects.toThrow('webdav-network');
  expect(api.requests.map(r => r.method)).toEqual(['OPTIONS', 'PUT']);
  await api.davRequest(connection, 'GET', 'workspace-test.json');
  expect(api.requests[2]!.url).toBe(connection.proxyUrl);
});

it('can retry UNLOCK with the exact owned token but cannot unlock another owner', async () => {
  const api = await bridge(request => request.method === 'OPTIONS' ? { status: 200 } : request.url === connection.proxyUrl ? { status: 409 } : { error: 'network' });
  await api.releaseDavLock(connection, 'workspace-test.json', '<owned-token>');
  const releases = api.requests.filter(r => r.method === 'UNLOCK');
  expect(releases).toHaveLength(2);
  expect(releases.every(r => r.headers['Lock-Token'] === '<owned-token>')).toBe(true);
});

it('honors disabled relay and does not send native credentials over HTTP', async () => {
  const api = await bridge(() => ({ error: 'network' }));
  await expect(api.davRequest({ ...connection, proxyUrl: '' }, 'GET')).rejects.toThrow('webdav-network');
  expect(api.requests).toHaveLength(1);
  await expect(api.davRequest({ ...connection, proxyUrl: 'http://127.0.0.1:8788/dav' }, 'GET')).rejects.toThrow('webdav-invalid-proxy');
  expect(api.requests.every(r => r.url.startsWith('https:'))).toBe(true);
});
