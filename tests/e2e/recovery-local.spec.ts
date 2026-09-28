import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Explicit local opt-in only. Never include private captures in test artifacts.
test.use({ screenshot: 'off', trace: 'off', video: 'off' });
test('opens and saves an explicitly supplied encrypted recovery copy', async ({ page }) => {
  test.skip(!process.env.UTM_RECOVERY_PATH || !process.env.UTM_AUDIT_PASSWORD, 'Local recovery fixture required');
  test.setTimeout(120_000);
  const backup = JSON.parse(await readFile(process.env.UTM_RECOVERY_PATH!, 'utf8'));
  await page.goto('/');
  await expect(page.locator('.lock-card')).toBeVisible();
  await page.evaluate(async ({ metadata, workspace }) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('utm-secure-v1', 1);
      open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains('encrypted-records')) open.result.createObjectStore('encrypted-records'); };
      open.onerror = () => reject(new Error('Storage open failed'));
      open.onsuccess = () => {
        const db = open.result, transaction = db.transaction('encrypted-records', 'readwrite'), store = transaction.objectStore('encrypted-records');
        store.put(metadata, 'metadata'); store.put(workspace, 'workspace'); store.put(workspace, 'workspace-export-safe');
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => { db.close(); reject(new Error('Storage seed failed')); };
      };
    });
  }, { metadata: backup.metadata, workspace: backup.workspace });
  await page.reload();
  await page.getByLabel('Password', { exact: true }).fill(process.env.UTM_AUDIT_PASSWORD!);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 90_000 });
  await expect.poll(() => page.evaluate(() => localStorage.getItem('utm:pending-save:v1')), { timeout: 30_000 }).toBeNull();
  const capture = page.getByPlaceholder('Add new item', { exact: true });
  await capture.fill('Recovery persistence probe');
  await capture.press('Enter');
  await expect.poll(() => page.evaluate(() => {
    const log = JSON.parse(localStorage.getItem('utm:sync-trace:v1') ?? '[]');
    return log.some((entry: { event: string }) => entry.event === 'save-end');
  }), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('utm:pending-save:v1')), { timeout: 30_000 }).toBeNull();
  await page.reload();
  await page.getByLabel('Password', { exact: true }).fill(process.env.UTM_AUDIT_PASSWORD!);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText('Recovery persistence probe', { exact: true }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('utm:pending-save:v1')), { timeout: 30_000 }).toBeNull();
  // Restore the freshly saved privacy-safe block, not just the live CRDT block.
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('utm-secure-v1', 1);
      open.onerror = () => reject(new Error('Storage open failed'));
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction('encrypted-records', 'readwrite'), store = tx.objectStore('encrypted-records');
        const read = store.get('workspace-export-safe');
        read.onsuccess = () => { store.put(read.result, 'workspace'); };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(new Error('Recovery install failed')); };
      };
    });
  });
  await page.reload();
  await page.getByLabel('Password', { exact: true }).fill(process.env.UTM_AUDIT_PASSWORD!);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText('Recovery persistence probe', { exact: true }).first()).toBeVisible();
});
