import { describe, expect, it, vi } from 'vitest';
import { APP_VERSION, SCHEMA_VERSION } from '@utm/core';
import { backupFilenameMetadataEnabled, nativeBackupFilename, setBackupFilenameMetadataEnabled } from './backupFilename';

describe('iOS backup names', () => {
  const now = new Date(2026, 8, 25, 0, 35, 9);
  it('remembers the opt-in and can return to a stable name', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    try {
      expect(backupFilenameMetadataEnabled()).toBe(false);
      setBackupFilenameMetadataEnabled(true);
      expect(backupFilenameMetadataEnabled()).toBe(true);
      expect(nativeBackupFilename('workspace.utmb', now)).toContain('-utm-v');
      setBackupFilenameMetadataEnabled(false);
      expect(nativeBackupFilename('workspace.utmb', now)).toBe('workspace.utmb');
    } finally { vi.unstubAllGlobals(); }
  });
  it('uses stable names by default, including older timestamped exports', () => {
    expect(nativeBackupFilename('workspace.utmb', now)).toBe('workspace.utmb');
    expect(nativeBackupFilename('workspace.utmb', new Date(2027, 0, 1))).toBe('workspace.utmb');
    expect(nativeBackupFilename('workspace-encrypted-backup-2026-09-24T20-00-00-000Z.utmb', now)).toBe('workspace-encrypted-backup.utmb');
    expect(nativeBackupFilename('workspace-utm-v4.7.0-schema-1.26.0-2026-09-24_20-00-00_UTC+0300.utmb', now)).toBe('workspace.utmb');
    expect(nativeBackupFilename('workspace-plaintext-backup-2026-09-24T20-00-00-000Z.json', now)).toBe('workspace-plaintext-backup.json');
  });
  it('includes app, schema, local date, seconds and timezone', () => {
    expect(nativeBackupFilename('workspace.utmb', now, true)).toMatch(new RegExp(`^workspace-utm-v${APP_VERSION.replaceAll('.', '\\.')}\\-schema-${SCHEMA_VERSION.replaceAll('.', '\\.')}\\-2026-09-25_00-35-09_UTC[+-]\\d{4}\\.utmb$`));
  });
  it('does not repeat metadata in recovery names', () => {
    const name = nativeBackupFilename('universal-locked-utm-v3.0.3-schema-1.26.0-2026-09-24T20-00-00-000Z.utmb', now, true);
    expect(name.match(/utm-v/g)).toHaveLength(1);
    expect(name).not.toContain('3.0.3');
  });
  it('also labels plaintext backups without renaming logs', () => {
    expect(nativeBackupFilename('workspace-plaintext-backup-2026-09-24T20-00-00-000Z.json', now, true)).toContain(`utm-v${APP_VERSION}-schema-${SCHEMA_VERSION}`);
    expect(nativeBackupFilename('utm-diagnostics.json', now)).toBe('utm-diagnostics.json');
  });
});
