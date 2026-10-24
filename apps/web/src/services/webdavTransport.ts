import { auditDav } from './webdavDiagnostics';
export interface DavConnection { url: string; folder: string; username: string; password: string; proxyUrl?: string }
export interface DavResult { status: number; text: string; etag: string | null; lockToken?: string | undefined; lockTimeout?: string | undefined }
type NativeReply = { id: string; status?: number; text?: string; etag?: string; originEtag?: string; proxyError?: string; lockToken?: string; lockTimeout?: string; error?: string; errorCode?: number; errorCategory?: string };
const relayFailure = (value: string | null | undefined) => value && ['target-denied', 'redirect', 'upstream-timeout', 'upstream-network', 'payload-too-large'].includes(value) ? `webdav-proxy-${value}` : undefined;
type DavMethod = 'GET' | 'PUT' | 'MKCOL' | 'OPTIONS' | 'DELETE' | 'MOVE' | 'LOCK' | 'UNLOCK' | 'PROPFIND';
interface DavCondition { etag?: string; create?: boolean; destination?: string; ifNoneMatch?: string; lockToken?: string }
const waiting = new Map<string, (reply: NativeReply) => void>();
let listening = false;
const browserRoutes = new Map<string, { proxy: boolean; until: number }>();
const rememberRoute = (key: string, proxy: boolean) => {
  if (browserRoutes.size > 64) browserRoutes.clear();
  browserRoutes.set(key, { proxy, until: Date.now() + 300_000 });
};
const native = () => typeof window !== 'undefined' ? window.webkit?.messageHandlers?.utmNativeWebDAV : undefined;
export const hasNativeWebDAV = () => Boolean(native());
export function hasLocalDavEndpoint(connection: DavConnection): boolean {
  return [connection.url, connection.proxyUrl].some(value => {
    if (!value) return false;
    try {
      const host = new URL(value).hostname.toLowerCase();
      if (['localhost', '[::1]'].includes(host) || host.endsWith('.local') || /^\[(?:f[cd][0-9a-f]{2}:|fe80:)/.test(host)) return true;
      const parts = host.split('.').map(Number);
      return parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255)
        && (parts[0] === 127 || parts[0] === 10 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31));
    } catch { return false; }
  });
}
export function defaultDavProxy(server: string): string {
  try { return ['https://kaksam.keenetic.pro', 'https://kaksam.netcraze.pro'].includes(new URL(server).origin) ? 'https://universal-task-manager-webdav.const-perfect.workers.dev/dav' : ''; }
  catch { return ''; }
}

