import { expect, it } from 'vitest';
import { davShareAddress, parseDavAddress, resolveDavAddress, replaceDavAddressCode } from './webdavAddress';
const code = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const config = { url: 'https://server.example/webdav/', folder: 'UniversalSync', username: 'u', password: 'do-not-copy' };
it('copies the effective folder exactly once, with code and no credentials', () => {
  const shared = davShareAddress(config, code);
  expect(shared).toBe(`https://server.example/webdav/UniversalSync@${code}`);
  const parsed = parseDavAddress(shared); expect(parsed.code).toBe(code);
  expect(resolveDavAddress({ ...config, url: shared }, code)).toMatchObject({ url: 'https://server.example/webdav/UniversalSync', folder: '' });
});
it.each(['', 'custom/subfolder', 'Папка/@notes'])('roundtrips folder %s', folder => {
  const shared = davShareAddress({ ...config, folder }, code);
  expect(davShareAddress(resolveDavAddress({ ...config, folder, url: shared }, code), code)).toBe(shared);
});
it('supports explicit trailing slash and root folder sharing', () => {
  expect(parseDavAddress(`https://server.example/webdav/custom/@${code}`).url).toBe('https://server.example/webdav/custom/');
  expect(davShareAddress({ ...config, url: 'https://server.example/', folder: '' }, code)).toBe(`https://server.example/@${code}`);
});
it('keeps plain URL and separate folder compatible', () => {
  expect(parseDavAddress(config.url).code).toBeUndefined(); expect(resolveDavAddress(config)).toEqual(config);
});
it.each([`https://u:p@server.example/path@${code}`, `https://u@${code}`, `http://server.example/path@${code}`, `https://server.example/path?x=@${code}`])('rejects unsafe address %s', url => {
  expect(() => parseDavAddress(url)).toThrow('webdav-https-required');
});
it('blocks a foreign code in current workspace settings', () => {
  expect(() => resolveDavAddress({ ...config, url: `https://server.example/folder@${other}` }, code)).toThrow('webdav-wrong-workspace');
});
it('updates an embedded code when the separate field is edited', () => {
  expect(parseDavAddress(replaceDavAddressCode(`https://server.example/folder@${code}`, other)).code).toBe(other);
  expect(replaceDavAddressCode(config.url, other)).toBe(config.url);
});
