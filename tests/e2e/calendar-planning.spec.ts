import { expect, test, type Page } from '@playwright/test';
import * as Automerge from '@automerge/automerge';
import { createWorkspace, createItem, type WorkspaceDocument } from '../../packages/core/dist/index.js';
import { createAutomergeDocument, decryptWithKey, encryptWithKey, randomKey, wrapKey } from '../../packages/sdk/dist/index.js';

const password = 'calendar-planning-fixture';
test.use({ trace: 'retain-on-failure', screenshot: 'only-on-failure' });
const now = new Date('2026-09-24T08:00:00Z');
async function setup(page: Page, conflict = true, customize?: (workspace: WorkspaceDocument) => void, initialPage = 'Calendar') {
  const w = createWorkspace('Planning', now); w.calendarPreferences.timezone = 'UTC';
  w.calendarPreferences.appearance.mode = 'light'; w.calendarPreferences.dayView.filter.source = 'true';
  w.calendarPreferences.dayView.sortSource = 'title asc'; w.calendarPreferences.dayView.sort = [{ expression: 'title', direction: 'asc', nulls: 'last' }];
  w.calendarPreferences.timeline = { mode: 'list', hideSleep: false, showUndated: true };
  const task = createItem('A task', 'task', now); task.id = 'task'; task.schedule = { timezone: 'UTC', estimatedDuration: 'PT30M', dueAt: '2026-09-24T12:00:00Z' };
  const event = createItem('B event', 'event', now); event.id = 'event'; event.schedule = { timezone: 'UTC', startAt: '2026-09-24T10:00:00Z', endAt: '2026-09-24T11:00:00Z', estimatedDuration: 'PT1H', travelBackDuration: 'PT30M' };
  const busy = createItem('C blocker', 'event', now); busy.id = 'blocker'; busy.schedule = { timezone: 'UTC', startAt: '2026-09-25T10:00:00Z', endAt: '2026-09-25T12:00:00Z' };
  w.items = { task, event, blocker: busy };
  if (!conflict) { busy.schedule!.startAt = '2026-09-25T13:00:00Z'; busy.schedule!.endAt = '2026-09-25T14:00:00Z'; }
  customize?.(w);
  const doc = createAutomergeDocument(w), key = await randomKey();
  const metadata = { version: 1, wrappedKey: await wrapKey(key, password), createdAt: now.toISOString() };
  const block = { version: 1, ...await encryptWithKey(Automerge.save(doc), key, 'utm:local:workspace:v1') }; Automerge.free(doc);
  await page.clock.install({ time: now }); await page.goto('/'); await page.getByLabel('Workspace name').waitFor();
  await page.evaluate(async ({ metadata, block }) => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('utm-secure-v1'); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('encrypted-records', 'readwrite'), s = tx.objectStore('encrypted-records'); s.put(metadata, 'metadata'); s.put(block, 'workspace'); s.put(block, 'workspace-export-safe'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
  }, { metadata, block });
  await page.reload(); await unlock(page); await navigate(page, initialPage);
  const read = async () => {
    const block = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('utm-secure-v1'); r.onsuccess = () => resolve(r.result); });
      try { return await new Promise<{ nonce: string; ciphertext: string }>(resolve => { const r = db.transaction('encrypted-records').objectStore('encrypted-records').get('workspace'); r.onsuccess = () => resolve(r.result); }); } finally { db.close(); }
    });
    const doc = Automerge.load<WorkspaceDocument>(await decryptWithKey(block, key, 'utm:local:workspace:v1'));
    const value = Automerge.toJS(doc); Automerge.free(doc); return value;
  };
  if (initialPage === 'Calendar') await expect(page.locator('.calendar-page')).toBeVisible();
  return { read };
}
async function unlock(page: Page) {
  await page.getByLabel('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 30_000 });
}
async function navigate(page: Page, label: string) {
  if ((page.viewportSize()?.width ?? 0) <= 620) { await page.getByRole('button', { name: 'Open navigation' }).click(); await page.locator('.mobile-nav-menu').getByRole('button', { name: label, exact: true }).click(); }
  else await page.locator('.sidebar').getByRole('button', { name: label === 'All items' ? /^All items(?: \d+)?$/ : label, exact: true }).click();
}
async function swipe(page: Page, id: string, right = true) {
  const card = page.locator(`[data-utm-item-id="${id}"]`).first(); await card.scrollIntoViewIfNeeded();
  await card.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: 160, clientY: 300 }] });
  await card.dispatchEvent('touchend', { changedTouches: [{ identifier: 1, clientX: right ? 280 : 40, clientY: 302 }] });
}
async function settledReload(page: Page) {
  await page.clock.fastForward(11_000);
  // Advancing timers is not an IndexedDB write acknowledgement. Await the real
  // writer and startup markers before testing a normal (non-crash) reload.
  await expect.poll(() => page.evaluate(() => ['utm:pending-save:v1', 'utm:startup-last-pending:v1'].map(key => localStorage.getItem(key)))).toEqual([null, null]);
  await page.reload(); await unlock(page); await navigate(page, 'Calendar');
}

