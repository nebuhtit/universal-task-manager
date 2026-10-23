import { afterEach, expect, it, vi } from 'vitest';
import { davRequest, defaultDavProxy } from './webdavTransport';
afterEach(() => vi.unstubAllGlobals());
it('only selects the automatic relay for the configured Keenetic host', () => {
  expect(defaultDavProxy('https://kaksam.keenetic.pro/webdav/')).toContain('.workers.dev/dav');
  expect(defaultDavProxy('https://kaksam.keenetic.pro.evil.example/webdav/')).toBe('');
  expect(defaultDavProxy('http://kaksam.keenetic.pro/webdav/')).toBe('');
});
it('routes browser DAV through the proxy without changing conditions or server destination', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 304, headers: { ETag: '"same"' } })); vi.stubGlobal('fetch', fetch);
  const response = await davRequest({ url: 'https://dav.example/webdav/', folder: 'UniversalSync', username: 'u', password: 'p', proxyUrl: 'https://relay.example/dav' }, 'GET', 'workspace-test.json', undefined, { ifNoneMatch: '"same"' });
  expect(response.status).toBe(304); expect(response.etag).toBe('"same"');
  const [url, options] = fetch.mock.calls[0]!;
  expect(url).toBe('https://relay.example/dav'); expect(options.headers['X-UTM-WebDAV-Target']).toBe('https://dav.example/webdav/UniversalSync/workspace-test.json'); expect(options.headers['If-None-Match']).toBe('"same"'); expect(options.headers.Authorization).toBe('Basic dTpw');
});
it('preserves direct access when no proxy is configured', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('ok')); vi.stubGlobal('fetch', fetch);
  await davRequest({ url: 'https://dav.example/webdav/', folder: '', username: 'u', password: 'p' }, 'GET');
  expect(fetch.mock.calls[0]![0]).toBe('https://dav.example/webdav/'); expect(fetch.mock.calls[0]![1].headers['X-UTM-WebDAV-Target']).toBeUndefined();
});
it('rejects plaintext proxy addresses before transmitting credentials', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(davRequest({ url: 'https://dav.example/', folder: '', username: 'u', password: 'p', proxyUrl: 'http://relay.example/dav' }, 'GET')).rejects.toThrow('webdav-invalid-proxy'); expect(fetch).not.toHaveBeenCalled();
});
