import { expect, test, type Page } from '@playwright/test';
import * as Automerge from '@automerge/automerge';
import { createWorkspace, createItem } from '../../packages/core/dist/index.js';
import { createAutomergeDocument, encryptWithKey, randomKey, wrapKey } from '../../packages/sdk/dist/index.js';
const password = 'weather-fixture-test-only';
const now = new Date('2026-09-23T12:00:00Z');
async function navigate(page: Page, name: string) {
  if ((page.viewportSize()?.width ?? 0) <= 620) {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.locator('.mobile-nav-menu').getByRole('button', { name, exact: true }).click();
  } else await page.locator('.sidebar').getByRole('button', { name, exact: true }).click();
}
async function setup(page: Page) {
  const w = createWorkspace('Weather', now); w.calendarPreferences.timezone = 'Europe/Berlin'; w.calendarPreferences.language = 'en';
  w.calendarPreferences.appearance.mode = 'light'; w.calendarPreferences.dayView.filter.source = 'true'; w.calendarPreferences.timeline = { mode: 'timeline', hideSleep: false };
  const item = createItem('Weather interaction sentinel', 'task', now); item.schedule = { timezone: 'Europe/Berlin', startAt: '2026-09-23T12:00:00Z', endAt: '2026-09-23T13:00:00Z' }; w.items[item.id] = item;
  const doc = createAutomergeDocument(w), key = await randomKey();
  const metadata = { version: 1, wrappedKey: await wrapKey(key, password), createdAt: now.toISOString() };
  const block = { version: 1, ...await encryptWithKey(Automerge.save(doc), key, 'utm:local:workspace:v1') }; key.fill(0); Automerge.free(doc);
  await page.clock.install({ time: now }); await page.goto(process.env.UTM_TEST_URL ?? '/');
  await page.getByLabel('Workspace name').waitFor();
  await page.evaluate(async ({ metadata, block }) => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('utm-secure-v1'); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('encrypted-records', 'readwrite'), s = tx.objectStore('encrypted-records'); s.put(metadata, 'metadata'); s.put(block, 'workspace'); s.put(block, 'workspace-export-safe'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
  }, { metadata, block });
  await page.reload(); await page.getByLabel('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByPlaceholder('Add new item')).toBeVisible({ timeout: 30_000 });
}
test('weather beta: settings, gradient, haze, keyboard, themes, errors and complete shutdown', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  let forecasts = 0, fail = false; const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('https://api.open-meteo.com/**', route => {
    forecasts++;
    if (fail) return route.fulfill({ status: 503, body: '{}' });
    const times = Array.from({ length: 48 }, (_, i) => (Date.parse('2026-09-22T22:00:00Z') + (i + 1) * 3_600_000) / 1000);
    return route.fulfill({ json: { hourly: { time: times, precipitation_probability: times.map((_, i) => [0, 50, 100, null][i % 4]) } } });
  });
  await page.route('https://geocoding-api.open-meteo.com/**', route => route.fulfill({ json: { results: [{ name: 'Berlin', country: 'Germany', latitude: 52.52, longitude: 13.405 }] } }));
  await setup(page); expect(forecasts).toBe(0);
  await navigate(page, 'Settings'); await page.locator('summary').filter({ hasText: /^Weather$/ }).click();
  const toggle = page.getByRole('checkbox', { name: 'Timeline background: sun and precipitation (beta)', exact: true });
  await expect(toggle).not.toBeChecked(); await toggle.focus(); await page.keyboard.press('Space'); await expect(toggle).toBeChecked();
  await page.getByLabel('City', { exact: true }).fill('Berlin'); await page.getByRole('button', { name: 'Find city', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Selected and saved on this device: Berlin, Germany' })).toBeVisible();
  await expect(page.getByLabel('Latitude')).toHaveValue('52.52');
  await expect(page.getByLabel('Longitude')).toHaveValue('13.405');
  await expect.poll(() => forecasts).toBe(1);
  await navigate(page, 'Calendar');
  await navigate(page, 'Settings');
  await page.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^Weather$/ }) }).evaluate(el => { (el as HTMLDetailsElement).open = true; });
  await expect(page.getByRole('status').filter({ hasText: 'Selected and saved on this device: Berlin, Germany' })).toBeVisible();
  await navigate(page, 'Calendar');
  await expect(page.getByTestId('weather-background')).toBeVisible(); await expect(page.locator('.weather-solar')).toHaveCount(1);
  await expect(page.locator('.weather-solar-marker')).toHaveCount(2); await expect(page.getByTestId('weather-haze').first()).toHaveCSS('opacity', '0.5');
  await expect(page.getByTestId('weather-background')).toHaveCSS('pointer-events', 'none');
  await page.locator('.weather-legend summary').focus(); await page.keyboard.press('Enter'); await expect(page.locator('.weather-legend')).toHaveAttribute('open');
  await expect(page.locator('.weather-legend')).toContainText('Astronomical dawn');
  const marker = page.locator('.weather-solar-marker').first(); await marker.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `/tmp/utm-weather-${testInfo.project.name}-light.png` });
  const event = page.locator('.timeline-event').filter({ hasText: 'Weather interaction sentinel' }); await event.focus(); await expect(event).toBeFocused();
  await event.click(); await expect(page.getByRole('dialog')).toBeVisible(); await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); await marker.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `/tmp/utm-weather-${testInfo.project.name}-dark.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  fail = true; await page.clock.fastForward(3_600_000); await expect.poll(() => forecasts).toBe(2);
  await expect(page.getByTestId('weather-background')).toBeVisible(); await expect(page.getByText('Service error: 503')).toHaveCount(0);
  await navigate(page, 'Settings'); await page.locator('summary').filter({ hasText: /^Weather$/ }).click();
  await expect(page.getByText('Service error: 503')).toBeVisible();
  await toggle.uncheck(); const count = forecasts; await page.clock.fastForward(7_200_000); expect(forecasts).toBe(count);
  await navigate(page, 'Calendar'); await expect(page.getByTestId('weather-background')).toHaveCount(0);
  await page.reload(); await page.getByLabel('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByPlaceholder('Add new item')).toBeVisible({ timeout: 30_000 }); expect(forecasts).toBe(count);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('utm:weather:v1')!))).toMatchObject({ enabled: false, location: { latitude: 52.52, longitude: 13.405 } });
  expect(errors).toEqual([]);
});
