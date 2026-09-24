import { describe, expect, it } from 'vitest';
import { APP_VERSION, SCHEMA_VERSION } from '@utm/core';
import { nativeBackupFilename } from './backupFilename';

describe('iOS backup names', () => {
  const now = new Date(2026, 8, 25, 0, 35, 9);
  it('includes app, schema, local date, seconds and timezone', () => {
    expect(nativeBackupFilename('workspace.utmb', now)).toMatch(new RegExp(`^workspace-utm-v${APP_VERSION.replaceAll('.', '\\.')}\\-schema-${SCHEMA_VERSION.replaceAll('.', '\\.')}\\-2026-09-25_00-35-09_UTC[+-]\\d{4}\\.utmb$`));
  });
  it('does not repeat metadata in recovery names', () => {
    const name = nativeBackupFilename('universal-locked-utm-v3.0.3-schema-1.26.0-2026-09-24T20-00-00-000Z.utmb', now);
    expect(name.match(/utm-v/g)).toHaveLength(1);
    expect(name).not.toContain('3.0.3');
  });
  it('also labels plaintext backups without renaming logs', () => {
    expect(nativeBackupFilename('workspace-plaintext-backup-2026-09-24T20-00-00-000Z.json', now)).toContain(`utm-v${APP_VERSION}-schema-${SCHEMA_VERSION}`);
    expect(nativeBackupFilename('utm-diagnostics.json', now)).toBe('utm-diagnostics.json');
  });
});
