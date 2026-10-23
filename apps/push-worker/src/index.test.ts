import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import worker, { type Env } from './index';

let sqlite: DatabaseSync;
const secret = 'test-device-secret-longer-than-thirty-two-characters';
const now = Date.parse('2026-10-21T12:00:00Z');
const week = 7 * 86_400_000;

class Statement {
  values: Array<string | number> = [];
  constructor(readonly sql: string) {}
  bind(...values: Array<string | number>) { this.values = values; return this; }
  async first() { return sqlite.prepare(this.sql).get(...this.values) ?? null; }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.values) }; }
  async run() { return { meta: { changes: sqlite.prepare(this.sql).run(...this.values).changes } }; }
}

function environment(): Env {
  return {
    DB: {
      prepare: (sql: string) => new Statement(sql),
      batch: async (statements: Statement[]) => {
        sqlite.exec('BEGIN');
        try {
          const results = [];
          for (const statement of statements) results.push(await statement.run());
          sqlite.exec('COMMIT');
          return results;
        } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      },
    } as unknown as Env['DB'],
    ALLOWED_ORIGINS: 'https://example.test', ACCESS_CODE: 'test-access',
    VAPID_PRIVATE_JWK: '', VAPID_PUBLIC_JWK: '', VAPID_SUBJECT: '',
  };
}

async function addDevice(id: string, enabled = 1) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)));
  const hash = btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  sqlite.prepare('INSERT INTO devices VALUES (?, ?, ?, ?, ?)').run(id, hash, '{}', enabled, now);
}
function addJob(id: string, deviceId: string, state: string, updatedAt: number) {
  sqlite.prepare('INSERT INTO jobs VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, deviceId, now + 3_600_000, '{}', state, 0, updatedAt);
}
async function disable(deviceId: string, deviceSecret = secret) {
  return worker.fetch(new Request('https://example.test/v1/subscriptions', {
    method: 'DELETE', body: JSON.stringify({ deviceId, deviceSecret }),
  }), environment(), {} as never);
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0002_job_retention.sql', import.meta.url), 'utf8'));
});
afterEach(() => { sqlite.close(); vi.restoreAllMocks(); });

it('purges terminal jobs at seven days, preserves recent/active jobs and removes legacy disabled devices', async () => {
  await addDevice('device-a'); await addDevice('device-b', 0);
  addJob('old-sent', 'device-a', 'sent', now - week);
  addJob('old-cancelled', 'device-a', 'cancelled', now - week - 1);
  addJob('recent-sent', 'device-a', 'sent', now - week + 1);
  addJob('recent-cancelled', 'device-a', 'cancelled', now);
  addJob('active', 'device-a', 'scheduled', now - week - 1);
  addJob('in-flight', 'device-a', 'sending', now - week - 1);
  addJob('disabled-device', 'device-b', 'scheduled', now);
  let pending: Promise<unknown> | undefined;
  await worker.scheduled({} as never, environment(), { waitUntil: (work: Promise<unknown>) => { pending = work; } } as never);
  await pending;
  expect(sqlite.prepare('SELECT job_id FROM jobs ORDER BY job_id').all().map(row => row.job_id))
    .toEqual(['active', 'in-flight', 'recent-cancelled', 'recent-sent']);
  expect(sqlite.prepare('SELECT device_id FROM devices').all().map(row => row.device_id)).toEqual(['device-a']);
});

it.each([0, 1])('deletes all job states and subscription data for an authenticated device (enabled=%s), retry is safe', async enabled => {
  await addDevice('device-a', enabled); await addDevice('device-b');
  for (const state of ['scheduled', 'sending', 'sent', 'cancelled']) addJob(`a-${state}`, 'device-a', state, now);
  addJob('other-job', 'device-b', 'scheduled', now);
  expect((await disable('device-a')).status).toBe(200);
  expect((await disable('device-a')).status).toBe(200);
  expect(sqlite.prepare('SELECT device_id FROM devices').all().map(row => row.device_id)).toEqual(['device-b']);
  expect(sqlite.prepare('SELECT job_id FROM jobs').all().map(row => row.job_id)).toEqual(['other-job']);
  // A stale sync that authenticated before deletion cannot resurrect jobs.
  expect(() => addJob('late-job', 'device-a', 'scheduled', now)).toThrow();
});

it('does not delete any data when an existing device secret is wrong', async () => {
  await addDevice('device-a'); addJob('keep-job', 'device-a', 'scheduled', now);
  expect((await disable('device-a', 'wrong-secret-that-is-also-longer-than-thirty-two')).status).toBe(400);
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM devices').get()?.n).toBe(1);
  expect(sqlite.prepare('SELECT COUNT(*) AS n FROM jobs').get()?.n).toBe(1);
});