test('glass quick navigation shares a bottom row and hides for the keyboard', async ({ page }) => {
  await setup(page);
  const nav = page.getByRole('navigation', { name: 'Quick navigation' });
  const capture = page.locator('.capture-dock .quick-capture');
  await expect(nav.getByRole('button')).toHaveCount(2);
  await expect(nav.getByRole('button', { name: 'Calendar', exact: true })).toHaveAttribute('aria-current', 'page');
  const raised = await capture.boundingBox();
  const navBox = await nav.boundingBox();
  expect(navBox!.x + navBox!.width).toBeLessThanOrEqual(raised!.x);
  expect(Math.abs(navBox!.y + navBox!.height / 2 - raised!.y - raised!.height / 2)).toBeLessThan(12);
  expect(await nav.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  const home = nav.getByRole('button', { name: 'Home', exact: true });
  await home.focus(); await home.press('Enter');
  await expect(home).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('button', { name: 'Calendar', exact: true }).click();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    expect(await home.evaluate(el => getComputedStyle(el).backdropFilter || getComputedStyle(el).getPropertyValue('-webkit-backdrop-filter'))).toBe('blur(12px)');
    await expect.poll(() => home.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(theme === 'light' ? 'rgba(255, 255, 255, 0.34)' : 'rgba(0, 0, 0, 0.34)');
    expect(await home.evaluate(el => getComputedStyle(el).borderColor)).not.toBe('rgba(0, 0, 0, 0)');
  }
  // WebKit emulation has no system keyboard. Exercise the same VisualViewport
  // resize signal the iPhone delivers, without claiming physical-device proof.
  await page.locator('.capture-dock input').focus();
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value: window.innerHeight - 300 });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect(nav).toBeHidden();
  expect((await capture.boundingBox())!.width).toBeGreaterThanOrEqual(raised!.width);
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value: window.innerHeight });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect(nav).toBeVisible();
  // Native WKWebView can resize both layout and visual viewports together,
  // leaving no measurable difference. UIKit's keyboard signal is authoritative.
  await page.evaluate(() => {
    document.documentElement.dataset.nativeKeyboardOpen = 'true';
    window.dispatchEvent(new Event('utm:native-keyboard'));
  });
  await expect(nav).toBeHidden();
  await page.evaluate(() => {
    document.documentElement.dataset.nativeKeyboardOpen = 'false';
    window.dispatchEvent(new Event('utm:native-keyboard'));
  });
  await expect(nav).toBeVisible();
  await expect.poll(async () => (await nav.getByRole('button').first().boundingBox())!.x).toBeLessThan(navBox!.x + 40);
  await page.locator('.capture-dock input').blur();
  await page.screenshot({ path: test.info().outputPath('quick-navigation.png') });
});

