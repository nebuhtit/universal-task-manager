import { expect, test } from '@playwright/test';
import * as Automerge from '@automerge/automerge';
import { createWorkspace, createItem, SCHEMA_VERSION } from '../../packages/core/dist/index.js';
import { createAutomergeDocument, encryptWithKey, randomKey, wrapKey } from '../../packages/sdk/dist/index.js';

const password = 'migration-fault-test-only';
async function legacyFixture(schema = '1.25.0') {
  const workspace = createWorkspace('Migration durability');
  workspace.schemaVersion = schema;
  const item = createItem('Migration sentinel'); workspace.items[item.id] = item;
  const doc = createAutomergeDocument(workspace);
  const key = await randomKey();
  try {
    const metadata = { version: 1, wrappedKey: await wrapKey(key, password), createdAt: new Date().toISOString() };
    const block = { version: 1, ...await encryptWithKey(Automerge.save(doc), key, 'utm:local:workspace:v1') };
    return { metadata, block };
  } finally { key.fill(0); Automerge.free(doc); }
}

for (const fail of [false, true]) test(`migration preserves the old checkpoint; transaction failure=${fail}`, async ({ page }) => {
  test.setTimeout(90_000);
  const fixture = await legacyFixture();
  await page.goto('/');
  await page.getByLabel('Workspace name').waitFor();
  await page.evaluate(async ({ metadata, block }) => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('utm-secure-v1'); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('encrypted-records', 'readwrite'); const store = tx.objectStore('encrypted-records'); store.put(metadata, 'metadata'); store.put(block, 'workspace'); store.put(block, 'workspace-export-safe'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
  }, fixture);
  await page.reload();
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save old version and update' })).toBeVisible();
  if (fail) await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) { if (key === 'workspace-snapshot-1') throw new DOMException('Injected snapshot quota', 'QuotaExceededError'); return put.call(this, value, key); };
  });
  await page.getByRole('button', { name: 'Save old version and update' }).click();
  if (fail) await expect(page.getByText('SAFE RECOVERY MODE', { exact: true })).toBeVisible({ timeout: 30_000 });
  else await expect(page.getByPlaceholder('Add new item')).toBeVisible({ timeout: 30_000 });
  const stored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('utm-secure-v1'); r.onsuccess = () => resolve(r.result); });
    const get = (key: string) => new Promise<any>((resolve) => { const r = db.transaction('encrypted-records').objectStore('encrypted-records').get(key); r.onsuccess = () => resolve(r.result); });
    try { return { primary: await get('workspace'), snapshot: await get('workspace-snapshot-1'), mirror: await get('workspace-verified-mirror-1') }; } finally { db.close(); }
  });
  if (fail) { expect(stored.primary).toEqual(fixture.block); expect(stored.snapshot).toBeUndefined(); }
  else { expect(stored.snapshot.workspace).toEqual(fixture.block); expect(stored.mirror.workspace).toEqual(stored.primary); }
});

test('replacement rejects a damaged backup and rolls back on quota before a successful checkpointed restore', async ({ page }) => {
  test.setTimeout(120_000);
  const original = await legacyFixture(SCHEMA_VERSION);
  const incoming = await legacyFixture(SCHEMA_VERSION);
  await page.goto('/');
  await page.getByLabel('Workspace name').waitFor();
  await page.evaluate(async ({ metadata, block }) => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('utm-secure-v1'); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>((resolve) => { const tx = db.transaction('encrypted-records', 'readwrite'); const store = tx.objectStore('encrypted-records'); store.put(metadata, 'metadata'); store.put(block, 'workspace'); store.put(block, 'workspace-export-safe'); tx.oncomplete = () => resolve(); }); db.close();
  }, original);
  await page.reload();
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByPlaceholder('Add new item')).toBeVisible({ timeout: 30_000 });
  const snapshot = () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('utm-secure-v1'); r.onsuccess = () => resolve(r.result); });
    try { return await new Promise<any>((resolve) => { const tx = db.transaction('encrypted-records'); const store = tx.objectStore('encrypted-records'); const values: Record<string, unknown> = {}; for (const key of ['metadata', 'workspace', 'workspace-export-safe', 'workspace-snapshot-1', 'workspace-verified-mirror-1']) { const r = store.get(key); r.onsuccess = () => { values[key] = r.result; }; } tx.oncomplete = () => resolve(values); }); } finally { db.close(); }
  });
  const before = await snapshot();
  await page.locator('.sidebar .sidebar-bottom button').filter({ hasText: 'Transfer' }).evaluate((button: HTMLButtonElement) => button.click());
  await page.getByLabel('Backup password (only for import)').fill(password);
  const source = { magic: 'UTM-LOCAL-ENCRYPTED', version: 1, metadata: incoming.metadata, workspace: incoming.block };
  const input = page.locator('.transfer-actions input[type=file]');
  await input.setInputFiles({ name: 'damaged.utmb', mimeType: 'application/octet-stream', buffer: Buffer.from(JSON.stringify({ ...source, workspace: { ...incoming.block, ciphertext: 'damaged' } })) });
  await expect(page.locator('.dialog .error')).toBeVisible();
  expect(await snapshot()).toEqual(before);
  await input.setInputFiles({ name: 'valid.utmb', mimeType: 'application/octet-stream', buffer: Buffer.from(JSON.stringify(source)) });
  const replace = page.getByRole('button', { name: 'Replace local workspace from backup' });
  await expect(replace).toBeVisible();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    (window as any).restorePut = () => { IDBObjectStore.prototype.put = put; };
    IDBObjectStore.prototype.put = function (value, key) { if (key === 'workspace-verified-mirror-1') throw new DOMException('Injected mirror quota', 'QuotaExceededError'); return put.call(this, value, key); };
  });
  await replace.click();
  await expect(page.locator('.dialog .error')).toContainText('Injected mirror quota');
  expect(await snapshot()).toEqual(before);
  await page.evaluate(() => (window as any).restorePut());
  await replace.click();
  await expect(replace).toHaveCount(0);
  const after = await snapshot();
  expect(after['workspace']).toEqual(incoming.block);
  expect(after['workspace-snapshot-1'].workspace).toEqual(before.workspace);
  expect(after['workspace-verified-mirror-1'].workspace).toEqual(incoming.block);
});
