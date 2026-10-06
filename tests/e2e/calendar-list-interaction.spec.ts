import { expect, test, type Page } from '@playwright/test';
import * as Automerge from '@automerge/automerge';
import { createWorkspace, createItem } from '../../packages/core/dist/index.js';
import { createAutomergeDocument, encryptWithKey, randomKey, wrapKey } from '../../packages/sdk/dist/index.js';

async function setup(page: Page, planning: boolean, count = 3) {
  const w = createWorkspace('List fixture');
  w.calendarPreferences.timezone = 'UTC';
  w.calendarPreferences.planning = { enabled: planning };
  w.calendarPreferences.timeline = { mode: 'list' };
  w.calendarPreferences.dayView.filter.source = 'state == "open"';
  w.calendarPreferences.dayView.listFields = ['title'];
  const day = new Date().toISOString().slice(0, 10);
  for (let index = 0; index < count; index++) {
    const item = createItem(`List fixture ${String(index).padStart(4, '0')}`);
    item.schedule = { plannedDate: day, estimatedDuration: 'PT1M', timezone: 'UTC' };
    w.items[item.id] = item;
  }
  const key = await randomKey(), password = 'calendar-list-test';
  const doc = createAutomergeDocument(w);
  const metadata = { version: 1, wrappedKey: await wrapKey(key, password), createdAt: new Date().toISOString() };
  const block = { version: 1, ...await encryptWithKey(Automerge.save(doc), key, 'utm:local:workspace:v1') };
  key.fill(0); Automerge.free(doc);
  await page.goto('/'); await page.getByLabel('Workspace name').waitFor();
  await page.evaluate(async ({ metadata, block }) => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('utm-secure-v1'); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('encrypted-records', 'readwrite'), s = tx.objectStore('encrypted-records'); s.put(metadata, 'metadata'); s.put(block, 'workspace'); s.put(block, 'workspace-export-safe'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
  }, { metadata, block });
  await page.reload(); await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByPlaceholder('Add new item', { exact: true })).toBeVisible();
  const start = Date.now();
  await page.locator('.quick-page-nav').getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(page.locator('.calendar-day-list .item-card').first()).toBeVisible();
  return Date.now() - start;
}

for (const planning of [false, true]) test(`calendar List hold and drag, planning ${planning}`, async ({ page, isMobile }) => {
  await setup(page, planning);
  const rows = page.locator('.calendar-day-list .view-item-exit-shell');
  const ids = await rows.evaluateAll(elements => elements.map(el => el.getAttribute('data-view-item-id')));
  expect(ids.length).toBe(3);
  const first = rows.first();
  await first.scrollIntoViewIfNeeded();
  const source = first.locator('.card-reorder-surface');
  const bounds = (await source.boundingBox())!;
  const target = (await rows.nth(1).boundingBox())!;
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
  if (isMobile) {
    // A swipe before the hold threshold must not turn into a delayed drag.
    await source.dispatchEvent('pointerdown', { isPrimary: true, pointerType: 'touch', pointerId: 9, clientX: x, clientY: y });
    const scrollingAllowed = await page.evaluate(({ x, y }) => {
      // WebKit does not expose a constructible Touch. The handlers read only
      // coordinates from touches, so provide those on a synthetic DOM event.
      const move = new Event('touchmove', { bubbles: true, cancelable: true });
      Object.defineProperty(move, 'touches', { value: [{ identifier: 9, target: document.body, clientX: x, clientY: y + 40 }] });
      document.dispatchEvent(move); return !move.defaultPrevented;
    }, { x, y });
    expect(scrollingAllowed).toBe(true);
    await page.waitForTimeout(1100);
    await expect(source).not.toHaveClass(/is-dragging/);
    await page.evaluate(() => document.dispatchEvent(new Event('touchcancel', { bubbles: true })));
    await source.dispatchEvent('pointerdown', { isPrimary: true, pointerType: 'touch', pointerId: 1, clientX: x, clientY: y });
    await expect(source).toHaveClass(/is-dragging/, { timeout: 2000 });
    const prevented = await page.evaluate(({ x, y }) => {
      const move = new Event('touchmove', { bubbles: true, cancelable: true });
      Object.defineProperty(move, 'touches', { value: [{ identifier: 1, target: document.body, clientX: x, clientY: y }] });
      document.dispatchEvent(move); return move.defaultPrevented;
    }, { x, y: target.y + target.height - 2 });
    expect(prevented).toBe(true);
    await page.evaluate(() => document.dispatchEvent(new Event('touchend', { bubbles: true })));
  } else {
    await page.mouse.move(x, y); await page.mouse.down();
    await expect(source).toHaveClass(/is-dragging/, { timeout: 2000 });
    await page.mouse.move(x, target.y + target.height - 2); await page.mouse.up();
  }
  await expect.poll(() => rows.first().getAttribute('data-view-item-id')).toBe(ids[1]);
  await expect(page.getByRole('dialog', { name: 'Item editor' })).toBeHidden();
  // The post-drop ghost-click guard is deliberately still active for 700ms.
  await page.waitForTimeout(750);
  const completed = rows.first(); const id = await completed.getAttribute('data-view-item-id');
  await completed.locator('.state-toggle').click();
  await expect(completed.locator('.item-card')).toHaveClass(/state-done/);
  await page.waitForTimeout(2000);
  expect(await rows.first().getAttribute('data-view-item-id')).toBe(id);
  await expect(page.locator(`[data-view-item-id="${id}"]`)).toHaveCount(0, { timeout: 2500 });
});

test('measure 300 calendar cards and verify scroll, row height and focus', async ({ page }) => {
  test.setTimeout(90000);
  const openMs = await setup(page, false, 300);
  const rows = page.locator('.calendar-day-list .item-card');
  const height = (await rows.first().boundingBox())!.height;
  console.log(JSON.stringify({ scenario: 'calendar-300', openMs, cards: await rows.count(), firstRowHeight: height }));
  await rows.last().scrollIntoViewIfNeeded();
  await expect(rows.last()).toBeVisible();
  await rows.first().scrollIntoViewIfNeeded();
  expect(Math.abs((await rows.first().boundingBox())!.height - height)).toBeLessThan(2);
  const button = rows.first().locator('.item-main');
  await button.focus(); await button.press('Enter');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(button).toBeFocused();
});
