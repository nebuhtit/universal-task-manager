import { expect, test, type Page } from '@playwright/test';
import * as Automerge from '@automerge/automerge';
import { createWorkspace, createItem, type WorkspaceDocument } from '../../packages/core/dist/index.js';
import { createAutomergeDocument, decryptWithKey, encryptWithKey, randomKey, wrapKey } from '../../packages/sdk/dist/index.js';

const password = 'calendar-planning-fixture';
const now = new Date('2026-09-24T08:00:00Z');
async function setup(page: Page, conflict = true) {
  const w = createWorkspace('Planning', now); w.calendarPreferences.timezone = 'UTC';
  w.calendarPreferences.appearance.mode = 'light'; w.calendarPreferences.dayView.filter.source = 'true';
  w.calendarPreferences.dayView.sortSource = 'title asc'; w.calendarPreferences.dayView.sort = [{ expression: 'title', direction: 'asc', nulls: 'last' }];
  w.calendarPreferences.timeline = { mode: 'list', hideSleep: false, showUndated: true };
  const task = createItem('A task', 'task', now); task.id = 'task'; task.schedule = { timezone: 'UTC', estimatedDuration: 'PT30M', dueAt: '2026-09-24T12:00:00Z' };
  const event = createItem('B event', 'event', now); event.id = 'event'; event.schedule = { timezone: 'UTC', startAt: '2026-09-24T10:00:00Z', endAt: '2026-09-24T11:00:00Z', estimatedDuration: 'PT1H', travelBackDuration: 'PT30M' };
  const busy = createItem('C blocker', 'event', now); busy.id = 'blocker'; busy.schedule = { timezone: 'UTC', startAt: '2026-09-25T10:00:00Z', endAt: '2026-09-25T12:00:00Z' };
  w.items = { task, event, blocker: busy };
  if (!conflict) { busy.schedule!.startAt = '2026-09-25T13:00:00Z'; busy.schedule!.endAt = '2026-09-25T14:00:00Z'; }
  const doc = createAutomergeDocument(w), key = await randomKey();
  const metadata = { version: 1, wrappedKey: await wrapKey(key, password), createdAt: now.toISOString() };
  const block = { version: 1, ...await encryptWithKey(Automerge.save(doc), key, 'utm:local:workspace:v1') }; Automerge.free(doc);
  await page.clock.install({ time: now }); await page.goto('/'); await page.getByLabel('Workspace name').waitFor();
  await page.evaluate(async ({ metadata, block }) => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('utm-secure-v1'); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('encrypted-records', 'readwrite'), s = tx.objectStore('encrypted-records'); s.put(metadata, 'metadata'); s.put(block, 'workspace'); s.put(block, 'workspace-export-safe'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
  }, { metadata, block });
  await page.reload(); await unlock(page); await navigate(page, 'Calendar');
  const read = async () => {
    const block = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('utm-secure-v1'); r.onsuccess = () => resolve(r.result); });
      try { return await new Promise<{ nonce: string; ciphertext: string }>(resolve => { const r = db.transaction('encrypted-records').objectStore('encrypted-records').get('workspace'); r.onsuccess = () => resolve(r.result); }); } finally { db.close(); }
    });
    const doc = Automerge.load<WorkspaceDocument>(await decryptWithKey(block, key, 'utm:local:workspace:v1'));
    const value = Automerge.toJS(doc); Automerge.free(doc); return value;
  };
  await expect(page.locator('.calendar-page')).toBeVisible();
  return { read };
}
async function unlock(page: Page) {
  await page.getByLabel('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 30_000 });
}
async function navigate(page: Page, label: string) {
  if ((page.viewportSize()?.width ?? 0) <= 620) { await page.getByRole('button', { name: 'Open navigation' }).click(); await page.locator('.mobile-nav-menu').getByRole('button', { name: label, exact: true }).click(); }
  else await page.locator('.sidebar').getByRole('button', { name: label, exact: true }).click();
}
async function swipe(page: Page, id: string, right = true) {
  const card = page.locator(`[data-utm-item-id="${id}"]`).first(); await card.scrollIntoViewIfNeeded();
  await card.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: 160, clientY: 300 }] });
  await card.dispatchEvent('touchend', { changedTouches: [{ identifier: 1, clientX: right ? 280 : 40, clientY: 302 }] });
}

