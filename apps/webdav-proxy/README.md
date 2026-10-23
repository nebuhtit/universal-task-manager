# UTM WebDAV HTTPS proxy

Separate Cloudflare Worker for browsers whose WebDAV server cannot enable CORS. Native iOS keeps its direct connection. No database, file storage, credentials or workspace encryption keys are configured in this Worker. The Basic WebDAV credentials pass through it in memory over HTTPS, so use an operator you trust.

Set `ALLOWED_ORIGINS` to exact trusted application origins and `UPSTREAM_BASES` to comma-separated trusted HTTPS WebDAV base URLs with trailing slashes. The checked-in configuration permits the user's Keenetic WebDAV only. Other users can deploy their own instance with their server configured; this is not an arbitrary public proxy. Do not allow localhost, private IPs or internal-service domains as upstreams.

Deploy from this directory using `pnpm dlx wrangler deploy`. Enter the resulting `https://…workers.dev/dav` URL in UTM's HTTPS proxy field (sign-in or Settings → WebDAV). Leave the WebDAV server URL and credentials unchanged. Leave proxy empty for direct access. The proxy address is stored with device-local encrypted connection settings.

The relay preserves HTTP status, ETag, If-Match, If-None-Match, LOCK/UNLOCK tokens, finite lock timeout and MOVE destination/Overwrite. It refuses redirects and paths outside configured servers. CORS preflight is answered locally. Request and response payloads are bounded to 20 MiB; upstream requests have a 30-second timeout. Runtime observability is disabled. Do not enable logging of request headers or bodies.

Verification: `pnpm exec vitest run apps/webdav-proxy/src/index.test.ts apps/web/src/services/webdavSync.test.ts` from the repository root. After deployment, verify OPTIONS plus an authenticated read before testing sync with disposable data.