test('mobile navigation uses the shared glass surface in both themes', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) > 620, 'Mobile navigation');
  await setup(page);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const menu = page.locator('.mobile-nav-menu');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    await expect(menu).toBeVisible();
    const style = await menu.evaluate(el => ({ blur: getComputedStyle(el).backdropFilter, background: getComputedStyle(el).backgroundColor }));
    expect(style.blur).toBe('blur(6px)');
    expect(style.background).toBe(theme === 'light' ? 'rgba(255, 255, 255, 0.56)' : 'rgba(0, 0, 0, 0.62)');
  }
  await menu.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(menu).toBeHidden();
});

test('a failed menu section preserves workspace, navigation and diagnostics', async ({ page }) => {
  const { read } = await setup(page, true, undefined, 'All items');
  await page.route('**/SettingsPage-*.js', route => route.abort());
  await navigate(page, 'Settings');
  await expect(page.getByRole('heading', { name: 'Could not open this section' })).toBeVisible();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download diagnostics', exact: true })).toBeVisible();
  const records = await page.evaluate(() => JSON.parse(localStorage.getItem('utm:diagnostics:v1') ?? '[]'));
  expect(records.some((entry: { operation: string; page: string; details: string }) => entry.operation === 'Render page' && entry.page === 'settings' && JSON.parse(entry.details).category === 'chunk-load')).toBe(true);
  await navigate(page, 'All items');
  await expect(page.getByRole('heading', { name: 'Could not open this section' })).toHaveCount(0);
  await expect(page.locator('[data-utm-item-id="task"]').first()).toBeVisible();
  expect((await read()).items.task!.title).toBe('A task');
});

test('widget route opens today both while unlocked and after unlock', async ({ page }) => {
  await setup(page);
  await page.locator('.calendar-day-panel [data-date="2026-09-25"]').click();
  await navigate(page, 'All items');
  const requestToday = () => page.evaluate(() => {
    sessionStorage.setItem('utm:open-calendar-today', '1');
    window.dispatchEvent(new Event('utm:open-calendar-today'));
  });
  await requestToday();
  await expect(page.locator('.calendar-day-panel .selected')).toHaveAttribute('data-date', '2026-09-24');
  await page.reload();
  await page.getByLabel('Password', { exact: true }).waitFor();
  await requestToday();
  expect(await page.evaluate(() => sessionStorage.getItem('utm:open-calendar-today'))).toBe('1');
  await unlock(page);
  await expect(page.locator('.calendar-day-panel .selected')).toHaveAttribute('data-date', '2026-09-24');
  expect(await page.evaluate(() => sessionStorage.getItem('utm:open-calendar-today'))).toBeNull();
});

test('calendar period swipes, conditional Today, vertical scrolling and keyboard', async ({ page }) => {
  await setup(page);
  const panel = page.locator('.calendar-day-panel');
  const actions = page.locator('.calendar-period-actions');
  const today = actions.getByRole('button', { name: 'Today', exact: true });
  const selected = () => panel.locator('.selected').getAttribute('data-date');
  const swipePanel = async (direction: -1 | 1) => {
    await panel.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: 180, clientY: 300 }] });
    await panel.dispatchEvent('touchend', { changedTouches: [{ identifier: 1, clientX: direction === 1 ? 60 : 300, clientY: 302 }] });
  };
  await expect(today).toHaveCount(0);
  await swipePanel(1);
  await expect.poll(selected).toBe('2026-10-01');
  await expect(actions.locator('button').first()).toHaveText('Today');
  // A trailing touch click must not select a different day on the new page.
  await panel.locator('[data-date="2026-09-28"]').dispatchEvent('click', { detail: 1 });
  await expect.poll(selected).toBe('2026-10-01');
  await swipePanel(-1);
  await expect.poll(selected).toBe('2026-09-24');
  await expect(today).toHaveCount(0);
  await panel.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: 180, clientY: 300 }] });
  await panel.dispatchEvent('touchmove', { touches: [{ identifier: 1, clientX: 182, clientY: 360 }] });
  await panel.dispatchEvent('touchend', { changedTouches: [{ identifier: 1, clientX: 60, clientY: 302 }] });
  await expect.poll(selected).toBe('2026-09-24');
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await swipePanel(1);
  await expect.poll(selected).toBe('2026-10-24');
  await today.click();
  await expect.poll(selected).toBe('2026-09-24');
  const another = panel.locator('[data-date="2026-09-25"]');
  await another.focus(); await another.press('Enter');
  await expect.poll(selected).toBe('2026-09-25');
  await expect(today).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) test(`calendar header compacts with scroll in ${theme}`, async ({ page }) => {
  await setup(page, false, w => { w.calendarPreferences.appearance.mode = theme; w.calendarPreferences.timeline!.mode = 'timeline'; });
  const root = page.locator('.calendar-page');
  const title = page.locator('.calendar-title');
  const panel = page.locator('.calendar-day-panel');
  const expanded = (await title.boundingBox())!.height + (await panel.boundingBox())!.height;
  await page.evaluate(() => window.scrollTo(0, 650));
  await page.clock.runFor(700);
  await expect(root).toHaveClass(/is-compact/);
  await expect(page.locator('.calendar-date-short')).toBeVisible();
  await expect(page.locator('.calendar-date-full')).toBeHidden();
  await expect.poll(() => page.getByTestId('calendar-header-capacity').evaluate(el => el.getBoundingClientRect().height)).toBe(0);
  expect((await title.boundingBox())!.height + (await panel.boundingBox())!.height).toBeLessThan(expanded);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.clock.runFor(700);
  await expect(root).not.toHaveClass(/is-compact/);
  await expect(page.locator('.calendar-date-full')).toBeVisible();
});