export function davBase(connection: DavConnection): URL {
  const url = new URL(connection.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('webdav-https-required');
  url.pathname = url.pathname.replace(/\/?$/, '/');
  const parts = connection.folder.split('/').filter(Boolean);
  if (parts.some(part => part === '.' || part === '..' || /[\\\u0000-\u001f]/.test(part))) throw new Error('webdav-invalid-folder');
  for (const part of parts) url.pathname += `${encodeURIComponent(part)}/`;
  return url;
}

export async function davRequest(connection: DavConnection, method: DavMethod, path = '', body?: string, condition?: DavCondition): Promise<DavResult> {
  const requestId = crypto.randomUUID(), started = performance.now();
  const resource = path.startsWith('workspace-') ? 'workspace' : path.startsWith('recovery/') ? 'recovery' : path.startsWith('logs') ? 'log' : path.startsWith('conflict-') ? 'conflict' : 'probe-or-folder';
  auditDav('request-start', { requestId, method, resource, native: hasNativeWebDAV(), uploadBytes: body === undefined ? 0 : new TextEncoder().encode(body).length, conditional: Boolean(condition?.etag || condition?.create || condition?.ifNoneMatch) });
  try {
    const fingerprint = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 16);
    // Correlate old/new destinations across devices without exporting addresses.
    auditDav('request-endpoint', { requestId, endpointId: await fingerprint(davBase(connection).href), relayConfigured: Boolean((connection.proxyUrl ?? defaultDavProxy(connection.url)).trim()) });
    const result = await performDavRequest(connection, method, path, body, condition);
    auditDav('request-complete', { requestId, method, resource, durationMs: performance.now() - started, status: result.status, etag: result.etag, downloadBytes: new TextEncoder().encode(result.text).length });
    return result;
  } catch (error) {
    auditDav('request-failed', { requestId, method, resource, durationMs: performance.now() - started, code: error instanceof Error && /^webdav-[a-z0-9-]+$/.test(error.message) ? error.message : 'unexpected' });
    throw error;
  }
}
async function performDavRequest(connection: DavConnection, method: DavMethod, path = '', body?: string, condition?: DavCondition): Promise<DavResult> {
  const base = davBase(connection);
  if (body !== undefined && new TextEncoder().encode(body).byteLength > 20 * 1024 * 1024) throw new Error('webdav-too-large');
  if (method === 'DELETE' && !/^probe-[a-f0-9-]{36}\.json$/.test(path)) throw new Error('webdav-invalid-path');
  if (!/^[a-zA-Z0-9_./-]*$/.test(path) || path.split('/').some(part => part === '..' || part === '.')) throw new Error('webdav-invalid-path');
  const url = new URL(path, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new Error('webdav-invalid-path');
  const bytes = new TextEncoder().encode(`${connection.username}:${connection.password}`);
  if (connection.username.includes(':')) throw new Error('webdav-invalid-username');
  const authorization = `Basic ${btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))}`;
  const headers: Record<string, string> = { Authorization: authorization };
  if (body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';
  if (condition?.etag) headers['If-Match'] = condition.etag;
  if (condition?.create) headers['If-None-Match'] = '*';
  if (method === 'GET' && condition?.ifNoneMatch) headers['If-None-Match'] = condition.ifNoneMatch;
  if (condition?.lockToken) {
    if (!/^<[^<>\s]+>$/.test(condition.lockToken)) throw new Error('webdav-lock-required');
    if (method === 'UNLOCK') headers['Lock-Token'] = condition.lockToken;
    else headers.If = `(${condition.lockToken})`;
  }
  if (method === 'LOCK') {
    headers.Depth = '0'; headers.Timeout = 'Second-300';
    if (body) headers['Content-Type'] = 'application/xml; charset=utf-8';
  }
  if (method === 'MOVE') {
    const destination = condition?.destination;
    if (!destination || !/^[a-zA-Z0-9_./-]+$/.test(destination) || destination.split('/').some(part => part === '.' || part === '..')) throw new Error('webdav-invalid-path');
    const target = new URL(destination, base);
    if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) throw new Error('webdav-invalid-path');
    headers.Destination = target.href; headers.Overwrite = 'F';
  }
  const handler = native();
  const nativeRequest = (endpoint: string, requestMethod: DavMethod, requestHeaders: Record<string, string>, requestBody?: string, timeoutMs = 30_000): Promise<NativeReply> => {
    if (!handler) return Promise.reject(new Error('webdav-network'));
    // URLSession can request identity; browser fetch cannot set this header.
    requestHeaders['Accept-Encoding'] = 'identity';
    if (!listening) {
      window.addEventListener('utm-webdav-response', ((event: CustomEvent<NativeReply>) => waiting.get(event.detail.id)?.(event.detail)) as EventListener);
      listening = true;
    }
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiting.delete(id); handler.postMessage({ id, kind: 'cancel' }); reject(new Error('webdav-timeout')); }, timeoutMs + 5_000);
      waiting.set(id, reply => {
        clearTimeout(timer); waiting.delete(id);
        if (reply.error) {
          auditDav('native-network-failed', { method: requestMethod, errorCode: Number.isInteger(reply.errorCode) ? reply.errorCode : undefined, category: ['timeout', 'tls', 'dns', 'offline', 'cancelled', 'too-large', 'network'].includes(reply.errorCategory ?? '') ? reply.errorCategory : 'network' });
          reject(new Error(reply.errorCategory === 'timeout' ? 'webdav-timeout' : 'webdav-network'));
        } else resolve(reply);
      });
      try { handler.postMessage({ id, kind: 'request', url: endpoint, method: requestMethod, headers: requestHeaders, timeoutMs, ...(requestBody === undefined ? {} : { body: requestBody }) }); }
      catch { clearTimeout(timer); waiting.delete(id); reject(new Error('webdav-network')); }
    });
  };
  const proxyUrl = (connection.proxyUrl ?? defaultDavProxy(connection.url)).trim();
  const routeKey = JSON.stringify([Boolean(handler), base.href, connection.username, proxyUrl]);
  const remembered = browserRoutes.get(routeKey);
  let useProxy = Boolean(proxyUrl && remembered?.proxy && remembered.until > Date.now());
  const readOnly = method === 'GET' || method === 'OPTIONS' || method === 'PROPFIND';
  // Decide with a read-only probe before sending a first write. A lost write
  // response must never cause the same mutation to be replayed via a relay.
  if (proxyUrl && !readOnly && (!remembered || remembered.until <= Date.now())) {
    try {
      const probe = handler ? await nativeRequest(base.href, 'OPTIONS', { Authorization: authorization }, undefined, 8_000) : await fetch(base.href, { method: 'OPTIONS', headers: { Authorization: authorization }, credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      if (probe instanceof Response) await probe.body?.cancel(); rememberRoute(routeKey, false);
      auditDav('direct-probe-complete', { status: probe.status, native: Boolean(handler) });
    } catch { useProxy = true; rememberRoute(routeKey, true); auditDav('proxy-fallback', { reason: 'direct-probe-network-or-cors' }); }
  }
  const send = async (relay: boolean): Promise<DavResult> => {
    let endpoint = url.href;
    const requestHeaders = { ...headers };
    if (relay) {
      let proxy: URL;
      try { proxy = new URL(proxyUrl); } catch { throw new Error('webdav-invalid-proxy'); }
      const loopback = proxy.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(proxy.hostname);
      if (((handler || !loopback) && proxy.protocol !== 'https:') || proxy.username || proxy.password || proxy.search || proxy.hash) throw new Error('webdav-invalid-proxy');
      endpoint = proxy.href;
      requestHeaders['X-UTM-WebDAV-Target'] = url.href;
      if (handler) requestHeaders.Origin = 'https://nebuhtit.github.io';
      auditDav('proxy-request', { method, local: loopback, native: Boolean(handler) });
    }
    if (handler) {
      const reply = await nativeRequest(endpoint, method, requestHeaders, body);
      const failure = relay ? relayFailure(reply.proxyError) : undefined;
      if (failure) throw new Error(failure);
      return { status: reply.status ?? 0, text: reply.text ?? '', etag: (relay ? reply.originEtag : undefined) ?? reply.etag ?? null, lockToken: reply.lockToken, lockTimeout: reply.lockTimeout };
    }
    const response = await fetch(endpoint, { method, headers: requestHeaders, ...(body === undefined ? {} : { body }), redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(30_000) });
    const relayError = relay ? relayFailure(response.headers.get('X-UTM-WebDAV-Error')) : undefined;
    if (relayError) { await response.body?.cancel(); throw new Error(relayError); }
    const reader = response.body?.getReader(), decoder = new TextDecoder();
    let text = '', size = 0;
    if (reader) try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 20 * 1024 * 1024) { await reader.cancel(); throw new Error('webdav-too-large'); }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    // Accept the original validator only from the selected trusted relay.
    // Never strip W/ or synthesize a strong ETag from a weak one.
    const etag = (relay ? response.headers.get('x-utm-webdav-etag') : null) ?? response.headers.get('etag');
    return { status: response.status, text, etag, lockToken: response.headers.get('lock-token') ?? undefined, lockTimeout: response.headers.get('timeout') ?? undefined };
  };
  try {
    const result = await send(useProxy);
    if (proxyUrl) rememberRoute(routeKey, useProxy);
    return result;
  } catch (error) {
    if (error instanceof Error && (['webdav-too-large', 'webdav-invalid-proxy'].includes(error.message) || error.message.startsWith('webdav-proxy-'))) throw error;
    if (!useProxy && proxyUrl) {
      rememberRoute(routeKey, true);
      auditDav('proxy-fallback', { reason: 'direct-network-or-cors', replay: readOnly });
      if (readOnly) try { return await send(true); } catch (fallbackError) {
        if (fallbackError instanceof Error && (['webdav-too-large', 'webdav-invalid-proxy'].includes(fallbackError.message) || fallbackError.message.startsWith('webdav-proxy-'))) throw fallbackError;
      }
    }
    throw new Error(handler ? (error instanceof Error && error.message === 'webdav-timeout' ? 'webdav-timeout' : 'webdav-network') : 'webdav-network-or-cors');
  }
}

