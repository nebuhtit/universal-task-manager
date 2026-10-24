import { davBase, type DavConnection } from './webdavTransport';
export const isDavWorkspaceCode = (value: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

/** @ is a sharing suffix in the PATH, never URL user-info or a password. */
export function parseDavAddress(value: string): { url: string; code?: string } {
  const input = value.trim();
  const at = input.lastIndexOf('@');
  const pathStart = input.indexOf('/', input.indexOf('://') + 3);
  const code = pathStart >= 0 && at > pathStart && isDavWorkspaceCode(input.slice(at + 1)) ? input.slice(at + 1) : undefined;
  let url: URL;
  try { url = new URL(code ? input.slice(0, at) : input); } catch { throw new Error('webdav-https-required'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('webdav-https-required');
  return { url: url.href, ...(code ? { code } : {}) };
}

export function resolveDavAddress<T extends DavConnection>(settings: T, expectedCode?: string): T {
  const parsed = parseDavAddress(settings.url);
  if (parsed.code && expectedCode && parsed.code !== expectedCode) throw new Error('webdav-wrong-workspace');
  // Shared addresses already contain the FULL effective folder path.
  return { ...settings, url: parsed.url, folder: parsed.code ? '' : settings.folder };
}

export function davShareAddress(settings: DavConnection, code: string): string {
  if (!isDavWorkspaceCode(code)) throw new Error('webdav-invalid-workspace-code');
  const base = davBase(resolveDavAddress(settings, code));
  return `${base.pathname === '/' ? base.href : base.href.replace(/\/$/, '')}@${code}`;
}

export function replaceDavAddressCode(address: string, code: string): string {
  try {
    const parsed = parseDavAddress(address);
    return parsed.code && isDavWorkspaceCode(code) ? `${parsed.url}@${code}` : address;
  } catch { return address; }
}
