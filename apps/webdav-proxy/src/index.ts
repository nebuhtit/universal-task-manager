export interface Env { ALLOWED_ORIGINS: string; UPSTREAM_BASES: string }
const methods = ['GET', 'PUT', 'MKCOL', 'OPTIONS', 'DELETE', 'MOVE', 'LOCK', 'UNLOCK'];
const forwarded = ['Authorization', 'Content-Type', 'If-Match', 'If-None-Match', 'Destination', 'Overwrite', 'If', 'Lock-Token', 'Timeout', 'Depth'];
async function bounded(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array<ArrayBuffer>> {
  if (!body) return new Uint8Array();
  const reader = body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.length;
      if (size > 20 * 1024 * 1024) { await reader.cancel(); throw new Error('too-large'); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
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
    const origin = request.headers.get('Origin') ?? '';
    if (!origin || !env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).includes(origin)) return new Response('Origin denied', { status: 403 });
    const cors = { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Cache-Control': 'no-store', 'Access-Control-Expose-Headers': 'ETag, Lock-Token, Timeout' };
    const reply = (message: string, status: number) => new Response(message, { status, headers: cors });
    if (new URL(request.url).pathname !== '/dav') return reply('Not found', 404);
    if (request.method === 'OPTIONS' && request.headers.has('Access-Control-Request-Method')) {
      if (!methods.includes(request.headers.get('Access-Control-Request-Method')!)) return reply('Method denied', 405);
      return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': methods.join(', '), 'Access-Control-Allow-Headers': [...forwarded, 'X-UTM-WebDAV-Target'].join(', '), 'Access-Control-Max-Age': '600' } });
    }
    if (!methods.includes(request.method)) return reply('Method denied', 405);
    const bases = env.UPSTREAM_BASES.split(',').map(s => s.trim()).filter(Boolean);
    const target = allowedTarget(request.headers.get('X-UTM-WebDAV-Target') ?? '', bases);
    if (!target) return reply('Server is not allowed by this proxy', 403);
    if (!/^Basic [A-Za-z0-9+/]+=*$/.test(request.headers.get('Authorization') ?? '')) return reply('WebDAV authentication required', 401);
    const headers = new Headers();
    for (const name of forwarded) { const value = request.headers.get(name); if (value !== null) headers.set(name, value); }
    if (request.method === 'MOVE') {
      const destination = allowedTarget(headers.get('Destination') ?? '', bases);
      if (!destination || destination.origin !== target.origin) return reply('Destination denied', 403);
    }
    try {
      const bytes = await bounded(request.body);
      const upstream = await fetch(target.href, { method: request.method, headers, redirect: 'manual', signal: AbortSignal.timeout(30_000), ...(request.method === 'GET' || !bytes.length ? {} : { body: bytes }) });
      if (upstream.status >= 300 && upstream.status < 400 && upstream.status !== 304) { await upstream.body?.cancel(); return reply('Upstream redirect refused', 502); }
      const responseHeaders = new Headers(cors);
      for (const name of ['ETag', 'Lock-Token', 'Timeout', 'Content-Type']) { const value = upstream.headers.get(name); if (value !== null) responseHeaders.set(name, value); }
      const payload = await bounded(upstream.body);
      return new Response([204, 205, 304].includes(upstream.status) ? null : payload, { status: upstream.status, headers: responseHeaders });
    } catch (error) { return reply(error instanceof Error && error.message === 'too-large' ? 'Payload exceeds 20 MiB' : 'WebDAV upstream unavailable', error instanceof Error && error.message === 'too-large' ? 413 : 502); }
  },
};
