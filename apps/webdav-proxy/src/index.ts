export interface Env { ALLOWED_ORIGINS: string; UPSTREAM_BASES: string }
const relayVersion = '4.8.9';
const methods = ['GET', 'PUT', 'MKCOL', 'OPTIONS', 'DELETE', 'MOVE', 'LOCK', 'UNLOCK', 'PROPFIND'];
const forwarded = ['Authorization', 'Content-Type', 'If-Match', 'If-None-Match', 'Destination', 'Overwrite', 'If', 'Lock-Token', 'Timeout', 'Depth'];
async function bounded(body: ReadableStream<Uint8Array> | null, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  if (!body) return new Uint8Array();
  const reader = body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const chunk = await reader.read(); signal?.throwIfAborted(); if (chunk.done) break;
      size += chunk.value.length;
      if (size > 20 * 1024 * 1024) { await reader.cancel(); throw new Error('too-large'); }
      chunks.push(chunk.value);
    }
  } finally { signal?.removeEventListener('abort', cancel); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
function allowedTarget(value: string, bases: string[]): URL | null {
  try {
    const target = new URL(value);
    if (target.protocol !== 'https:' || target.username || target.password || target.search || target.hash) return null;
    return bases.some(value => {
      const base = new URL(value); const prefix = base.pathname.replace(/\/?$/, '/');
      return base.protocol === 'https:' && target.origin === base.origin && (target.pathname === prefix.slice(0, -1) || target.pathname.startsWith(prefix));
    }) ? target : null;
  } catch { return null; }
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const started = performance.now();
    const suppliedId = request.headers.get('X-UTM-WebDAV-Request-Id') ?? '';
    const requestId = /^[a-f0-9-]{36}$/.test(suppliedId) ? suppliedId : crypto.randomUUID();
    const method = methods.includes(request.method) ? request.method : 'unsupported';
    let stage = 'received';
    const report = (event: string, data: Record<string, string | number> = {}) => console.log(JSON.stringify({ component: 'webdav-relay', version: relayVersion, requestId, method, event, stage, durationMs: Math.round(performance.now() - started), ...data }));
    report('received');
    const origin = request.headers.get('Origin') ?? '';
    if (!origin || !env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).includes(origin)) { report('rejected', { status: 403, code: 'origin-denied' }); return new Response('Origin denied', { status: 403 }); }
    const cors = { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Cache-Control': 'no-store, no-transform', 'Access-Control-Expose-Headers': 'ETag, X-UTM-WebDAV-ETag, X-UTM-WebDAV-Error, X-UTM-Relay-Id, X-UTM-Relay-Version, X-UTM-Relay-Stage, X-UTM-Relay-Duration, Lock-Token, Timeout', 'X-UTM-Relay-Id': requestId, 'X-UTM-Relay-Version': relayVersion };
    const reply = (message: string, status: number, code?: string) => {
      report('complete', { status, ...(code ? { code } : {}) });
      return new Response(message, { status, headers: { ...cors, 'X-UTM-Relay-Stage': stage, 'X-UTM-Relay-Duration': String(Math.round(performance.now() - started)), ...(code ? { 'X-UTM-WebDAV-Error': code } : {}) } });
    };
    if (new URL(request.url).pathname === '/health' && request.method === 'GET') { stage = 'health'; return reply(JSON.stringify({ service: 'utm-webdav-relay', version: relayVersion, requestId }), 200); }
    if (new URL(request.url).pathname !== '/dav') return reply('Not found', 404);
    if (request.method === 'OPTIONS' && request.headers.has('Access-Control-Request-Method')) {
      if (!methods.includes(request.headers.get('Access-Control-Request-Method')!)) return reply('Method denied', 405);
      stage = 'preflight'; report('complete', { status: 204 });
      return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': methods.join(', '), 'Access-Control-Allow-Headers': [...forwarded, 'X-UTM-WebDAV-Target', 'X-UTM-WebDAV-Request-Id', 'Cache-Control', 'Pragma'].join(', '), 'Access-Control-Max-Age': '600' } });
    }
    if (!methods.includes(request.method)) return reply('Method denied', 405);
    const bases = env.UPSTREAM_BASES.split(',').map(s => s.trim()).filter(Boolean);
    const target = allowedTarget(request.headers.get('X-UTM-WebDAV-Target') ?? '', bases);
    if (!target) return reply('Server is not allowed by this proxy', 403, 'target-denied');
    if (!/^Basic [A-Za-z0-9+/]+=*$/.test(request.headers.get('Authorization') ?? '')) return reply('WebDAV authentication required', 401);
    const headers = new Headers();
    for (const name of forwarded) { const value = request.headers.get(name); if (value !== null) headers.set(name, value); }
    // Preserve the original validator even if downstream compression weakens ETag.
    headers.set('Accept-Encoding', 'identity');
    if (request.method === 'MOVE') {
      const destination = allowedTarget(headers.get('Destination') ?? '', bases);
      if (!destination || destination.origin !== target.origin) return reply('Destination denied', 403);
    }
    // Return a readable CORS response before the client's 30-second deadline.
    const upstreamDeadline = AbortSignal.timeout(20_000);
    try {
      stage = 'request-body'; report('stage');
      const bytes = await bounded(request.body, upstreamDeadline);
      stage = 'upstream-headers'; report('stage', { uploadBytes: bytes.length });
      const upstream = await fetch(target.href, { method: request.method, headers, redirect: 'manual', signal: upstreamDeadline, ...(request.method === 'GET' || !bytes.length ? {} : { body: bytes }) });
      stage = 'upstream-body'; report('stage', { status: upstream.status });
      if (upstream.status >= 300 && upstream.status < 400 && upstream.status !== 304) { await upstream.body?.cancel(); return reply('Upstream redirect refused', 502, 'redirect'); }
      const responseHeaders = new Headers(cors);
      const upstreamEtag = upstream.headers.get('ETag');
      if (upstreamEtag) responseHeaders.set('X-UTM-WebDAV-ETag', upstreamEtag);
      for (const name of ['ETag', 'Lock-Token', 'Timeout', 'Content-Type']) { const value = upstream.headers.get(name); if (value !== null) responseHeaders.set(name, value); }
      // A server can send headers but never finish its body. Enforce the same
      // deadline while consuming it, not only until response headers arrive.
      const payload = await bounded(upstream.body, upstreamDeadline);
      stage = 'complete';
      responseHeaders.set('X-UTM-Relay-Stage', stage);
      responseHeaders.set('X-UTM-Relay-Duration', String(Math.round(performance.now() - started)));
      report('complete', { status: upstream.status, uploadBytes: bytes.length, downloadBytes: payload.length });
      return new Response([204, 205, 304].includes(upstream.status) ? null : payload, { status: upstream.status, headers: responseHeaders });
    } catch (error) {
      if (error instanceof Error && error.message === 'too-large') return reply('Payload exceeds 20 MiB', 413, 'payload-too-large');
      const timedOut = upstreamDeadline.aborted || (error instanceof Error && error.name === 'TimeoutError');
      return timedOut ? reply('WebDAV server timed out', 504, 'upstream-timeout') : reply('WebDAV upstream unavailable', 502, 'upstream-network');
    }
  },
};
