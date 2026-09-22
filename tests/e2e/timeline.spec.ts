import { expect, test, type Page } from '@playwright/test';
import * as Automerge from '@automerge/automerge';
import { createWorkspace, createItem, createOccurrence } from '../../packages/core/dist/index.js';
import { createAutomergeDocument, encryptWithKey, randomKey, wrapKey } from '../../packages/sdk/dist/index.js';

const password = 'timeline-fixture-test-only';
const now = new Date('2026-09-22T12:00:00Z');
async function setup(page: Page) {
  const w = createWorkspace('Timeline', now); w.calendarPreferences.timezone = 'UTC';
  w.calendarPreferences.appearance.mode = 'light'; w.calendarPreferences.dayView.filter.source = 'true';
  w.calendarPreferences.timeline = { mode: 'timeline', hideSleep: false };
  for (let i = 0; i < 6; i++) {
    const item = createItem(`Overlap ${i}`, 'task', now);
    item.schedule = { timezone: 'UTC', startAt: '2026-09-22T12:00:00Z', endAt: '2026-09-22T13:00:00Z' }; w.items[item.id] = item;
  }
  const short = createItem('One minute title', 'task', now); short.schedule = { timezone: 'UTC', startAt: '2026-09-22T17:00:00Z', endAt: '2026-09-22T17:01:00Z', travelDuration: 'PT30M' }; w.items[short.id] = short;
  const sleep = createItem('Sleep source', 'task', now); sleep.schedule = { timezone: 'UTC', startAt: '2026-09-22T00:00:00Z', endAt: '2026-09-22T07:00:00Z' }; w.items[sleep.id] = sleep;
  const none = createItem('Undated sentinel', 'task', now); w.items[none.id] = none;
  const proposed = createItem('Tentative task', 'task', now); proposed.schedule = { timezone: 'UTC', estimatedDuration: 'PT2H' }; w.items[proposed.id] = proposed;
  const allDay = createItem('All day sentinel', 'event', now); allDay.schedule = { timezone: 'UTC', startAt: '2026-09-22T00:00:00Z', endAt: '2026-09-23T00:00:00Z', allDay: true }; w.items[allDay.id] = allDay;
  const series = createItem('Active preparation', 'task', now); series.role = 'series_template'; series.canBeCompleted = true;
  series.schedule = { timezone: 'UTC', startAt: '2026-09-21T09:00:00Z', dueAt: '2026-09-24T19:00:00Z', estimatedDuration: 'PT1H' };
  series.recurrence = { rrule: 'FREQ=WEEKLY', timezone: 'UTC', rdates: [], exdates: [], activationOffset: 'PT0M', closeAt: 'due', anchor: 'schedule', autoRenew: true };
  const nested = createOccurrence(series, new Date(series.schedule.startAt!), 0); nested.role = 'series_template'; nested.recurrence = structuredClone(series.recurrence);
  const child = createOccurrence(nested, new Date(series.schedule.startAt!), 0);
  for (const item of [series, nested, child]) w.items[item.id] = item;
  const doc = createAutomergeDocument(w), key = await randomKey();
  const metadata = { version: 1, wrappedKey: await wrapKey(key, password), createdAt: now.toISOString() };
  const block = { version: 1, ...await encryptWithKey(Automerge.save(doc), key, 'utm:local:workspace:v1') }; key.fill(0); Automerge.free(doc);
  await page.clock.install({ time: now });
  await page.goto(process.env.UTM_TEST_URL ?? '/');
  await page.getByLabel('Workspace name').waitFor();
  await page.evaluate(async ({ metadata, block }) => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('utm-secure-v1'); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('encrypted-records', 'readwrite'), s = tx.objectStore('encrypted-records'); s.put(metadata, 'metadata'); s.put(block, 'workspace'); s.put(block, 'workspace-export-safe'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
  }, { metadata, block });
  await page.reload(); await page.getByLabel('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByPlaceholder('Add new item')).toBeVisible({ timeout: 30_000 });
  if ((page.viewportSize()?.width ?? 0) <= 620) { await page.getByRole('button', { name: 'Open navigation' }).click(); await page.locator('.mobile-nav-menu').getByRole('button', { name: 'Calendar', exact: true }).click(); }
  else await page.locator('.sidebar').getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(page.locator('.calendar-timeline')).toBeVisible();
}

async function primary(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('utm-secure-v1'); r.onsuccess = () => resolve(r.result); });
    try { return await new Promise<string>(resolve => { const r = db.transaction('encrypted-records').objectStore('encrypted-records').get('workspace'); r.onsuccess = () => resolve(JSON.stringify(r.result)); }); } finally { db.close(); }
  });
}