test('reference conflict, queue, reload and unpin leave original items unchanged', async ({ page }) => {
  const { read } = await setup(page), before = (await read()).items;
  const googleRequests: string[] = []; page.on('request', req => { if (/googleapis.com\/calendar/.test(req.url())) googleRequests.push(req.url()); });
  await swipe(page, 'event');
  const dialog = page.getByRole('dialog', { name: 'Calendar pin' }); await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Tomorrow', exact: true }).click(); await dialog.getByRole('button', { name: 'Same time', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('overlaps');
  expect((await read()).calendarPreferences.planning?.pins).toBeUndefined();
  await dialog.getByRole('button', { name: 'Queue', exact: true }).click(); await expect(dialog).toBeHidden();
  await expect.poll(async () => (await read()).calendarPreferences.planning?.pins?.event?.mode).toBe('queue');
  expect((await read()).items).toEqual(before);
  await page.clock.fastForward(11_000);
  await page.reload(); await unlock(page); await navigate(page, 'Calendar');
  await page.locator('.calendar-day-choice').filter({ hasText: 'Sep 25' }).click();
  await expect(page.locator('[data-utm-item-id="event"]')).toHaveCount(1);
  await expect(page.locator('.calendar-reference-badge')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('calendar-reference-light.png') });
  await swipe(page, 'event'); await dialog.getByRole('button', { name: 'Unpin', exact: true }).click(); await expect(dialog).toBeHidden();
  await expect.poll(async () => (await read()).calendarPreferences.planning?.pins?.event).toBeUndefined();
  expect((await read()).items).toEqual(before); expect(googleRequests).toEqual([]);
});

test('keyboard reorder shared with Timeline, two reset confirmations and off switch', async ({ page }) => {
  const { read } = await setup(page), before = (await read()).items;
  const handle = page.getByRole('button', { name: 'Reorder A task', exact: true });
  await handle.focus(); await handle.press('ArrowDown');
  await expect.poll(async () => (await read()).calendarPreferences.planning?.orders?.['2026-09-24']).toEqual(['event', 'task']);
  await expect(handle).toBeFocused();
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.getByTestId('timeline-tentative').filter({ hasText: 'A task' })).toHaveAttribute('aria-label', /11:30–12:00/);
  await page.getByRole('button', { name: 'Reset day order', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Reset calendar order' });
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click(); await expect(dialog).toContainText('2026-09-24');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await read()).calendarPreferences.planning?.orders?.['2026-09-24']).toEqual(['event', 'task']);
  await page.getByRole('button', { name: 'Reset day order', exact: true }).click(); await dialog.getByRole('button', { name: 'Continue', exact: true }).click(); await dialog.getByRole('button', { name: 'Confirm reset', exact: true }).click();
  await expect.poll(async () => (await read()).calendarPreferences.planning?.orders?.['2026-09-24']).toBeUndefined();
  expect((await read()).items).toEqual(before);
  await navigate(page, 'Settings');
  await page.getByText('Manual order and temporary references', { exact: true }).evaluate(el => { const details = el.closest('details'); if (details) details.open = true; });
  await page.getByLabel('Manual order and temporary references', { exact: true }).uncheck();
  await expect.poll(async () => (await read()).calendarPreferences.planning?.enabled).toBe(false);
  await navigate(page, 'Calendar'); await swipe(page, 'event'); await expect(page.getByRole('dialog', { name: 'Calendar pin' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reset day order', exact: true })).toHaveCount(0);
});

test('existing due swipe and keyboard pin shortcut coexist', async ({ page }) => {
  await setup(page); await swipe(page, 'task', false);
  const due = page.getByRole('dialog', { name: 'Quick Due' }); await expect(due).toBeVisible(); await due.getByRole('button', { name: 'Cancel', exact: true }).click();
  const item = page.locator('[data-utm-item-id="event"] button').last(); await item.focus(); await item.press('Alt+p');
  const pin = page.getByRole('dialog', { name: 'Calendar pin' }); await expect(pin).toBeVisible();
  await expect(pin.getByRole('button', { name: 'Today', exact: true })).toHaveCount(0);
  await expect(pin.getByRole('button', { name: 'Tomorrow', exact: true })).toBeVisible();
  await pin.getByRole('button', { name: 'Close', exact: true }).click();
});

test('same-time reference expires without touching the source; vertical scroll does not pin', async ({ page }) => {
  const { read } = await setup(page, false), before = (await read()).items;
  const card = page.locator('[data-utm-item-id="event"]').first();
  await card.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: 160, clientY: 300 }] });
  await card.dispatchEvent('touchmove', { touches: [{ identifier: 1, clientX: 162, clientY: 340 }] });
  await card.dispatchEvent('touchend', { changedTouches: [{ identifier: 1, clientX: 280, clientY: 345 }] });
  await expect(page.getByRole('dialog', { name: 'Calendar pin' })).toHaveCount(0);
  await swipe(page, 'event'); const dialog = page.getByRole('dialog', { name: 'Calendar pin' });
  await dialog.getByRole('button', { name: 'Tomorrow', exact: true }).click(); await dialog.getByRole('button', { name: 'Same time', exact: true }).click(); await expect(dialog).toBeHidden();
  await page.locator('.calendar-day-choice').filter({ hasText: 'Sep 25' }).click();
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  const event = page.getByTestId('timeline-event').filter({ hasText: 'B event' });
  await expect(event).toHaveAttribute('aria-label', /10:00–11:00/); await expect(event).toContainText('↗');
  await expect(page.getByRole('button', { name: 'Reorder B event', exact: true })).toHaveCount(0);
  await page.clock.fastForward(40 * 3_600_000 + 1000);
  await expect(event).toHaveCount(0);
  expect((await read()).items).toEqual(before);
});

