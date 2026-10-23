// Synthetic, isolated server check. Never reads or writes a user workspace.
// Credentials are supplied only through UTM_WEBDAV_TEST_* environment variables.
import https from 'node:https';
import { networkInterfaces } from 'node:os';
import { randomUUID } from 'node:crypto';

const base = new URL(process.env.UTM_WEBDAV_TEST_URL);
if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('HTTPS base URL required');
if (!base.pathname.endsWith('/')) base.pathname += '/';
const user = process.env.UTM_WEBDAV_TEST_USER, password = process.env.UTM_WEBDAV_TEST_PASSWORD;
if (!user || !password || user.includes(':')) throw new Error('Test credentials required');
const probe = `probe-${randomUUID()}.json`, url = new URL(probe, base);
const iface = process.env.UTM_WEBDAV_INTERFACE;
const localAddress = iface ? networkInterfaces()[iface]?.find(address => address.family === 'IPv4')?.address : undefined;
if (iface && !localAddress) throw new Error('Selected network interface is unavailable');
function request(method, body, etag, extra = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method, auth: `${user}:${password}`, localAddress,
      ...(process.env.UTM_WEBDAV_TEST_IP ? { lookup: (_host, _options, callback) => callback(null, process.env.UTM_WEBDAV_TEST_IP, 4) } : {}),
      headers: { ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}), ...(etag ? { 'If-Match': etag } : {}), ...extra },
    }, response => {
      let text = '';
      response.setEncoding('utf8'); response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, etag: response.headers.etag, token: response.headers['lock-token'], timeout: response.headers.timeout, text }));
      response.on('error', reject);
    });
    req.setTimeout(20_000, () => req.destroy(new Error('Test request timed out')));
    req.on('error', reject); req.end(body);
  });
}
let owned = false;
try {
  if ((await request('GET')).status !== 404) throw new Error('Probe path is not absent; nothing written');
  const initial = process.env.UTM_WEBDAV_TEST_LOCK_NULL ? { status: 201 } : await request('PUT', '{"test":"initial"}');
  if (![200, 201, 204].includes(initial.status)) throw new Error(`Probe creation failed: ${initial.status}`);
  owned = true;
  if (process.env.UTM_WEBDAV_TEST_LOCK) {
    const body = '<?xml version="1.0"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockinfo>';
    const options = { Depth: '0', Timeout: 'Second-300', 'Content-Type': 'application/xml' };
    for (let lockRound = 0; lockRound < 3; lockRound++) {
    const claims = await Promise.all([request('LOCK', body, undefined, options), request('LOCK', body, undefined, options)]);
    const winner = claims.find(r => r.status >= 200 && r.status < 300);
    console.log(JSON.stringify({ lockRound, lockStatuses: claims.map(r => r.status), hasToken: Boolean(winner?.token), timeout: winner?.timeout }));
    if (!winner?.token) throw new Error('Exclusive LOCK unavailable');
    try {
      const refreshed = await request('LOCK', undefined, undefined, { If: `(${winner.token})`, Timeout: 'Second-300' });
      if (refreshed.status !== 200) throw new Error('Lock refresh failed');
      const blocked = await request('PUT', '{"test":"blocked"}');
      const written = await request('PUT', '{"test":"authorized"}', undefined, { If: `(${winner.token})` });
      console.log(JSON.stringify({ unownedWrite: blocked.status, ownedWrite: written.status }));
      if (claims.filter(r => r.status >= 200 && r.status < 300).length !== 1 || blocked.status !== 423 || ![200, 201, 204].includes(written.status)) throw new Error('LOCK protection failed');
    } finally {
      const unlocked = await request('UNLOCK', undefined, undefined, { 'Lock-Token': winner.token });
      console.log(JSON.stringify({ unlockStatus: unlocked.status }));
    }
    const stale = await request('PUT', '{"test":"stale-owner"}', undefined, { If: `(${winner.token})` });
    if (![412, 423].includes(stale.status)) throw new Error('Stale lock owner was allowed to write');
    }
    process.exitCode = 0;
  } else {
  for (let round = 0; round < 3; round++) {
    const before = await request('GET');
    if (!before.etag || before.etag.startsWith('W/')) throw new Error('Strong ETag required');
    const bodies = [JSON.stringify({ round, writer: 'A' }), JSON.stringify({ round, writer: 'B' })];
    const replies = await Promise.all(bodies.map(body => request('PUT', body, before.etag)));
    const after = await request('GET');
    const winners = replies.map((r, i) => ({ ...r, i })).filter(r => r.status >= 200 && r.status < 300);
    const passed = winners.length === 1 && replies.filter(r => r.status === 412).length === 1
      && after.status === 200 && after.etag && after.etag !== before.etag && after.text === bodies[winners[0].i];
    console.log(JSON.stringify({ round, statuses: replies.map(r => r.status), etagChanged: after.etag !== before.etag, passed }));
    if (!passed) throw new Error('Concurrent write protection failed');
  }
  }
} finally {
  if (owned) {
    const current = await request('GET');
    const removed = current.etag ? await request('DELETE', undefined, current.etag) : { status: 0 };
    console.log(JSON.stringify({ probe, cleanupStatus: removed.status }));
  }
}