test('timeline titles, More, clock, sleep, dark mode and persisted display choice', async ({ page }, testInfo) => {
  test.setTimeout(180_000); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await setup(page);
  const allDayGroup = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^All day/ }) });
  await allDayGroup.locator('summary').click(); await expect(allDayGroup.locator('.item-card')).toBeHidden();
  await allDayGroup.locator('summary').click();
  await expect(allDayGroup.locator('.item-card')).toBeVisible();
  const active = page.locator('.timeline-top-items').filter({ has: page.getByRole('heading', { name: 'Active range', exact: true }) });
  await expect(active.locator('.item-card')).toHaveCount(1);
  await expect(active.locator('.item-title')).toHaveText('Active preparation');
  await active.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `/tmp/utm-timeline-top-${testInfo.project.name}-light.png` });
  const tentative = page.getByTestId('timeline-tentative');
  await expect(tentative).toHaveCount(0);
  await page.getByText('Timeline settings', { exact: true }).click();
  const showUndated = page.getByRole('checkbox', { name: 'Show items without a date, time or Due' });
  await expect(showUndated).not.toBeChecked();
  await showUndated.check();
  await page.getByText('Timeline settings', { exact: true }).click();
  await expect(page.getByTestId('save-status')).toHaveCount(0, { timeout: 30_000 });
  const saved = await primary(page);
  await expect(tentative).toHaveCount(1);
  await expect(tentative).toHaveCSS('border-top-style', 'dotted');
  await expect(tentative).toHaveAttribute('aria-label', 'Tentative · Tentative task · 13:00–15:00');
  await expect(page.getByTestId('timeline-planning-summary')).toContainText('After tasks');
  await tentative.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `/tmp/utm-tentative-${testInfo.project.name}-light.png` });
  await tentative.focus();
  await expect(tentative).toBeFocused();
  const minute = page.locator('.timeline-events').getByRole('button', { name: /^One minute title/ }); await minute.scrollIntoViewIfNeeded();
  expect((await minute.boundingBox())!.height).toBeGreaterThanOrEqual(36);
  await expect(minute.locator('strong')).toHaveText('One minute title');
  await expect(page.getByTestId('timeline-travel')).toHaveCSS('border-top-style', 'dashed');
  await expect(page.getByTestId('timeline-travel')).toContainText('30 min');
  await expect(minute).toHaveCSS('border-top-style', 'solid');
  const more = page.getByRole('button', { name: /^More ·/ }).first(); await more.click();
  const dialog = page.getByRole('dialog', { name: 'Timeline overlapping items' }); await expect(dialog).toBeVisible();
  expect(await dialog.getByRole('button', { name: /^Overlap/ }).count()).toBe((page.viewportSize()?.width ?? 0) <= 620 ? 5 : 3);
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  if ((page.viewportSize()?.width ?? 0) > 620) await expect(more).toBeFocused();
  const line = page.getByTestId('timeline-now'); const top = await line.evaluate(el => (el as HTMLElement).style.top);
  await page.screenshot({ path: `/tmp/utm-timeline-${testInfo.project.name}-light.png` });
  await page.clock.fastForward(60_000); await expect.poll(() => line.evaluate(el => (el as HTMLElement).style.top)).not.toBe(top);
  expect(await primary(page)).toBe(saved);
  await page.getByText('Timeline settings', { exact: true }).click();
  await page.getByText('Choose another item…', { exact: true }).click();
  await page.getByRole('button', { name: 'Sleep source', exact: true }).click();
  await expect(page.locator('.timeline-break')).toContainText('00:00–07:00');
  await page.getByRole('button', { name: 'Show full day', exact: true }).click(); await expect(page.locator('.timeline-break')).toHaveCount(0);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await tentative.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `/tmp/utm-tentative-${testInfo.project.name}-dark.png` });
  await minute.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `/tmp/utm-timeline-${testInfo.project.name}-dark.png` });
  await expect(page.getByTestId('timeline-now')).toHaveCSS('pointer-events', 'none');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await active.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `/tmp/utm-timeline-top-${testInfo.project.name}-dark.png` });
  await active.getByRole('button', { name: 'Complete item', exact: true }).click();
  await expect(active).toHaveCount(0);
  await page.getByRole('button', { name: 'List', exact: true }).click(); await expect(page.locator('.calendar-timeline')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.calendar-all-day > summary').click();
  await expect(page.locator('.calendar-all-day').getByText('All day sentinel', { exact: true })).toBeHidden();
  await expect(page.getByTestId('save-status')).toHaveCount(0, { timeout: 30_000 });
  const lock = page.locator('.sidebar .sidebar-bottom button').filter({ hasText: 'Lock' }); await lock.evaluate((el: HTMLButtonElement) => el.click());
  await expect(page.getByRole('heading', { name: 'Unlock your workspace' })).toBeVisible(); await page.reload();
  await page.getByLabel('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByPlaceholder('Add new item')).toBeVisible({ timeout: 30_000 });
  if ((page.viewportSize()?.width ?? 0) <= 620) { await page.getByRole('button', { name: 'Open navigation' }).click(); await page.locator('.mobile-nav-menu').getByRole('button', { name: 'Calendar', exact: true }).click(); }
  else await page.locator('.sidebar').getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-pressed', 'true'); expect(errors).toEqual([]);
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await page.getByText('Timeline settings', { exact: true }).click();
  await expect(showUndated).toBeChecked();
  await showUndated.uncheck();
  await expect(tentative).toHaveCount(0);
});
