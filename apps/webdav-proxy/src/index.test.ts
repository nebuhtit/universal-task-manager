import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './index';
const env = { ALLOWED_ORIGINS: 'https://nebuhtit.github.io', UPSTREAM_BASES: 'https://dav.example/webdav/' };
function request(method: string, target = 'https://dav.example/webdav/UniversalSync/workspace.json', extra: Record<string, string> = {}) {
  return new Request('https://proxy.example/dav', { method, headers: { Origin: env.ALLOWED_ORIGINS, Authorization: 'Basic dTpw', 'X-UTM-WebDAV-Target': target, ...extra }, ...(method === 'PUT' ? { body: 'encrypted' } : {}) });
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('WebDAV HTTPS relay', () => {
  it('reports correlated stages without logging credentials, target URLs or payloads', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const id = 'f94db814-d00e-4000-8000-c2c2ff9f0300';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private workspace payload', { headers: { ETag: '"safe"' } })));
    const response = await worker.fetch(request('PUT', undefined, { 'X-UTM-WebDAV-Request-Id': id }), env);
    expect(response.headers.get('X-UTM-Relay-Id')).toBe(id);
    expect(response.headers.get('X-UTM-Relay-Stage')).toBe('complete');
    const reports = log.mock.calls.map(call => JSON.parse(call[0]));
    expect(reports.map(report => report.stage)).toEqual(['received', 'request-body', 'upstream-headers', 'upstream-body', 'complete']);
    expect(reports.every(report => report.requestId === id)).toBe(true);
    expect(JSON.stringify(reports)).not.toMatch(/dTpw|dav\.example|private workspace payload|encrypted/);
  });
  it('exposes a restricted health check that does not contact WebDAV', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const response = await worker.fetch(new Request('https://proxy.example/health', { headers: { Origin: env.ALLOWED_ORIGINS } }), env);
    expect(response.status).toBe(200); expect((await response.json()).service).toBe('utm-webdav-relay');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('bounds an upstream body that stalls after response headers and cancels its reader', async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); }, cancel }))));
    const reply = worker.fetch(request('GET'), env);
    await new Promise(resolve => setTimeout(resolve, 0));
    deadline.abort(new DOMException('deadline', 'TimeoutError'));
    const response = await reply;
    expect(response.status).toBe(504); expect(response.headers.get('X-UTM-WebDAV-Error')).toBe('upstream-timeout');
    expect(cancel).toHaveBeenCalledOnce();
  });
  it.each([['TimeoutError', 504, 'upstream-timeout'], ['TypeError', 502, 'upstream-network']] as const)('reports %s as a readable relay failure', async (name, status, code) => {
    const error = new Error('private upstream error'); error.name = name;
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));
    const response = await worker.fetch(request('GET'), env);
    expect(response.status).toBe(status);
    expect(response.headers.get('X-UTM-WebDAV-Error')).toBe(code);
    expect(response.headers.get('Access-Control-Expose-Headers')).toContain('X-UTM-WebDAV-Error');
    expect(await response.text()).not.toContain('private upstream error');
  });
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
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Pragma');
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