test('overflow is placed automatically before Due without source changes', async ({ page }) => {
  const { read } = await setup(page, true, w => {
    w.items.task!.schedule!.dueAt = '2026-09-24T10:00:00Z';
    w.items.event!.schedule!.startAt = '2026-09-24T08:00:00Z';
    w.items.event!.schedule!.endAt = '2026-09-24T12:00:00Z';
  });
  const before = (await read()).items;
  const googleRequests: string[] = []; page.on('request', req => { if (/googleapis.com\/calendar/.test(req.url())) googleRequests.push(req.url()); });
  await expect(page.getByRole('button', { name: 'Parallel / Queue', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.getByTestId('timeline-tentative').filter({ hasText: 'A task' })).toHaveAttribute('aria-label', /09:30–10:00/);
  await expect(page.locator('.calendar-page')).not.toContainText('No continuous free slot');
  await settledReload(page);
  await expect(page.getByTestId('timeline-tentative').filter({ hasText: 'A task' })).toHaveCount(1);
  expect((await read()).items).toEqual(before); expect(googleRequests).toEqual([]);
});

test('old order is repaired and persisted without mutating active-range originals', async ({ page }) => {
  const { read } = await setup(page, true, w => {
    w.items.task!.schedule = { timezone: 'UTC', startAt: '2026-09-21T00:00:00Z', dueAt: '2026-09-24T10:00:00Z', estimatedDuration: 'PT1H' };
    w.items.other = { ...w.items.task!, id: 'other', title: 'Other active range' };
    w.calendarPreferences.planning = { orders: { '2026-09-24': ['event', 'task', 'other'] } };
  });
  await expect.poll(async () => (await read()).calendarPreferences.planning?.orders?.['2026-09-24']).toEqual(['task', 'other', 'event']);
  const before = (await read()).items;
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.getByTestId('timeline-active-range')).toHaveCount(2);
  await settledReload(page);
  expect((await read()).items).toEqual(before);
  expect((await read()).calendarPreferences.planning?.orders?.['2026-09-24']).toEqual(['task', 'other', 'event']);
});

test('automatic overflow remains visible inside compressed sleep in dark mode', async ({ page }) => {
  const { read } = await setup(page, true, w => {
    w.calendarPreferences.appearance.mode = 'dark';
    w.calendarPreferences.timeline = { mode: 'timeline', hideSleep: true, sleepItemId: 'event', showUndated: true };
    w.items.task!.schedule = { timezone: 'UTC', startAt: '2026-09-23T00:00:00Z', dueAt: '2026-09-24T10:00:00Z', estimatedDuration: 'PT1H' };
    w.items.event!.schedule!.startAt = '2026-09-24T00:00:00Z';
    w.items.event!.schedule!.endAt = '2026-09-24T12:00:00Z';
  });
  const before = (await read()).items;
  const reference = page.getByTestId('timeline-active-range');
  await expect(reference).toHaveCount(1);
  await reference.scrollIntoViewIfNeeded(); await expect(reference).toBeVisible();
  await expect(page.getByRole('button', { name: 'Parallel / Queue', exact: true })).toHaveCount(0);
  expect((await read()).calendarPreferences.timeline?.hideSleep).toBe(true);
  expect((await read()).items).toEqual(before);
});

test('conflicting same-time pin offers parallel without touching sources or Google', async ({ page }) => {
  const { read } = await setup(page), before = (await read()).items;
  const requests: string[] = []; page.on('request', req => { if (/googleapis.com\/calendar/.test(req.url())) requests.push(req.url()); });
  await swipe(page, 'event');
  const dialog = page.getByRole('dialog', { name: 'Calendar pin' });
  await dialog.getByRole('button', { name: 'Tomorrow', exact: true }).click();
  await dialog.getByRole('button', { name: 'Same time', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Queue', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Parallel', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await read()).calendarPreferences.planning?.pins?.event?.mode).toBe('parallel');
  expect((await read()).items).toEqual(before);
  expect(requests).toEqual([]);
});

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
  const openReset = async () => {
    const button = page.getByRole('button', { name: 'Reset day order', exact: true });
    await button.evaluate(element => element.scrollIntoView({ block: 'center' }));
    // A long Timeline ends near the fixed quick-add composer. Verify the actual
    // hit target after sticky navigation and browser scroll anchoring settle.
    await expect.poll(async () => button.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    })).toBe(true);
    await button.click();
    await expect(page.getByRole('dialog', { name: 'Reset calendar order' })).toBeVisible();
  };
  const handle = page.getByRole('button', { name: 'Reorder A task', exact: true });
  await handle.focus(); await handle.press('ArrowDown');
  await expect.poll(async () => (await read()).calendarPreferences.planning?.orders?.['2026-09-24']).toEqual(['event', 'task']);
  await expect(handle).toBeFocused();
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.getByTestId('timeline-tentative').filter({ hasText: 'A task' })).toHaveAttribute('aria-label', /11:30–12:00/);
  await openReset();
  const dialog = page.getByRole('dialog', { name: 'Reset calendar order' });
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click(); await expect(dialog).toContainText('2026-09-24');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await read()).calendarPreferences.planning?.orders?.['2026-09-24']).toEqual(['event', 'task']);
  await openReset(); await dialog.getByRole('button', { name: 'Continue', exact: true }).click(); await dialog.getByRole('button', { name: 'Confirm reset', exact: true }).click();
  await expect.poll(async () => (await read()).calendarPreferences.planning?.orders?.['2026-09-24']).toBeUndefined();
  expect((await read()).items).toEqual(before);
  await navigate(page, 'Settings');
  await page.getByText('Manual order and temporary references', { exact: true }).evaluate(el => { const details = el.closest('details'); if (details) details.open = true; });
  await page.getByLabel('Manual order and temporary references', { exact: true }).uncheck();
  await expect.poll(async () => (await read()).calendarPreferences.planning?.enabled).toBe(false);
  await navigate(page, 'Calendar'); await swipe(page, 'event'); await expect(page.getByRole('dialog', { name: 'Calendar pin' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reset day order', exact: true })).toHaveCount(0);
});

test('glass notifications and calendar pin work before visiting Calendar', async ({ page }) => {
  await setup(page, true, undefined, 'All items');
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  const notices = page.locator('.notification-center');
  await expect(notices).toBeVisible();
  const glass = async (selector: string) => page.locator(selector).evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, blur: style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter') };
  });
  expect((await glass('.notification-center')).blur).toContain('blur(6px)');
  expect((await glass('.notification-center')).background).toBe('rgba(255, 255, 255, 0.56)');
  await page.getByRole('button', { name: 'Close notification center', exact: true }).last().click();
  await swipe(page, 'event');
  const pin = page.getByRole('dialog', { name: 'Calendar pin' });
  await expect(pin).toBeVisible();
  expect((await glass('.calendar-pin-dialog')).blur).toContain('blur(6px)');
  expect((await glass('.calendar-pin-dialog')).background).toBe('rgba(255, 255, 255, 0.56)');
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  expect((await glass('.calendar-pin-dialog')).background).toBe('rgba(0, 0, 0, 0.62)');
  await pin.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(pin).toHaveCount(0);
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
  await handle.evaluate(element => element.scrollIntoView({ block: 'center' }));
  await page.clock.runFor(500);
  await expect(handle).toBeInViewport();
  await page.waitForTimeout(350);
  await page.clock.runFor(100);
  await handle.dragTo(target, {
    targetPosition: { x: 24, y: Math.max(24, (await target.boundingBox())!.height * 0.65) },
  });
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
  // scrollIntoViewIfNeeded considers an element underneath the sticky header
  // visible. Center it and flush the fixture clock before reading drag geometry.
  await timelineHandle.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.clock.runFor(500);
  await page.waitForTimeout(350); // Wait for CSS height/width motion before measuring pointer targets.
  await page.clock.runFor(100);
  const sourceBox = await timelineHandle.boundingBox(), anchorBox = await anchor.boundingBox();
  await expect.poll(() => page.evaluate(point => document.elementFromPoint(point.x, point.y)?.closest('[data-calendar-handle-id]')?.getAttribute('data-calendar-handle-id'), { x: sourceBox!.x + sourceBox!.width / 2, y: sourceBox!.y + sourceBox!.height / 2 })).toBe('task');
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

test('active-range ordering follows List below the event and capacity has only one heading', async ({ page }) => {
  const { read } = await setup(page, true, w => {
    w.items.task!.schedule = { timezone: 'UTC', startAt: '2026-09-23T08:00:00Z', dueAt: '2026-09-25T18:00:00Z', estimatedDuration: 'PT1H' };
  });
  const before = (await read()).items;
  await page.getByRole('button', { name: 'Reorder B event', exact: true }).press('ArrowUp');
  await expect.poll(async () => (await read()).calendarPreferences.planning?.orders?.['2026-09-24']).toEqual(['event', 'task']);
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  const range = page.getByTestId('timeline-active-range');
  await expect(range).toHaveAttribute('aria-label', /11:30–11:50/);
  await expect(range).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('.timeline-planning-summary strong')).toHaveCount(0);
  expect((await read()).items).toEqual(before);
});