export async function acquireDavLock(connection: DavConnection, path: string) {
  const body = '<?xml version="1.0"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockinfo>';
  const reply = await davRequest(connection, 'LOCK', path, body);
  if ([423, 409, 500].includes(reply.status)) throw new Error('webdav-server-busy');
  if ([405, 501].includes(reply.status)) throw new Error('webdav-lock-required');
  davStatus(reply);
  if (!reply.lockToken || !/^<[^<>\s]+>$/.test(reply.lockToken)) throw new Error('webdav-lock-required');
  const token = reply.lockToken;
  const seconds = Number(/^Second-(\d+)$/i.exec(reply.lockTimeout ?? '')?.[1]);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 600) {
    await davRequest(connection, 'UNLOCK', path, undefined, { lockToken: token }).catch(() => undefined);
    throw new Error('webdav-lock-required');
  }
  auditDav('lock-acquired', { created: reply.status === 201, timeoutSeconds: seconds });
  return {
    token, created: reply.status === 201,
    refresh: async () => { davStatus(await davRequest(connection, 'LOCK', path, undefined, { lockToken: token })); auditDav('lock-refreshed'); },
    release: async () => { await releaseDavLock(connection, path, token); auditDav('lock-released'); },
  };
}

/** Releasing our exact token is idempotent: retry cannot unlock another writer. */
export async function releaseDavLock(connection: DavConnection, path: string, token: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const reply = await davRequest(connection, 'UNLOCK', path, undefined, { lockToken: token });
      if ([409, 412].includes(reply.status)) return; // Already released/expired; never force unlock.
      davStatus(reply); return;
    } catch (error) {
      if (attempt || !(error instanceof Error) || !/^webdav-(network(?:-or-cors)?|timeout)$/.test(error.message)) throw error;
      auditDav('lock-release-retry');
    }
  }
}

