import { expect, test, type Page } from '@playwright/test';

const password = 'fault-fixture-password-only';
async function create(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('Fault test');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await expect(page.getByPlaceholder('Add new item')).toBeVisible();
}
async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('utm-secure-v1'); r.onsuccess = () => resolve(r.result); });
    try { return await new Promise<string>((resolve) => { const tx = db.transaction('encrypted-records'); const r = tx.objectStore('encrypted-records').getAll(); r.onsuccess = () => resolve(JSON.stringify(r.result)); }); }
    finally { db.close(); }
  });
}
async function draft(page: Page, title: string) {
  await page.getByPlaceholder('Add new item').fill(title);
  await page.getByPlaceholder('Add new item').press('Enter');
  await expect(page.getByRole('dialog', { name: 'Item editor' })).toBeVisible();
}

test('quota at second write rolls back all records; retry commits and backup contains latest item', async ({ page }) => {
  await create(page);
  const before = await records(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as any).restorePut = () => { IDBObjectStore.prototype.put = original; };
    IDBObjectStore.prototype.put = function (value, key) {
      if (key === 'workspace-export-safe') throw new DOMException('Injected quota failure', 'QuotaExceededError');
      return original.call(this, value, key);
    };
  });
  await draft(page, 'Latest durable sentinel');
  await page.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(page.getByTestId('save-status')).toContainText('Не сохранено');
  expect(await records(page)).toBe(before);
  await expect(page.getByRole('dialog', { name: 'Item editor' })).toBeVisible();
  await page.evaluate(() => (window as any).restorePut());
  await page.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Item editor' })).toHaveCount(0);
  await expect(page.getByTestId('save-status')).toHaveCount(0);
  expect(await records(page)).not.toBe(before);
  const locked = page.locator('.sidebar .sidebar-bottom button').filter({ hasText: 'Lock' });
  await locked.evaluate((button: HTMLButtonElement) => button.click());
  await page.getByText('Help', { exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save encrypted recovery copy + log' }).click();
  const file = await (await download).path();
  await page.locator('input[type=file]').first().setInputFiles(file!);
  await page.getByLabel('Backup password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Посмотреть бэкап без импорта' }).click();
  await expect(page.getByText('Latest durable sentinel', { exact: true })).toBeVisible();
});

test('closing with unconfirmed write reopens previous confirmed data with an explicit warning', async ({ page, context }) => {
  await create(page);
  const before = await records(page);
  await page.evaluate(() => {
    // Leave serialization in flight, then simulate process shutdown before it
    // responds. No durable write has been acknowledged yet.
    Worker.prototype.postMessage = function () {};
  });
  await draft(page, 'Not yet saved');
  await page.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(page.getByTestId('save-status')).toContainText('Сохранение');
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto('/');
  await expect(reopened.getByText(/Последнее сохранение не было подтверждено/)).toBeVisible();
  expect(await records(reopened)).toBe(before);
});

test('second tab cannot edit; safe preview remains available and does not write', async ({ page, context }) => {
  await create(page);
  const before = await records(page);
  const second = await context.newPage();
  await second.goto('/');
  await second.getByRole('checkbox', { name: /Безопасное открытие/ }).uncheck();
  await second.getByLabel('Password', { exact: true }).fill(password);
  await second.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(second.getByText(/Workspace is open for editing in another tab/)).toBeVisible();
  await second.getByRole('checkbox', { name: /Безопасное открытие/ }).check();
  await second.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(second.getByText('SAFE RECOVERY MODE', { exact: true })).toBeVisible();
  expect(await records(second)).toBe(before);
});

test('worker construction failure falls back to verified saving', async ({ page }) => {
  await page.addInitScript(() => { window.Worker = class { constructor() { throw new Error('Injected worker startup failure'); } } as unknown as typeof Worker; });
  await create(page);
  await draft(page, 'Worker fallback sentinel');
  await page.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Item editor' })).toHaveCount(0);
  await expect(page.getByTestId('save-status')).toHaveCount(0);
});