test('late anchor can reach the first row even if the remaining task has no free slot', async ({ page }) => {
  const { read } = await setup(page, true, w => {
    w.items.task!.schedule = { timezone: 'UTC', estimatedDuration: 'PT1H' };
    w.items.event!.schedule!.startAt = '2026-09-24T22:00:00Z'; w.items.event!.schedule!.endAt = '2026-09-24T23:15:00Z';
  });
  const before = (await read()).items;
  await page.getByRole('button', { name: 'Reorder B event', exact: true }).press('ArrowUp');
  await expect.poll(async () => (await read()).calendarPreferences.planning?.orders?.['2026-09-24']).toEqual(['event', 'task']);
  await expect(page.locator('[data-view-item-id]').first()).toHaveAttribute('data-view-item-id', 'event');
  await expect(page.locator('.calendar-page')).not.toContainText('No continuous free slot');
  expect((await read()).items).toEqual(before);
});

test('moving an event cannot put an active-range task after its future Due', async ({ page }) => {
  const { read } = await setup(page, true, w => {
    w.items.task!.schedule = { timezone: 'UTC', startAt: '2026-09-23T08:00:00Z', dueAt: '2026-09-24T10:00:00Z', estimatedDuration: 'PT1H' };
  });
  const before = (await read()).items;
  await page.getByRole('button', { name: 'Reorder B event', exact: true }).press('ArrowUp');
  await expect(page.locator('.calendar-page')).toContainText('A task: Placement does not fit before Due.');
  expect((await read()).calendarPreferences.planning?.orders).toBeUndefined();
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
