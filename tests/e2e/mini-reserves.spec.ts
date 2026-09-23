import { expect, test } from '@playwright/test';
import * as Automerge from '@automerge/automerge';
import { createWorkspace, createItem } from '../../packages/core/dist/index.js';
import { createAutomergeDocument, encryptWithKey, randomKey, wrapKey } from '../../packages/sdk/dist/index.js';

test('mini timeline draws hidden reserves without labels in both themes', async ({ page }) => {
  const workspace = createWorkspace('Mini reserve');
  workspace.calendarPreferences.timezone = 'UTC';
  workspace.calendarPreferences.dayView.filter.source = 'title != "Private reserve"';
  const item = createItem('Private reserve', 'event');
  item.schedule = { startAt: '2027-01-15T09:00:00Z', endAt: '2027-01-15T17:00:00Z', timezone: 'UTC' };
  workspace.items[item.id] = item;
  workspace.calendarPreferences.dayView.statistics = { showTime: true, reservedItemIds: [item.id] };
  const key = await randomKey(), password = 'synthetic-preview';
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
  const input = page.locator('.capture-dock input');
  await input.fill('Встреча 15.01.2027');
  const preview = page.locator('.capture-dock .live-day-preview');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await expect(preview).toBeVisible();
    await expect(preview.locator('.live-day-preview-reserve')).toHaveCount(1);
    await expect(preview.locator('.live-day-preview-reserve')).toHaveCSS('opacity', '0.2');
    await expect(preview).not.toContainText('Private reserve');
  }
  await input.fill('Встреча 16.01.2027');
  await expect(preview.locator('.live-day-preview-reserve')).toHaveCount(0);
});