/** Some embedded DAV servers reject If-None-Match even for absent files.
 * MOVE with Overwrite:F is the standard atomic create alternative. Both
 * paths are verified on random probes before touching a shared workspace. */
export async function davCreate(connection: DavConnection, path: string, body: string): Promise<DavResult> {
  const direct = await davRequest(connection, 'PUT', path, body, { create: true });
  if (direct.status !== 412) return direct;
  const temporary = `probe-${crypto.randomUUID()}.json`;
  const staged = await davRequest(connection, 'PUT', temporary, body);
  davStatus(staged);
  try { return await davRequest(connection, 'MOVE', temporary, undefined, { destination: path }); }
  finally { await davRequest(connection, 'DELETE', temporary).catch(() => undefined); }
}

export function davStatus(result: DavResult): void {
  if (result.status === 401) throw new Error('webdav-access-denied');
  if (result.status === 403) throw new Error('webdav-forbidden');
  if (result.status < 200 || result.status >= 300) throw new Error(`webdav-http-${result.status}`);
}
export async function ensureDavFolder(connection: DavConnection): Promise<void> {
  // Never create arbitrary ancestors of the user's configured server URL.
  const parts = connection.folder.split('/').filter(Boolean);
  let folder = '';
  for (const part of parts) {
    folder += `${part}/`;
    const result = await davRequest({ ...connection, folder }, 'MKCOL');
    if (result.status !== 405) davStatus(result);
  }
}
