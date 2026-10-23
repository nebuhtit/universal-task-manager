import { afterEach, expect, it, vi } from 'vitest';
import { davRequest, defaultDavProxy, hasLocalDavEndpoint } from './webdavTransport';
afterEach(() => vi.unstubAllGlobals());
const connection = (id: string, proxyUrl = 'https://relay.example/dav') => ({ url: 'https://dav.example/webdav/', folder: id, username: 'u', password: 'p', proxyUrl });
it('allows LAN retries even when browser online detection reports no internet', () => {
  expect(hasLocalDavEndpoint(connection('lan', 'http://127.0.0.1:8788/dav'))).toBe(true);
  expect(hasLocalDavEndpoint(connection('lan', 'https://192.168.1.20:8788/dav'))).toBe(true);
  expect(hasLocalDavEndpoint(connection('remote'))).toBe(false);
  expect(hasLocalDavEndpoint(connection('fake', 'https://192.168.1.20.evil.example/dav'))).toBe(false);
});
it('only suggests the automatic relay for the configured host', () => {
  expect(defaultDavProxy('https://kaksam.keenetic.pro/webdav/')).toContain('.workers.dev/dav');
  expect(defaultDavProxy('https://kaksam.keenetic.pro.evil.example/webdav/')).toBe('');
});
it('tries direct first and falls back only after a failed read, preserving conditions', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError('CORS')).mockResolvedValue(new Response(null, { status: 304, headers: { ETag: '"same"' } })); vi.stubGlobal('fetch', fetch);
  const response = await davRequest(connection('fallback'), 'GET', 'workspace-test.json', undefined, { ifNoneMatch: '"same"' });
  expect(response.status).toBe(304); expect(response.etag).toBe('"same"'); expect(fetch.mock.calls[0]![0]).toContain('dav.example');
  const [url, options] = fetch.mock.calls[1]!;
  expect(url).toBe('https://relay.example/dav'); expect(options.headers['X-UTM-WebDAV-Target']).toBe('https://dav.example/webdav/fallback/workspace-test.json'); expect(options.headers['If-None-Match']).toBe('"same"');
});
it.each([200, 401, 403, 404, 500])('never falls back after a direct HTTP response %s', async status => {
  const fetch = vi.fn().mockResolvedValue(new Response('reply', { status })); vi.stubGlobal('fetch', fetch);
  await davRequest(connection('http-' + status), 'GET'); expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0]![1].headers['X-UTM-WebDAV-Target']).toBeUndefined();
});
it('does not relay when explicitly disabled', async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError('offline')); vi.stubGlobal('fetch', fetch);
  await expect(davRequest(connection('disabled', ''), 'GET')).rejects.toThrow('webdav-network-or-cors'); expect(fetch).toHaveBeenCalledTimes(1);
});
it('rejects a non-loopback plaintext proxy before sending it credentials', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError('offline')); vi.stubGlobal('fetch', fetch);
  await expect(davRequest(connection('bad', 'http://relay.example/dav'), 'GET')).rejects.toThrow('webdav-invalid-proxy'); expect(fetch).toHaveBeenCalledTimes(1);
});
it('supports a loopback HTTP relay', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError('CORS')).mockResolvedValueOnce(new Response('ok')); vi.stubGlobal('fetch', fetch);
  await davRequest(connection('loopback', 'http://127.0.0.1:8788/dav'), 'GET'); expect(fetch.mock.calls[1]![0]).toBe('http://127.0.0.1:8788/dav');
});
it('probes before a mutation and sends it only once when the direct response is lost', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 200 })).mockRejectedValueOnce(new TypeError('lost response')); vi.stubGlobal('fetch', fetch);
  await expect(davRequest(connection('write'), 'PUT', 'workspace.json', 'encrypted', { etag: '"old"' })).rejects.toThrow('webdav-network-or-cors');
  expect(fetch.mock.calls.map(call => call[1].method)).toEqual(['OPTIONS', 'PUT']);
  fetch.mockResolvedValueOnce(new Response('readback'));
  await davRequest(connection('write'), 'GET', 'workspace.json'); expect(fetch.mock.calls[2]![0]).toBe('https://relay.example/dav');
});
it('falls back after a failed safe probe before sending the first mutation', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError('CORS')).mockResolvedValueOnce(new Response(null, { status: 201 })); vi.stubGlobal('fetch', fetch);
  await davRequest(connection('probe'), 'PUT', 'workspace.json', 'encrypted', { etag: '"old"' });
  expect(fetch.mock.calls.map(call => call[1].method)).toEqual(['OPTIONS', 'PUT']); expect(fetch.mock.calls[1]![0]).toBe('https://relay.example/dav'); expect(fetch.mock.calls[1]![1].headers['If-Match']).toBe('"old"');
});
