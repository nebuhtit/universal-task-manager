export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS: string;
  VAPID_SUBJECT: string;
  VAPID_PRIVATE_JWK: string;
  VAPID_PUBLIC_JWK: string;
  ACCESS_CODE: string;
}

type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } };
type Job = { id: string; at: string; title: string; body: string; url: string; urgency?: 'normal' | 'urgent' | 'critical' };
type StoredJob = { job_id: string; device_id: string; fire_at: number; payload_json: string; attempts: number };

const json = (value: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(value), { ...init, headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers ?? {}) } });
const base64Url = (bytes: ArrayBuffer | Uint8Array) => {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = ''; data.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};
const fromBase64Url = (value: string) => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded); return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};
const text = new TextEncoder();

function cors(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get('origin') || '';
  const allowed = env.ALLOWED_ORIGINS.split(',').map((value) => value.trim());
  return { 'access-control-allow-origin': allowed.includes(origin) ? origin : allowed[0] || '', 'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'Origin' };
}
function response(request: Request, env: Env, body: unknown, init: ResponseInit = {}) { return json(body, { ...init, headers: { ...cors(request, env), ...(init.headers ?? {}) } }); }
async function sha256(value: string) { return base64Url(await crypto.subtle.digest('SHA-256', text.encode(value))); }
async function requestJson<T>(request: Request): Promise<T> { return await request.json() as T; }
function validId(value: unknown) { return typeof value === 'string' && /^[a-zA-Z0-9:_-]{8,240}$/.test(value); }
function validSecret(value: unknown) { return typeof value === 'string' && value.length >= 32 && value.length <= 512; }
function validSubscription(value: unknown): value is Subscription {
  const item = value as Partial<Subscription> | null;
  return Boolean(item && typeof item.endpoint === 'string' && item.endpoint.startsWith('https://') && item.keys && typeof item.keys.p256dh === 'string' && typeof item.keys.auth === 'string');
}
async function authenticate(env: Env, deviceId: unknown, deviceSecret: unknown) {
  if (!validId(deviceId) || !validSecret(deviceSecret)) throw new Error('Invalid device credentials.');
  const row = await env.DB.prepare('SELECT secret_hash FROM devices WHERE device_id = ? AND enabled = 1').bind(deviceId).first<{ secret_hash: string }>();
  if (!row || row.secret_hash !== await sha256(deviceSecret)) throw new Error('Unknown device credentials.');
  return String(deviceId);
}

async function importP256(jwk: JsonWebKey, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, { name: usage.includes('deriveBits') ? 'ECDH' : 'ECDSA', namedCurve: 'P-256' }, false, usage);
}
async function hkdf(secret: ArrayBuffer, salt: ArrayBuffer, info: Uint8Array, length: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
}
async function vapidAuthorization(subscription: Subscription, env: Env): Promise<string> {
  const audience = new URL(subscription.endpoint).origin;
  const header = base64Url(text.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = base64Url(text.encode(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 43_200, sub: env.VAPID_SUBJECT })));
  const privateKey = await importP256(JSON.parse(env.VAPID_PRIVATE_JWK) as JsonWebKey, ['sign']);
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, text.encode(`${header}.${payload}`));
  const publicKey = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PUBLIC_JWK) as JsonWebKey, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  const rawPublicKey = await crypto.subtle.exportKey('raw', publicKey);
  return `vapid t=${header}.${payload}.${base64Url(signature)}, k=${base64Url(rawPublicKey)}`;
}
async function encryptPush(subscription: Subscription, payload: unknown): Promise<Uint8Array> {
  const clientKey = fromBase64Url(subscription.keys.p256dh); const auth = fromBase64Url(subscription.keys.auth);
  const clientPublic = await crypto.subtle.importKey('raw', clientKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const rawLocalPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: clientPublic }, local.privateKey, 256);
  const info = new Uint8Array(text.encode('WebPush: info\0').length + clientKey.length + rawLocalPublic.length);
  info.set(text.encode('WebPush: info\0')); info.set(clientKey, text.encode('WebPush: info\0').length); info.set(rawLocalPublic, text.encode('WebPush: info\0').length + clientKey.length);
  const ikm = await hkdf(shared, auth.buffer as ArrayBuffer, info, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(ikm, salt.buffer as ArrayBuffer, text.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(ikm, salt.buffer as ArrayBuffer, text.encode('Content-Encoding: nonce\0'), 12);
  const plaintext = new Uint8Array(text.encode(JSON.stringify(payload)).length + 1); plaintext.set(text.encode(JSON.stringify(payload))); plaintext[plaintext.length - 1] = 2;
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']), plaintext));
  const header = new Uint8Array(16 + 4 + 1 + rawLocalPublic.length); header.set(salt); new DataView(header.buffer).setUint32(16, 4096); header[20] = rawLocalPublic.length; header.set(rawLocalPublic, 21);
  const body = new Uint8Array(header.length + ciphertext.length); body.set(header); body.set(ciphertext, header.length); return body;
}
async function deliver(subscription: Subscription, job: Job, env: Env): Promise<Response> {
  const body = await encryptPush(subscription, { title: job.title, body: job.body, url: job.url, tag: job.id, urgency: job.urgency });
  return fetch(subscription.endpoint, { method: 'POST', headers: { Authorization: await vapidAuthorization(subscription, env), 'Content-Encoding': 'aes128gcm', TTL: '3600', Urgency: job.urgency === 'critical' ? 'high' : job.urgency === 'urgent' ? 'normal' : 'low' }, body });
}

async function sendDue(env: Env): Promise<void> {
  const now = Date.now();
  const rows = await env.DB.prepare("SELECT job_id, device_id, fire_at, payload_json, attempts FROM jobs WHERE state = 'scheduled' AND fire_at <= ? ORDER BY fire_at LIMIT 25").bind(now).all<StoredJob>();
  for (const job of rows.results) {
    const claim = await env.DB.prepare("UPDATE jobs SET state = 'sending', updated_at = ? WHERE job_id = ? AND state = 'scheduled'").bind(now, job.job_id).run();
    if (!claim.meta.changes) continue;
    const device = await env.DB.prepare('SELECT subscription_json FROM devices WHERE device_id = ? AND enabled = 1').bind(job.device_id).first<{ subscription_json: string }>();
    if (!device) { await env.DB.prepare("UPDATE jobs SET state = 'cancelled', updated_at = ? WHERE job_id = ?").bind(now, job.job_id).run(); continue; }
    try {
      const result = await deliver(JSON.parse(device.subscription_json) as Subscription, JSON.parse(job.payload_json) as Job, env);
      if (result.ok) await env.DB.prepare("UPDATE jobs SET state = 'sent', updated_at = ? WHERE job_id = ?").bind(now, job.job_id).run();
      else if (result.status === 404 || result.status === 410) {
        await env.DB.batch([env.DB.prepare('UPDATE devices SET enabled = 0, updated_at = ? WHERE device_id = ?').bind(now, job.device_id), env.DB.prepare("UPDATE jobs SET state = 'cancelled', updated_at = ? WHERE job_id = ?").bind(now, job.job_id)]);
      } else await env.DB.prepare("UPDATE jobs SET state = 'scheduled', attempts = attempts + 1, fire_at = ?, updated_at = ? WHERE job_id = ?").bind(now + 15 * 60_000, now, job.job_id).run();
    } catch {
      await env.DB.prepare("UPDATE jobs SET state = 'scheduled', attempts = attempts + 1, fire_at = ?, updated_at = ? WHERE job_id = ?").bind(now + 15 * 60_000, now, job.job_id).run();
    }
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(request, env) });
    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.pathname === '/v1/public-key') {
        const key = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PUBLIC_JWK) as JsonWebKey, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
        return response(request, env, { publicKey: base64Url(await crypto.subtle.exportKey('raw', key)) });
      }
      if (request.method === 'PUT' && url.pathname === '/v1/subscriptions') {
        const body = await requestJson<{ deviceId: string; deviceSecret: string; accessCode: string; subscription: Subscription }>(request);
        if (typeof body.accessCode !== 'string' || body.accessCode !== env.ACCESS_CODE) return response(request, env, { error: 'Invalid notification access code.' }, { status: 403 });
        if (!validId(body.deviceId) || !validSecret(body.deviceSecret) || !validSubscription(body.subscription)) return response(request, env, { error: 'Invalid subscription payload.' }, { status: 400 });
        const now = Date.now(); const existing = await env.DB.prepare('SELECT secret_hash FROM devices WHERE device_id = ?').bind(body.deviceId).first<{ secret_hash: string }>();
        const secretHash = await sha256(body.deviceSecret);
        if (existing && existing.secret_hash !== secretHash) return response(request, env, { error: 'Unknown device credentials.' }, { status: 403 });
        await env.DB.prepare('INSERT INTO devices (device_id, secret_hash, subscription_json, enabled, updated_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(device_id) DO UPDATE SET subscription_json = excluded.subscription_json, enabled = 1, updated_at = excluded.updated_at').bind(body.deviceId, secretHash, JSON.stringify(body.subscription), now).run();
        return response(request, env, { subscriptionUpdatedAt: new Date(now).toISOString() });
      }
      if (request.method === 'DELETE' && url.pathname === '/v1/subscriptions') {
        const body = await requestJson<{ deviceId: string; deviceSecret: string }>(request); const deviceId = await authenticate(env, body.deviceId, body.deviceSecret); const now = Date.now();
        await env.DB.batch([env.DB.prepare('UPDATE devices SET enabled = 0, updated_at = ? WHERE device_id = ?').bind(now, deviceId), env.DB.prepare("UPDATE jobs SET state = 'cancelled', updated_at = ? WHERE device_id = ? AND state = 'scheduled'").bind(now, deviceId)]);
        return response(request, env, { ok: true });
      }
      if (request.method === 'PUT' && url.pathname === '/v1/jobs') {
        const body = await requestJson<{ deviceId: string; deviceSecret: string; jobs: Job[] }>(request); const deviceId = await authenticate(env, body.deviceId, body.deviceSecret);
        if (!Array.isArray(body.jobs) || body.jobs.length > 500 || body.jobs.some((job) => !validId(job.id) || !Number.isFinite(new Date(job.at).getTime()) || typeof job.title !== 'string' || typeof job.body !== 'string' || typeof job.url !== 'string')) return response(request, env, { error: 'Invalid jobs payload.' }, { status: 400 });
        const now = Date.now(); const statements: D1PreparedStatement[] = [env.DB.prepare("DELETE FROM jobs WHERE device_id = ? AND state = 'scheduled'").bind(deviceId)];
        for (const job of body.jobs) statements.push(env.DB.prepare('INSERT INTO jobs (job_id, device_id, fire_at, payload_json, state, attempts, updated_at) VALUES (?, ?, ?, ?, \'scheduled\', 0, ?) ON CONFLICT(job_id) DO UPDATE SET fire_at = excluded.fire_at, payload_json = excluded.payload_json, state = \'scheduled\', updated_at = excluded.updated_at').bind(job.id, deviceId, new Date(job.at).getTime(), JSON.stringify(job), now));
        await env.DB.batch(statements);
        return response(request, env, { syncedAt: new Date(now).toISOString(), jobCount: body.jobs.length });
      }
      return response(request, env, { error: 'Not found.' }, { status: 404 });
    } catch (error) {
      return response(request, env, { error: error instanceof Error ? error.message : 'Request failed.' }, { status: 400 });
    }
  },
  async scheduled(_controller, env, ctx) { ctx.waitUntil(sendDue(env)); },
} satisfies ExportedHandler<Env>;
