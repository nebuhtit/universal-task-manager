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
  await expect(page.getByTestId('save-status')).toContainText(/Не сохранено|Not saved/);
  expect(await records(page)).toBe(before);
  await expect(page.getByRole('dialog', { name: 'Item editor' })).toBeVisible();
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as any).copiedRecovery = text; } } }); });
  const editor = page.getByRole('dialog', { name: 'Item editor' });
  await editor.getByRole('button', { name: 'Copy item JSON', exact: true }).click();
  const recovered = JSON.parse(await page.evaluate(() => (window as any).copiedRecovery));
  expect(recovered.title).toBe('Latest durable sentinel');
  expect(recovered.schedule.estimatedDuration).toBe('PT10M');
  await editor.getByRole('button', { name: 'Copy unsaved items JSON', exact: true }).click();
  const unsaved = JSON.parse(await page.evaluate(() => (window as any).copiedRecovery));
  expect((Array.isArray(unsaved) ? unsaved : [unsaved]).some((item: any) => item.id === recovered.id && item.title === recovered.title)).toBe(true);
  // Copying is recovery only, never an acknowledgement of durable saving.
  expect(await records(page)).toBe(before);
  await expect(editor.getByTestId('editor-save-status')).toContainText(/only in memory|только в памяти/);
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
  await page.getByRole('checkbox', { name: /Безопасное открытие/ }).check();
  await page.getByLabel('Backup password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /Preview backup without importing|Посмотреть бэкап без импорта/ }).click();
  await expect(page.getByText('Latest durable sentinel', { exact: true })).toBeVisible();
});

test('a stalled storage read fails visibly; retry and reload retain the recovered item', async ({ page }) => {
  await create(page);
  await page.clock.install();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.get;
    (window as any).restoreGet = () => { IDBObjectStore.prototype.get = original; };
    IDBObjectStore.prototype.get = function (key) {
      if (key === 'workspace-verified-mirror-1') return {} as IDBRequest;
      return original.call(this, key);
    };
  });
  await draft(page, 'Stalled read sentinel');
  // Let the persistence worker reach the intercepted storage read first.
  await page.waitForTimeout(300);
  await page.clock.runFor(31_000);
  await expect(page.getByTestId('save-status')).toContainText(/Не сохранено|Not saved/);
  const editor = page.getByRole('dialog', { name: 'Item editor' });
  await expect(editor.getByRole('button', { name: /Copy unsaved items JSON|Скопировать JSON несохранённых items/ })).toBeVisible();
  await page.evaluate(() => (window as any).restoreGet());
  await editor.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByTestId('save-status')).toHaveCount(0);
  await page.reload();
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByText('Stalled read sentinel', { exact: true }).first()).toBeVisible();
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
  await expect(page.getByTestId('save-status')).toContainText(/Сохранение|Saving/);
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
