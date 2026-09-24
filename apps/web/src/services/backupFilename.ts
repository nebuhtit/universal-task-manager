import { APP_VERSION, SCHEMA_VERSION } from '@utm/core';

/** Names user-facing iOS backups; diagnostics and other downloads retain their names. */
export function nativeBackupFilename(fileName: string, now = new Date()): string {
  const extension = /\.utmb$/i.test(fileName) ? '.utmb' : /plaintext-backup.*\.json$/i.test(fileName) ? '.json' : undefined;
  if (!extension) return fileName;
  const stem = fileName.slice(0, -extension.length)
    .replace(/-utm-v[^/]+-schema-.*$/, '')
    .replace(/-\d{4}-\d{2}-\d{2}T[\dZ-]+$/, '')
    .replace(/[/\\:\x00-\x1f]/g, '-').slice(0, 90) || 'universal-backup';
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const offset = -now.getTimezoneOffset();
  const zone = `UTC${offset >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offset) / 60))}${pad(Math.abs(offset) % 60)}`;
  return `${stem}-utm-v${APP_VERSION}-schema-${SCHEMA_VERSION}-${stamp}_${zone}${extension}`;
}
