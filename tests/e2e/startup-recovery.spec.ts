import { expect, test, type Page } from '@playwright/test';

async function storedRecords(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('utm-secure-v1');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<string>((resolve, reject) => {
        const tx = db.transaction('encrypted-records', 'readonly');
        const request = tx.objectStore('encrypted-records').getAll();
        request.onsuccess = () => resolve(JSON.stringify(request.result)); request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  });
}

test('interrupted startup offers read-only recovery and backup comparison without replacing storage', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto(process.env.UTM_TEST_URL ?? '/');
  const password = 'recovery-test-password-only';
  await page.getByLabel('Workspace name').fill('Recovery test');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await page.getByPlaceholder('Add new item').fill('Read-only sentinel');
  await page.getByPlaceholder('Add new item').press('Enter');
  await page.getByRole('button', { name: 'Save item', exact: true }).click();
  const lock = page.locator('.sidebar .sidebar-bottom button').filter({ hasText: 'Lock' });
  await lock.evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole('heading', { name: 'Unlock your workspace' })).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem('utm:startup-pending:v1', '1'));
  await page.reload();
  const safe = page.getByRole('checkbox', { name: /Безопасное открытие/ });
  await expect(safe).toBeChecked();
  await page.getByText('Help', { exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save encrypted recovery copy + log' }).click();
  const backup = await download;
  const backupPath = await backup.path();
  expect(backupPath).toBeTruthy();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const request = indexedDB.open('utm-secure-v1'); request.onsuccess = () => resolve(request.result); });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('encrypted-records', 'readwrite'); tx.objectStore('encrypted-records').delete('workspace-export-safe'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  });
  let before = await storedRecords(page);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByText('SAFE RECOVERY MODE', { exact: true })).toBeVisible();
  await expect(page.getByText('Read-only sentinel', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const recovery = page.locator('.recovery-shell');
  const bounds = await recovery.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.getByRole('button', { name: 'Download encrypted workspace + log' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Download encrypted workspace + log' })).toBeInViewport();
  await page.screenshot({ path: `/tmp/utm-recovery-${page.viewportSize()!.width}.png` });
  expect(await storedRecords(page)).toBe(before);
  await expect(page.getByPlaceholder('Add new item')).toHaveCount(0);
  await page.getByRole('button', { name: 'Вернуться к выбору открытия' }).click();
  // A fallback mirror may be read, but must not silently repair the primary.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const request = indexedDB.open('utm-secure-v1'); request.onsuccess = () => resolve(request.result); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('encrypted-records', 'readwrite');
      const store = tx.objectStore('encrypted-records'); const request = store.get('workspace');
      request.onsuccess = () => store.put({ ...request.result, ciphertext: 'broken-primary-for-test' }, 'workspace');
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  before = await storedRecords(page);
  await safe.check();
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByText('Read-only sentinel', { exact: true })).toBeVisible();
  expect(await storedRecords(page)).toBe(before);
  await page.getByRole('button', { name: 'Вернуться к выбору открытия' }).click();
  await page.locator('input[type=file]').first().setInputFiles(backupPath!);
  await page.getByLabel('Backup password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Посмотреть бэкап без импорта' }).click();
  await expect(page.getByText('Read-only sentinel', { exact: true })).toBeVisible();
  expect(await storedRecords(page)).toBe(before);
  const log = await page.evaluate(() => JSON.parse(localStorage.getItem('utm:startup-log:v1') ?? '[]'));
  expect(log.some((entry: { source: string; stage: string }) => entry.source === 'safe' && entry.stage === 'load')).toBe(true);
  expect(log.some((entry: { source: string; stage: string }) => entry.source === 'backup' && entry.stage === 'load')).toBe(true);
  expect(JSON.stringify(log)).not.toContain(password);
  expect(JSON.stringify(log)).not.toContain('Read-only sentinel');
});
