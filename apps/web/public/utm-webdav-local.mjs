// Standalone Node.js 22+ relay. No npm packages or internet needed at runtime.
import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const methods = ['GET', 'PUT', 'MKCOL', 'OPTIONS', 'DELETE', 'MOVE', 'LOCK', 'UNLOCK'];
const forwarded = ['authorization', 'content-type', 'if-match', 'if-none-match', 'destination', 'overwrite', 'if', 'lock-token', 'timeout', 'depth'];
const limit = 20 * 1024 * 1024;
async function bounded(stream) {
  const chunks = []; let size = 0;
  if (stream) for await (const chunk of stream) {
    size += chunk.length; if (size > limit) throw new Error('too-large'); chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
export function createLocalProxy(config) {
  const upstream = new URL(config.UPSTREAM_URL);
  const advertised = new URL(config.DAV_URL || config.UPSTREAM_URL);
  for (const base of [upstream, advertised]) {
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('Use a plain WebDAV base URL without credentials or parameters');
    base.pathname = base.pathname.replace(/\/?$/, '/');
  }
  const origins = (config.ALLOWED_ORIGINS || 'https://nebuhtit.github.io,http://127.0.0.1:4173').split(',').map(s => s.trim());
  const host = config.PROXY_HOST || '127.0.0.1';
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(host);
  if (!loopback && (!config.TLS_CERT || !config.TLS_KEY)) throw new Error('LAN access requires TLS_CERT and TLS_KEY with a trusted certificate');
  const mapTarget = value => {
    const target = new URL(value);
    if (target.origin !== advertised.origin || !target.pathname.startsWith(advertised.pathname) || target.username || target.password || target.search || target.hash) throw new Error('target-denied');
    const relative = target.pathname.slice(advertised.pathname.length);
    // Reject escaped separators and path traversal rather than normalizing them.
    if (/%2f|%5c|%2e/i.test(relative) || relative.includes('\\')) throw new Error('target-denied');
    const mapped = new URL(relative, upstream);
    if (mapped.origin !== upstream.origin || !mapped.pathname.startsWith(upstream.pathname)) throw new Error('target-denied');
    return mapped.href;
  };
  const handler = async (req, res) => {
    const origin = req.headers.origin;
    const expectedHosts = loopback ? ['127.0.0.1', 'localhost', '[::1]'] : [host];
    let hostname;
    try { hostname = new URL(`http://${req.headers.host}`).hostname; } catch { res.writeHead(403).end(); return; }
    if (!expectedHosts.includes(hostname) || !origins.includes(origin)) { res.writeHead(403).end(); return; }
    const headers = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Cache-Control': 'no-store, no-transform', 'Access-Control-Expose-Headers': 'ETag, X-UTM-WebDAV-ETag, Lock-Token, Timeout' };
    const reply = (status, message) => { res.writeHead(status, headers); res.end(message); };
    if (req.url !== '/dav') { reply(404, 'Not found'); return; }
    if (req.method === 'OPTIONS' && req.headers['access-control-request-method']) {
      if (!methods.includes(req.headers['access-control-request-method'])) { reply(405, 'Method denied'); return; }
      res.writeHead(204, { ...headers, 'Access-Control-Allow-Methods': methods.join(', '), 'Access-Control-Allow-Headers': [...forwarded, 'x-utm-webdav-target'].join(', '), 'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '600' }); res.end(); return;
    }
    if (!methods.includes(req.method)) { reply(405, 'Method denied'); return; }
    if (!/^Basic [A-Za-z0-9+/]+=*$/.test(req.headers.authorization || '')) { reply(401, 'WebDAV credentials required'); return; }
    let target; const requestHeaders = {};
    try {
      target = mapTarget(req.headers['x-utm-webdav-target']);
      for (const name of forwarded) if (typeof req.headers[name] === 'string') requestHeaders[name] = req.headers[name];
      requestHeaders['accept-encoding'] = 'identity';
      if (req.method === 'MOVE') requestHeaders.destination = mapTarget(req.headers.destination);
    } catch { reply(403, 'Target denied'); return; }
    const started = Date.now();
    try {
      const body = await bounded(req);
      const response = await fetch(target, { method: req.method, headers: requestHeaders, redirect: 'manual', signal: AbortSignal.timeout(30_000), ...(body.length && req.method !== 'GET' ? { body } : {}) });
      if (response.status >= 300 && response.status < 400 && response.status !== 304) { await response.body?.cancel(); reply(502, 'Redirect refused'); return; }
      const bytes = await bounded(response.body);
      for (const name of ['etag', 'lock-token', 'timeout', 'content-type']) if (response.headers.has(name)) headers[name] = response.headers.get(name);
      if (response.headers.has('etag')) headers['X-UTM-WebDAV-ETag'] = response.headers.get('etag');
      res.writeHead(response.status, headers); res.end([204, 205, 304].includes(response.status) ? undefined : bytes);
      if (config.DIAGNOSTICS === '1') console.info(JSON.stringify({ method: req.method, status: response.status, durationMs: Date.now() - started }));
    } catch (error) { reply(error.message === 'too-large' ? 413 : 502, error.message === 'too-large' ? 'Payload exceeds 20 MiB' : 'WebDAV connection failed'); }
  };
  return config.TLS_CERT && config.TLS_KEY
    ? https.createServer({ cert: readFileSync(config.TLS_CERT), key: readFileSync(config.TLS_KEY) }, handler)
    : http.createServer(handler);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.UPSTREAM_URL) { console.error('Set UPSTREAM_URL to your WebDAV folder. See utm-webdav-local.txt.'); process.exitCode = 1; }
  else {
    const host = process.env.PROXY_HOST || '127.0.0.1'; const port = Number(process.env.PROXY_PORT || 8788);
    const server = createLocalProxy(process.env);
    server.requestTimeout = 35_000;
    server.listen(port, host, () => console.info(`UTM local relay listening on ${process.env.TLS_CERT ? 'https' : 'http'}://${host}:${port}/dav`));
  }
}
