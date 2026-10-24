import { afterEach, expect, it } from 'vitest';
import http from 'node:http';
import { createLocalProxy } from '../../web/public/utm-webdav-local.mjs';
const servers = [];
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });
const listen = async server => { servers.push(server); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${server.address().port}`; };
it('maps the public identifier to a LAN server with no WAN access, including MOVE and preflight', async () => {
  const seen = [];
  const upstream = await listen(http.createServer((req, res) => { seen.push({ method: req.method, path: req.url, destination: req.headers.destination, etag: req.headers['if-match'] }); res.writeHead(201, { ETag: '"v2"', 'Lock-Token': '<lock>' }); res.end(); }));
  const relay = await listen(createLocalProxy({ UPSTREAM_URL: `${upstream}/webdav/`, DAV_URL: 'https://never-resolve.invalid/webdav/' }));
  const headers = { Origin: 'https://nebuhtit.github.io', Authorization: 'Basic dTpw', 'X-UTM-WebDAV-Target': 'https://never-resolve.invalid/webdav/UniversalSync/a.json' };
  expect((await fetch(`${relay}/dav`, { method: 'OPTIONS', headers: { Origin: headers.Origin, 'Access-Control-Request-Method': 'MOVE' } })).status).toBe(204); expect(seen).toHaveLength(0);
  const response = await fetch(`${relay}/dav`, { method: 'MOVE', headers: { ...headers, Destination: 'https://never-resolve.invalid/webdav/UniversalSync/b.json', 'If-Match': '"v1"' } });
  expect(response.headers.get('x-utm-webdav-etag')).toBe('"v2"');
  expect(response.headers.get('access-control-expose-headers')).toContain('X-UTM-WebDAV-ETag');
  expect(response.status).toBe(201); expect(response.headers.get('etag')).toBe('"v2"'); expect(response.headers.get('lock-token')).toBe('<lock>'); expect(seen[0]).toEqual({ method: 'MOVE', path: '/webdav/UniversalSync/a.json', destination: `${upstream}/webdav/UniversalSync/b.json`, etag: '"v1"' });
  expect((await fetch(`${relay}/dav`, { headers: { ...headers, 'X-UTM-WebDAV-Target': 'https://never-resolve.invalid/admin' } })).status).toBe(403);
  expect((await fetch(`${relay}/dav`, { headers: { ...headers, Origin: 'https://evil.example' } })).status).toBe(403); expect(seen).toHaveLength(1);
});
it('does not expose an unencrypted listener to other LAN devices', () => {
  expect(() => createLocalProxy({ UPSTREAM_URL: 'http://192.168.1.1/webdav/', PROXY_HOST: '0.0.0.0' })).toThrow('LAN access requires');
});
