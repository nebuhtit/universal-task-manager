import { expect, test } from '@playwright/test';
import * as Automerge from '@automerge/automerge';
import { createWorkspace, createItem } from '../../packages/core/dist/index.js';
import { createAutomergeDocument, encryptWithKey, randomKey, wrapKey } from '../../packages/sdk/dist/index.js';

test('long All items lists keep search, scrolling and editor focus', async ({ page }) => {
  test.setTimeout(120_000);
  const workspace = createWorkspace('Synthetic list');
  workspace.views = { __all_items__: { id: '__all_items__', name: 'All items', query: { source: 'true' }, renderer: 'list', sort: [], fields: ['title', 'tags', 'schedule.estimatedDuration'] } };
  if (process.env.UTM_LIST_BASELINE) await page.addInitScript(() => { Object.defineProperty(window, 'IntersectionObserver', { value: undefined }); });
  for (let index = 0; index < 1000; index++) {
    const item = createItem(`Profile item ${String(index).padStart(4, '0')}`, 'task');
    item.tags = ['Synthetic']; workspace.items[item.id] = item;
  }
  const key = await randomKey(), password = 'synthetic-list-only';
  const doc = createAutomergeDocument(workspace);
  const metadata = { version: 1, wrappedKey: await wrapKey(key, password), createdAt: new Date().toISOString() };
  const block = { version: 1, ...await encryptWithKey(Automerge.save(doc), key, 'utm:local:workspace:v1') };
  key.fill(0); Automerge.free(doc);
  await page.goto('/'); await page.getByLabel('Workspace name').waitFor();
  await page.evaluate(async ({ metadata, block }) => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('utm-secure-v1'); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('encrypted-records', 'readwrite'), store = tx.objectStore('encrypted-records'); store.put(metadata, 'metadata'); store.put(block, 'workspace'); store.put(block, 'workspace-export-safe'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
  }, { metadata, block });
  await page.reload(); await page.getByLabel('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByPlaceholder('Add new item')).toBeVisible({ timeout: 30_000 });
  const start = Date.now();
  if ((page.viewportSize()?.width ?? 0) <= 620) { await page.getByRole('button', { name: 'Open navigation' }).click(); await page.locator('.mobile-nav-menu').getByRole('button', { name: /^All items/ }).click(); }
  else await page.locator('.sidebar').getByRole('button', { name: /^All items/ }).click();
  const search = page.getByRole('searchbox'); await expect(search).toBeVisible();
  await expect(page.locator('.all-sections .item-card').first()).toBeVisible();
  console.log(JSON.stringify({ phase: process.env.UTM_LIST_BASELINE ? 'baseline' : 'windowed', openMs: Date.now() - start, ...await page.evaluate(() => ({ nodes: document.querySelectorAll('*').length, cards: document.querySelectorAll('.item-card').length })) }));
  if (process.env.UTM_LIST_BASELINE) return;
  expect(await page.locator('.all-sections .item-card').count()).toBeLessThan(100);
  await search.fill('Profile item 0999');
  const result = page.getByRole('article').getByRole('button', { name: /^Profile item 0999\b/ });
  await expect(result).toBeVisible(); await result.focus(); await result.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Item editor', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(result).toBeFocused();
  await search.fill('');
  const list = page.locator('.all-sections [data-windowed-list]').first();
  const row = list.locator('[data-window-row]').last();
  await row.scrollIntoViewIfNeeded();
  await expect(row.getByRole('article').first()).toBeVisible();
  await row.getByRole('article').getByRole('button', { name: /^Profile item/ }).first().focus();
  await row.getByRole('article').getByRole('button', { name: /^Profile item/ }).first().press('Enter');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(row.getByRole('article').getByRole('button', { name: /^Profile item/ }).first()).toBeFocused();
  const middle = list.locator('[data-window-row]').nth(20);
  await middle.focus();
  await expect(middle.locator(':focus')).toHaveCount(1);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(middle.getByRole('article').first()).toBeVisible();
});
