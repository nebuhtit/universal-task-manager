export interface DavConnection { url: string; folder: string; username: string; password: string }
export interface DavResult { status: number; text: string; etag: string | null }
type NativeReply = { id: string; status?: number; text?: string; etag?: string; error?: string };
const waiting = new Map<string, (reply: NativeReply) => void>();
let listening = false;
const native = () => typeof window !== 'undefined' ? window.webkit?.messageHandlers?.utmNativeWebDAV : undefined;
export const hasNativeWebDAV = () => Boolean(native());

export function davBase(connection: DavConnection): URL {
  const url = new URL(connection.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('webdav-https-required');
  url.pathname = url.pathname.replace(/\/?$/, '/');
  const parts = connection.folder.split('/').filter(Boolean);
  if (parts.some(part => part === '.' || part === '..' || /[\\\u0000-\u001f]/.test(part))) throw new Error('webdav-invalid-folder');
  for (const part of parts) url.pathname += `${encodeURIComponent(part)}/`;
  return url;
}

export async function davRequest(connection: DavConnection, method: 'GET' | 'PUT' | 'MKCOL' | 'OPTIONS' | 'DELETE' | 'MOVE', path = '', body?: string, condition?: { etag?: string; create?: boolean; destination?: string; ifNoneMatch?: string }): Promise<DavResult> {
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
  if (method === 'MOVE') {
    const destination = condition?.destination;
    if (!destination || !/^[a-zA-Z0-9_./-]+$/.test(destination) || destination.split('/').some(part => part === '.' || part === '..')) throw new Error('webdav-invalid-path');
    const target = new URL(destination, base);
    if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) throw new Error('webdav-invalid-path');
    headers.Destination = target.href; headers.Overwrite = 'F';
  }
  const handler = native();
  if (handler) {
    if (!listening) {
      window.addEventListener('utm-webdav-response', ((event: CustomEvent<NativeReply>) => waiting.get(event.detail.id)?.(event.detail)) as EventListener);
      listening = true;
    }
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiting.delete(id); handler.postMessage({ id, kind: 'cancel' }); reject(new Error('webdav-timeout')); }, 35_000);
      waiting.set(id, reply => { clearTimeout(timer); waiting.delete(id); reply.error ? reject(new Error('webdav-network')) : resolve({ status: reply.status ?? 0, text: reply.text ?? '', etag: reply.etag ?? null }); });
      try { handler.postMessage({ id, kind: 'request', url: url.href, method, headers, ...(body === undefined ? {} : { body }) }); }
      catch { clearTimeout(timer); waiting.delete(id); reject(new Error('webdav-network')); }
    });
  }
  try {
    const response = await fetch(url.href, { method, headers, ...(body === undefined ? {} : { body }), redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(30_000) });
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
    return { status: response.status, text, etag: response.headers.get('etag') };
  } catch (error) {
    if (error instanceof Error && error.message === 'webdav-too-large') throw error;
    throw new Error('webdav-network-or-cors');
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
  if (result.status === 401 || result.status === 403) throw new Error('webdav-access-denied');
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
