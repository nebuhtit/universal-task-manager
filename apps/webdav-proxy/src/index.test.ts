import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './index';
const env = { ALLOWED_ORIGINS: 'https://nebuhtit.github.io', UPSTREAM_BASES: 'https://dav.example/webdav/' };
function request(method: string, target = 'https://dav.example/webdav/UniversalSync/workspace.json', extra: Record<string, string> = {}) {
  return new Request('https://proxy.example/dav', { method, headers: { Origin: env.ALLOWED_ORIGINS, Authorization: 'Basic dTpw', 'X-UTM-WebDAV-Target': target, ...extra }, ...(method === 'PUT' ? { body: 'encrypted' } : {}) });
}
afterEach(() => vi.unstubAllGlobals());
describe('WebDAV HTTPS relay', () => {
  it('requests an uncompressed representation and preserves the origin validator for large files', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('x'.repeat(1_700_000), { headers: { ETag: '"origin"' } })); vi.stubGlobal('fetch', fetch);
    const response = await worker.fetch(request('GET'), env);
    expect(fetch.mock.calls[0]![1].headers.get('Accept-Encoding')).toBe('identity');
    expect(response.headers.get('X-UTM-WebDAV-ETag')).toBe('"origin"');
    expect(response.headers.get('Access-Control-Expose-Headers')).toContain('X-UTM-WebDAV-ETag');
    expect(response.headers.get('Cache-Control')).toContain('no-transform');
    expect((await response.text()).length).toBe(1_700_000);
  });
  it('answers browser preflight without forwarding authentication', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const response = await worker.fetch(request('OPTIONS', undefined, { 'Access-Control-Request-Method': 'LOCK' }), env);
    expect(response.status).toBe(204); expect(response.headers.get('Access-Control-Allow-Headers')).toContain('If-Match'); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['https://other.example/webdav/a', 'https://dav.example/other/a', 'http://dav.example/webdav/a', 'https://dav.example/webdav/../admin', 'https://dav.example/webdav/a?secret=1'])('rejects unconfigured targets %s', async target => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect((await worker.fetch(request('GET', target), env)).status).toBe(403); expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects unapproved browser origins', async () => {
    expect((await worker.fetch(request('GET', undefined, { Origin: 'https://evil.example' }), env)).status).toBe(403);
  });
  it('preserves conditional writes, body and lock headers', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 412, headers: { ETag: '"new"', 'Lock-Token': '<token>', Timeout: 'Second-300' } })); vi.stubGlobal('fetch', fetch);
    const response = await worker.fetch(request('PUT', undefined, { 'If-Match': '"old"', If: '(<token>)' }), env);
    expect(response.status).toBe(412); expect(response.headers.get('ETag')).toBe('"new"'); expect(response.headers.get('Lock-Token')).toBe('<token>');
    const options = fetch.mock.calls[0]![1]; expect(options.headers.get('If-Match')).toBe('"old"'); expect(options.headers.get('If')).toBe('(<token>)'); expect(new TextDecoder().decode(options.body)).toBe('encrypted'); expect(options.redirect).toBe('manual');
  });
  it('preserves empty 304 responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 304, headers: { ETag: '"same"' } })));
    const response = await worker.fetch(request('GET'), env); expect(response.status).toBe(304); expect(await response.text()).toBe('');
  });
  it('does not follow upstream redirects or permit MOVE outside approved paths', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: 'https://evil.example' } })); vi.stubGlobal('fetch', fetch);
    expect((await worker.fetch(request('GET'), env)).status).toBe(502);
    expect((await worker.fetch(request('MOVE', undefined, { Destination: 'https://dav.example/admin' }), env)).status).toBe(403); expect(fetch).toHaveBeenCalledTimes(1);
  });
});