test('pointer reorder changes only the day order and supports dark mode', async ({ page }) => {
  const { read } = await setup(page), before = (await read()).items;
  const handle = page.getByRole('button', { name: 'Reorder A task', exact: true });
  const target = page.locator('[data-view-item-id="event"]');
  // Keep the drop point away from the fixed quick-add composer. Font metrics on
  // Linux can leave the bottom edge of an otherwise visible card behind it.
  await target.evaluate(element => element.scrollIntoView({ block: 'center' }));
  await expect(handle).toBeInViewport();
  const from = await handle.boundingBox(), to = await target.boundingBox();
  const drop = { x: to!.x + to!.width / 2, y: to!.y + to!.height * 0.65 };
  await expect.poll(() => page.evaluate(point => document.elementFromPoint(point.x, point.y)?.closest('[data-view-item-id]')?.getAttribute('data-view-item-id'), drop)).toBe('event');
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2); await page.mouse.down();
  await page.mouse.move(drop.x, drop.y, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await read()).calendarPreferences.planning?.orders?.['2026-09-24']).toEqual(['event', 'task']);
  expect((await read()).items).toEqual(before);
  await navigate(page, 'Settings');
  const theme = page.locator('select').filter({ has: page.locator('option[value="dark"]') });
  await theme.evaluate(el => { const details = el.closest('details'); if (details) details.open = true; });
  await theme.selectOption('dark'); await navigate(page, 'Calendar');
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await page.getByTestId('timeline-tentative').filter({ hasText: 'A task' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('calendar-order-dark.png') });
  const timelineHandle = page.getByRole('button', { name: 'Reorder A task', exact: true });
  const anchor = page.getByTestId('timeline-event').filter({ hasText: 'B event' });
  await timelineHandle.scrollIntoViewIfNeeded(); const sourceBox = await timelineHandle.boundingBox(), anchorBox = await anchor.boundingBox();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2); await page.mouse.down();
  await page.mouse.move(anchorBox!.x + anchorBox!.width / 2, anchorBox!.y + 4, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await read()).calendarPreferences.planning?.orders?.['2026-09-24']).toEqual(['task', 'event']);
});

test('List moves a fixed event without changing its Timeline interval', async ({ page }) => {
  const { read } = await setup(page), before = (await read()).items;
  const eventHandle = page.getByRole('button', { name: 'Reorder B event', exact: true });
  await eventHandle.press('ArrowUp');
  await expect.poll(async () => (await read()).calendarPreferences.planning?.orders?.['2026-09-24']).toEqual(['event', 'task']);
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reorder B event', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('timeline-event').filter({ hasText: 'B event' })).toBeVisible();
  expect((await read()).items).toEqual(before);
});

test('tomorrow item offers only Today and editor completion closes with Undo', async ({ page }) => {
  const { read } = await setup(page);
  await page.locator('.calendar-day-choice').filter({ hasText: 'Sep 25' }).click();
  await swipe(page, 'blocker');
  const pin = page.getByRole('dialog', { name: 'Calendar pin' });
  await expect(pin.getByRole('button', { name: 'Tomorrow', exact: true })).toHaveCount(0);
  await expect(pin.getByRole('button', { name: 'Today', exact: true })).toBeVisible();
  await pin.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.calendar-day-choice').filter({ hasText: 'Sep 24' }).click();
  await page.locator('[data-view-item-id="task"] .item-title').click();
  const editor = page.getByRole('dialog', { name: 'Item editor', exact: true });
  await editor.getByLabel('Title', { exact: true }).fill('Renamed task');
  await editor.getByRole('button', { name: 'Complete item', exact: true }).click();
  await expect(editor).toBeHidden();
  await expect.poll(async () => (await read()).items.task!.state).toBe('done');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await read()).items.task!.state).toBe('open');
  expect((await read()).items.task!.title).toBe('Renamed task');
});
