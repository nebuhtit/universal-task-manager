import { expect, test, type Page, type Locator } from '@playwright/test';
import { currentTimeline } from './calendar-locators';
import * as Automerge from '@automerge/automerge';
import { createWorkspace, createItem, ensureAreaDefinition, type WorkspaceDocument } from '../../packages/core/dist/index.js';
import { createAutomergeDocument, decryptWithKey, encryptWithKey, randomKey, wrapKey } from '../../packages/sdk/dist/index.js';

const password = 'calendar-planning-fixture';
test.use({ trace: 'retain-on-failure', screenshot: 'only-on-failure' });
const now = new Date('2026-09-24T08:00:00Z');
async function setup(page: Page, conflict = true, customize?: (workspace: WorkspaceDocument) => void, initialPage = 'Calendar', keepCollapsed = false) {
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
  if (initialPage === 'Calendar') {
    await expect(page.locator('.calendar-page')).toBeVisible();
    if (!keepCollapsed) { await page.evaluate(() => window.scrollTo(0, 0)); await page.clock.runFor(400); }
  }
  return { read };
}
async function unlock(page: Page) {
  await page.getByLabel('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 30_000 });
}
async function navigate(page: Page, label: string) {
  if (label === 'Home' || label === 'Calendar') { await page.getByRole('navigation', { name: 'Quick navigation' }).getByRole('button', { name: label, exact: true }).click(); return; }
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

function liveTextSelectionsFixture(workspace: WorkspaceDocument) {
  const work = createItem('Work', 'event', now); work.id = 'work';
  work.schedule = { timezone: 'UTC', startAt: '2026-09-24T09:00:00Z', endAt: '2026-09-24T16:00:00Z' };
  const ordinary = createItem('A Work reference', 'task', now); ordinary.id = 'ordinary';
  workspace.items.work = work; workspace.items.ordinary = ordinary;
  workspace.calendarPreferences.dayView.statistics = { showTime: true, reservedItemIds: ['work'] };
  workspace.calendarPreferences.dayView.filter.source = 'id != "work"';
  workspace.calendarPreferences.googleCalendar = { connectionId: 'fixture', syncTokens: {}, defaultCalendarId: 'personal', calendars: [
    { id: 'personal', name: 'Personal', selected: true, accessRole: 'owner' },
    { id: 'work-calendar', name: 'Work calendar', selected: true, accessRole: 'writer' },
    { id: 'other-calendar', name: 'Other calendar', selected: true, accessRole: 'owner' },
    { id: 'reader', name: 'Work read only', selected: true, accessRole: 'reader' },
  ] };
  ensureAreaDefinition(workspace, 'Work');
}

async function activateLiveTextControl(control: Locator, touch: boolean) {
  await control.page().evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await control.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await control.page().clock.runFor(400);
  if (touch) await control.tap(); else await control.click();
}

test('Live Text calendar and preferred rr blocks work in capture, item title and source editor', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const { read } = await setup(page, false, liveTextSelectionsFixture, 'Home');
  const dock = page.locator('.capture-dock .live-text-input');
  const capture = dock.getByRole('combobox');
  const choose = async (root: ReturnType<Page['locator']>, id: string) => {
    const option = root.getByRole('option').filter({ hasText: new RegExp(`Google Calendar · ${id}$`) });
    await expect(option).toBeVisible();
    if (testInfo.project.use.hasTouch) await option.tap(); else await option.click();
  };
  for (const command of ['rr', 'рр']) {
    await capture.fill(`Selected task ${command}`);
    await expect(dock.getByRole('option').last().locator('strong')).toHaveText('Work');
  }
  await capture.fill('Selected task рр W');
  await capture.press('ArrowDown'); await capture.press('Space');
  await expect(dock.getByRole('button', { name: 'Убрать связь: Work' })).toBeVisible();
  await expect(capture).toBeFocused();
  await capture.fill('Selected task cc W');
  await expect(dock.getByRole('option')).toHaveCount(1);
  await choose(dock, 'work-calendar');
  await expect(capture).not.toHaveValue(/calendar:|work-calendar/);
  await expect(dock.getByRole('button', { name: 'Remove calendar: Work calendar' })).toBeVisible();
  await capture.press('Enter');
  const editor = page.getByRole('dialog', { name: 'Item editor' });
  const title = editor.getByRole('combobox', { name: 'Title', exact: true });
  await expect(editor.getByLabel('Can be completed', { exact: true })).toBeChecked();
  await expect(editor.getByRole('button', { name: 'Remove calendar: Work calendar' })).toBeVisible();
  await title.fill('Selected task кк O');
  await choose(editor, 'other-calendar');
  await editor.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => Object.values((await read()).items).find(item => item.title === 'Selected task')?.extensions?.['utm:quickEntryCalendar']).toEqual({ id: 'other-calendar', name: 'Other calendar' });
  await navigate(page, 'All items');
  await page.locator('.all-sections .item-main').getByText('Selected task', { exact: true }).first().click();
  await editor.getByRole('button', { name: 'Quick entry', exact: true }).click();
  const source = editor.getByRole('combobox', { name: 'Строка быстрого ввода', exact: true });
  await source.fill('Selected task cc W');
  await choose(editor, 'work-calendar');
  await activateLiveTextControl(editor.getByRole('button', { name: 'Apply line', exact: true }), Boolean(testInfo.project.use.hasTouch));
  await expect(editor.getByRole('button', { name: 'Apply line', exact: true })).toHaveCount(0);
  await expect(editor.getByRole('button', { name: 'Remove calendar: Work calendar' })).toBeVisible();
  await editor.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => {
    const item = Object.values((await read()).items).find(item => item.title === 'Selected task');
    return { calendar: item?.extensions?.['utm:quickEntryCalendar'], targets: item?.relations.map(relation => relation.targetId), end: item?.schedule?.endAt };
  }).toEqual({ calendar: { id: 'work-calendar', name: 'Work calendar' }, targets: ['work'], end: undefined });
  await settledReload(page);
  await navigate(page, 'All items');
  await page.locator('.all-sections .item-main').getByText('Selected task', { exact: true }).first().click();
  await expect(editor.getByRole('button', { name: 'Remove calendar: Work calendar' })).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Убрать связь: Work' })).toBeVisible();
});

test('Live Text calendar selection reaches the Google picker and scoped PARA capture', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const { read } = await setup(page, false, liveTextSelectionsFixture, 'Home');
  const choose = async (root: ReturnType<Page['locator']>, id: string) => {
    const option = root.getByRole('option').filter({ hasText: new RegExp(`Google Calendar · ${id}$`) });
    await expect(option).toBeVisible();
    if (testInfo.project.use.hasTouch) await option.tap(); else await option.click();
  };
  const capture = page.locator('.capture-dock').getByRole('combobox');
  await capture.fill('Selected meeting tomorrow 15:00 duration 1h кк W');
  await choose(page.locator('.capture-dock'), 'work-calendar');
  await capture.press('Enter');
  const editor = page.getByRole('dialog', { name: 'Item editor' });
  const details = editor.locator('[data-editor-section="calendar-details"]');
  if (!(await details.evaluate((element: HTMLDetailsElement) => element.open))) await activateLiveTextControl(details.locator(':scope > summary'), Boolean(testInfo.project.use.hasTouch));
  await expect(details).toHaveAttribute('open', '');
  const picker = editor.getByRole('combobox', { name: 'Google Calendar', exact: true });
  await expect(picker).toHaveValue('work-calendar');
  await picker.selectOption('other-calendar');
  await expect(editor.getByRole('button', { name: 'Remove calendar: Other calendar' })).toBeVisible();
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await navigate(page, 'PARA');
  await page.locator('.organization-area-groups .organization-entity-link').getByText('Work', { exact: true }).first().click();
  const scoped = page.locator('.view-quick-add').first();
  const input = scoped.getByRole('combobox');
  await input.fill('Scoped task rr');
  await expect(scoped.getByRole('option').last().locator('strong')).toHaveText('Work');
  await input.press('ArrowDown'); await input.press('Space');
  await input.fill('Scoped task cc W');
  await choose(scoped, 'work-calendar');
  await input.press('Enter');
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Remove calendar: Work calendar' })).toBeVisible();
  await editor.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => {
    const item = Object.values((await read()).items).find(item => item.title === 'Scoped task');
    return { calendar: item?.extensions?.['utm:quickEntryCalendar'], areas: item?.areas, targets: item?.relations.map(relation => relation.targetId) };
  }).toEqual({ calendar: { id: 'work-calendar', name: 'Work calendar' }, areas: ['Work'], targets: ['work'] });
});

test('Home View dragging requires all collapsed or more than ten and shows a moving preview', async ({ page }, testInfo) => {
  await page.addInitScript(() => { for (let index = 0; index < 10; index++) localStorage.setItem(`utm-ui:view:reorder-${index}`, '0'); });
  await setup(page, false, workspace => {
    workspace.views = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`reorder-${index}`, {
      id: `reorder-${index}`, name: `View ${index}`, renderer: 'list' as const, query: { source: 'false' }, fields: ['title'], sort: [],
    }]));
    workspace.viewOrder = Object.keys(workspace.views);
  }, 'Home');
  const titles = page.locator('.views-stack .view-section-title');
  await expect(titles).toHaveCount(12);
  await expect(page.locator('.views-stack .is-reorder-surface')).toHaveCount(0);
  await titles.nth(10).click();
  await expect(page.locator('.views-stack .is-reorder-surface')).toHaveCount(11);
  await titles.first().scrollIntoViewIfNeeded();
  const source = await titles.first().boundingBox(), target = await titles.nth(1).boundingBox();
  const x = source!.x + source!.width / 2, y = source!.y + source!.height / 2;
  const endY = target!.y + target!.height - 2;
  const touch = Boolean(testInfo.project.use.hasTouch);
  if (touch) await titles.first().dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y });
  else { await page.mouse.move(x, y); await page.mouse.down(); }
  await page.clock.fastForward(400);
  await expect(page.locator('.ui-reorder-preview')).toBeVisible();
  if (touch) await page.evaluate(({ x, y }) => window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, cancelable: true })), { x, y: endY });
  else await page.mouse.move(x, endY);
  await expect(page.locator('.ui-reorder-preview')).toHaveCSS('transform', /matrix/);
  await expect(page.locator('[data-reorder-drop="after"]')).toHaveCount(1);
  if (touch) await page.evaluate(({ x, y }) => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y })), { x, y: endY });
  else await page.mouse.up();
  await expect(page.locator('.ui-reorder-preview')).toHaveCount(0);
  await expect(titles.first()).toContainText('View 1');
  await expect(titles.nth(1)).toHaveAttribute('aria-expanded', 'false');
  // The smaller-list all-collapsed branch is covered independently in unit tests.
});

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

test('quick navigation keeps capture-sized circles in the same position on every page', async ({ page }) => {
  test.setTimeout(90_000);
  await setup(page, false, workspace => {
    for (let index = 0; index < 12; index++) ensureAreaDefinition(workspace, `Area ${index}`);
  }, 'Home');
  const nav = page.getByRole('navigation', { name: 'Quick navigation' });
  const home = nav.getByRole('button', { name: 'Home', exact: true });
  const calendar = nav.getByRole('button', { name: 'Calendar', exact: true });
  const capture = page.locator('.capture-dock .quick-capture');
  const expectParaActionsClear = async () => {
    const actions = page.locator('.capture-dock-actions .organization-order-actions');
    await expect(actions).toBeVisible();
    const box = (await actions.boundingBox())!;
    const navBox = (await nav.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(navBox.x + navBox.width);
    expect(Math.abs(box.y + box.height / 2 - navBox.y - navBox.height / 2)).toBeLessThan(1);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  };
  for (const theme of ['light', 'dark'] as const) {
    await navigate(page, 'Home');
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await page.clock.runFor(400);
    const inputBox = (await capture.boundingBox())!;
    const reference = (await home.boundingBox())!;
    expect(Math.abs(reference.height - inputBox.height)).toBeLessThan(1);
    expect(Math.abs(reference.width - reference.height)).toBeLessThan(1);
    expect(Math.abs(reference.y - inputBox.y)).toBeLessThan(1);
    for (const target of ['Home', 'Calendar', 'PARA', 'Settings']) {
      await navigate(page, target);
      await page.clock.runFor(400);
      for (const [index, button] of [home, calendar].entries()) {
        const box = (await button.boundingBox())!;
        expect(Math.abs(box.y - reference.y)).toBeLessThan(1);
        expect(Math.abs(box.width - inputBox.height)).toBeLessThan(1);
        expect(Math.abs(box.height - inputBox.height)).toBeLessThan(1);
        if (index === 0) expect(Math.abs(box.x - reference.x)).toBeLessThan(1);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      }
      if (target === 'PARA' || target === 'Settings') await expect(capture).toHaveCount(0);
      if (target === 'PARA') await expectParaActionsClear();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.clock.runFor(400);
      expect(Math.abs((await home.boundingBox())!.y - reference.y)).toBeLessThan(1);
      if (target === 'PARA') {
        const actions = page.locator('.organization-order-actions');
        await actions.scrollIntoViewIfNeeded(); await page.clock.runFor(400);
        await expectParaActionsClear();
      }
      await page.screenshot({ path: test.info().outputPath(`dock-${target.toLowerCase()}-${theme}.png`) });
    }
  }
  if ((page.viewportSize()?.width ?? 0) <= 620) {
    await page.setViewportSize({ width: 320, height: 664 });
    await navigate(page, 'Home'); await page.clock.runFor(400);
    expect((await capture.boundingBox())!.x + (await capture.boundingBox())!.width).toBeLessThanOrEqual(320);
    await navigate(page, 'PARA'); await page.clock.runFor(400);
    await expectParaActionsClear();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await navigate(page, 'PARA');
  const handle = page.getByRole('button', { name: 'Reorder Area Area 0', exact: true });
  const save = page.getByRole('button', { name: 'Apply / Save order', exact: true });
  await handle.focus(); await handle.press('ArrowDown');
  await expect(save).toBeEnabled();
  const reset = page.getByRole('button', { name: 'Reset order', exact: true });
  if (test.info().project.use.hasTouch) await reset.tap(); else await reset.click();
  await expect(save).toBeDisabled();
  await handle.focus(); await handle.press('ArrowDown');
  if (test.info().project.use.hasTouch) await save.tap(); else await save.click();
  await expect(save).toBeDisabled();
  await expectParaActionsClear();
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
  await menu.getByRole('button', { name: /^All items(?: \d+)?$/ }).click();
  await expect(menu).toHaveAttribute('aria-hidden', 'true');
});

test.describe('isolated chunk failure', () => {
 test.use({ serviceWorkers: 'block' });
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

for (const theme of ['light', 'dark'] as const) test(`calendar swipe motion follows the finger and respects reduced motion in ${theme}`, async ({ page }, testInfo) => {
  const { read } = await setup(page, true, workspace => {
    workspace.calendarPreferences.appearance.mode = theme;
    workspace.calendarPreferences.timeline = { mode: 'timeline', hideSleep: false };
  });
  const before = await read();
  // Pause only our new animations: inspect real compositor keyframes at a
  // deterministic midpoint, without racing a 200ms animation across tool calls.
  await page.evaluate(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args);
      if (this.matches('.calendar-period-swipe-track, .calendar-day-swipe-content')) animation.pause();
      return animation;
    };
  });
  const panel = page.locator('.calendar-day-panel');
  const period = page.locator('.calendar-period-swipe-track');
  const day = page.locator('.calendar-day-swipe-content');
  const axis = page.locator('[data-calendar-slide="current"] .timeline-axis');
  await expect(period.locator(':scope > [data-calendar-slide]')).toHaveCount(3);
  await expect(day.locator(':scope > [data-calendar-slide]')).toHaveCount(3);
  const selected = () => panel.locator('.selected').getAttribute('data-date');
  const touch = (target: Locator, kind: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel', x: number, y = 300) => target.dispatchEvent(kind, {
    touches: kind === 'touchend' || kind === 'touchcancel' ? [] : [{ identifier: 1, clientX: x, clientY: y }],
    changedTouches: [{ identifier: 1, clientX: x, clientY: y }],
  });
  const finish = async (target: Locator) => {
    await target.evaluate(node => node.getAnimations().forEach(animation => animation.finish()));
    await expect(target).not.toHaveAttribute('data-swipe-motion');
    await expect(target).toHaveCSS('transform', 'none');
  };
  const inspectEntry = async (target: Locator, direction: -1 | 1) => {
    await expect(target).toHaveAttribute('data-swipe-motion', 'entering');
    const startX = await target.evaluate(node => {
      const animation = node.getAnimations()[0]!;
      const effect = animation.effect as KeyframeEffect;
      const first = effect.getKeyframes()[0]!;
      animation.currentTime = Number(effect.getTiming().duration) / 2;
      return new DOMMatrix(String(first.transform)).m41;
    });
    expect(startX * direction).toBeGreaterThan(0);
    const midpoint = await target.evaluate(node => ({ x: new DOMMatrix(getComputedStyle(node).transform).m41, opacity: Number(getComputedStyle(node).opacity) }));
    expect(midpoint.x * direction).toBeGreaterThan(0);
    expect(midpoint.opacity).toBeGreaterThan(0.65);
    expect(midpoint.opacity).toBe(1);
  };
  await touch(panel, 'touchstart', 180);
  await touch(panel, 'touchmove', 100);
  await page.clock.runFor(32);
  await expect(period).toHaveAttribute('data-swipe-motion', 'dragging');
  expect(await period.evaluate(node => new DOMMatrix(getComputedStyle(node).transform).m41)).toBeLessThan(0);
  const visibleNext = await period.evaluate(node => {
    const next = node.querySelector('[data-calendar-slide="next"]')!.getBoundingClientRect();
    const viewport = node.parentElement!.getBoundingClientRect();
    return next.left < viewport.right && next.right > viewport.left;
  });
  expect(visibleNext).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`swipe-neighbour-week-${theme}.png`) });
  await expect.poll(selected).toBe('2026-09-24');
  await touch(panel, 'touchend', 60);
  await expect.poll(selected).toBe('2026-10-01');
  await inspectEntry(period, 1); await finish(period);
  await expect(period.locator(':scope > [data-calendar-slide]')).toHaveCount(3);
  await touch(panel, 'touchstart', 120); await touch(panel, 'touchend', 290);
  await inspectEntry(period, -1); await finish(period);
  await expect.poll(selected).toBe('2026-09-24');
  await expect(day.locator(':scope > [data-calendar-slide]')).toHaveCount(3);
  const promoted = await day.locator(':scope > [data-calendar-slide="previous"]').elementHandle();
  await touch(axis, 'touchstart', 120); await touch(axis, 'touchmove', 220);
  await page.clock.runFor(32);
  await expect(day).toHaveAttribute('data-swipe-motion', 'dragging');
  await touch(axis, 'touchend', 290);
  await expect.poll(selected).toBe('2026-09-23');
  expect(await promoted!.getAttribute('data-calendar-slide')).toBe('current');
  await inspectEntry(day, -1);
  await page.screenshot({ path: testInfo.outputPath(`swipe-midpoint-${theme}.png`) });
  await finish(day);
  // Vertical scrolling wins permanently, even if the finger later moves sideways.
  await touch(axis, 'touchstart', 180); await touch(axis, 'touchmove', 182, 360); await touch(axis, 'touchend', 60);
  await expect.poll(selected).toBe('2026-09-23');
  await touch(panel, 'touchstart', 180); await touch(panel, 'touchmove', 160); await page.clock.runFor(32);
  await touch(panel, 'touchcancel', 160); await expect(period).toHaveAttribute('data-swipe-motion', 'settling'); await finish(period);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await touch(axis, 'touchstart', 180); await touch(axis, 'touchmove', 100); await page.clock.runFor(32);
  await expect(day).not.toHaveAttribute('data-swipe-motion');
  await touch(axis, 'touchend', 60);
  await expect.poll(selected).toBe('2026-09-24');
  await expect(day).not.toHaveAttribute('data-swipe-motion');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await read()).items).toEqual(before.items);
});

test.describe('worker responsiveness', () => {
test.use({ serviceWorkers: 'block' }); // Let routing instrument the actual Worker, not SW precache.
test('calendar gestures remain responsive while the slide worker is busy', async ({ page }) => {
  // Deliberately stall ONLY the read-only preload worker, not the UI, reminder
  // or widget workers. Check a real main-thread gesture before its reply.
  await page.route(/calendarSlides\.worker-.*\.js$/, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `self.addEventListener('message', event => {
      if (event.data.kind === 'prepare' && event.data.probeSlow) {
        self.postMessage({ probe: 'busy' });
        const until = performance.now() + 1500; while (performance.now() < until) {}
      }
    });\n${await response.text()}` });
  });
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    (window as any).__slideProbe = { busy: false, replies: 0, armed: false };
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (String(url).includes('calendarSlides.worker-')) {
          const send = this.postMessage.bind(this);
          this.postMessage = (message: any, options?: any) => send({ ...message, probeSlow: (window as any).__slideProbe.armed }, options ?? []);
          this.addEventListener('message', event => {
          const probe = (window as any).__slideProbe;
          if (event.data.probe === 'busy') probe.busy = true;
          else if (event.data.ok !== undefined) { probe.busy = false; probe.replies++; }
          });
        }
      }
    };
  });
  await setup(page, true, workspace => { workspace.calendarPreferences.timeline = { mode: 'timeline', hideSleep: false }; });
  await expect(page.locator('.calendar-period-swipe-track > [data-calendar-slide]')).toHaveCount(3);
  await page.evaluate(() => { (window as any).__slideProbe.armed = true; });
  await page.getByRole('button', { name: 'Next period', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__slideProbe.busy)).toBe(true);
  const panel = page.locator('.calendar-day-panel'), track = page.locator('.calendar-period-swipe-track');
  const replies = await page.evaluate(() => (window as any).__slideProbe.replies);
  await panel.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: 180, clientY: 300 }] });
  await panel.dispatchEvent('touchmove', { touches: [{ identifier: 1, clientX: 100, clientY: 300 }] });
  await page.clock.runFor(32);
  expect(await track.evaluate(node => new DOMMatrix(getComputedStyle(node).transform).m41)).toBeLessThan(0);
  expect(await page.evaluate(() => (window as any).__slideProbe)).toEqual({ busy: true, replies, armed: true });
  await panel.dispatchEvent('touchcancel', { changedTouches: [{ identifier: 1, clientX: 100, clientY: 300 }] });
  await expect(page.locator('.calendar-day-panel .selected')).toHaveAttribute('data-date', '2026-10-01');
});
});

test('prepared neighbours are inert and refresh after an item edit', async ({ page }) => {
  await setup(page, true, workspace => { workspace.calendarPreferences.timeline = { mode: 'timeline', hideSleep: false }; });
  const track = page.locator('.calendar-day-swipe-content');
  const next = track.locator(':scope > [data-calendar-slide="next"]');
  await expect(next).toHaveAttribute('data-slide-key', '2026-09-25');
  await expect(next).toHaveAttribute('inert', '');
  await expect(next).toHaveAttribute('aria-hidden', 'true');
  await expect(next.getByTestId('timeline-event').filter({ hasText: 'C blocker' })).toHaveCount(1);
  await next.getByTestId('timeline-event').filter({ hasText: 'C blocker' }).evaluate(element => (element as HTMLElement).click());
  await expect(page.getByRole('dialog', { name: 'Item editor' })).toHaveCount(0);
  const swipeDay = async (direction: -1 | 1) => {
    const axis = currentTimeline(page).locator('.timeline-axis');
    await axis.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: 180, clientY: 400 }] });
    await axis.dispatchEvent('touchend', { changedTouches: [{ identifier: 1, clientX: direction === 1 ? 60 : 300, clientY: 400 }] });
    await track.evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
  };
  await swipeDay(1);
  await expect(page.locator('.calendar-day-panel .selected')).toHaveAttribute('data-date', '2026-09-25');
  const event = currentTimeline(page).getByTestId('timeline-event').filter({ hasText: 'C blocker' });
  await event.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' })); await page.clock.runFor(600);
  await event.click();
  const editor = page.getByRole('dialog', { name: 'Item editor', exact: true });
  await editor.getByRole('combobox', { name: 'Title', exact: true }).fill('Fresh adjacent title');
  await editor.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await swipeDay(-1);
  await expect(next.getByTestId('timeline-event').filter({ hasText: 'Fresh adjacent title' })).toHaveCount(1);
  await expect(next.getByTestId('timeline-event').filter({ hasText: 'C blocker' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Timeline', exact: true })).toHaveCount(1);
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

test('short calendar list stays collapsed at its bottom', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await setup(page, false, undefined, 'Calendar', true);
  const root = page.locator('.calendar-page');
  await expect(root).toHaveClass(/is-compact/);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  for (let n = 0; n < 5; n++) {
    await page.clock.runFor(300);
    await expect(root).toHaveClass(/is-compact/);
  }
  const top = await page.evaluate(() => window.scrollY);
  await page.clock.runFor(1000);
  expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(top, 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await root.dispatchEvent('wheel', { deltaY: -30 });
  await page.clock.runFor(700);
  await expect(root).not.toHaveClass(/is-compact/);
});

for (const theme of ['light', 'dark'] as const) test(`calendar header compacts with scroll in ${theme}`, async ({ page }) => {
  await setup(page, false, w => { w.calendarPreferences.appearance.mode = theme; w.calendarPreferences.timeline!.mode = 'timeline'; });
  const root = page.locator('.calendar-page');
  const title = page.locator('.calendar-title');
  const body = page.locator('.calendar-navigation-body');
  await page.evaluate(() => window.scrollTo(0, 650));
  await page.clock.runFor(700);
  await expect(root).toHaveClass(/is-compact/);
  const bodyHeight = await body.evaluate(el => el.getBoundingClientRect().height);
  expect(bodyHeight).toBeGreaterThan(0);
  await expect(page.locator('.calendar-day-panel.is-week')).toBeInViewport();
  expect(await root.evaluate(el => el.style.minHeight)).toBe('');
  await page.evaluate(() => window.scrollTo(0, 0));
  await root.dispatchEvent('wheel', { deltaY: -30 });
  await page.clock.runFor(700);
  await expect(root).not.toHaveClass(/is-compact/);
  await expect(title).toBeVisible();
  expect(await body.evaluate(el => el.getBoundingClientRect().height)).toBe(bodyHeight);
});

test('calendar opens collapsed, reveals controls with a downward pull and has no artificial blank tail', async ({ page }) => {
  await setup(page, false, w => { w.calendarPreferences.timeline!.mode = 'timeline'; }, 'Calendar', true);
  const root = page.locator('.calendar-page');
  const body = page.locator('.calendar-navigation-body');
  await expect(root).toHaveClass(/is-compact/);
  const bodyHeight = await body.evaluate(el => el.getBoundingClientRect().height);
  expect(bodyHeight).toBeGreaterThan(0);
  const week = page.locator('.calendar-day-panel.is-week');
  await expect(week).toBeInViewport();
  const glass = await page.locator('.calendar-navigator').evaluate(el => getComputedStyle(el).backdropFilter);
  expect(glass).toContain('blur');
  expect(await root.evaluate(el => getComputedStyle(el, '::after').content)).toBe('none');
  // Native scrolling must move controls continuously, without changing their
  // layout height or toggling visibility during intermediate swipe positions.
  const startY = await page.evaluate(() => window.scrollY);
  const startTop = await body.evaluate(el => el.getBoundingClientRect().top);
  for (const delta of [20, 40, 60]) {
    await page.evaluate(y => window.scrollTo(0, y), Math.max(0, startY - delta));
    await page.clock.runFor(20);
    expect(await body.evaluate(el => el.getBoundingClientRect().top)).toBeCloseTo(startTop + Math.min(delta, startY), 0);
    expect(await body.evaluate(el => el.getBoundingClientRect().height)).toBe(bodyHeight);
    await expect(week).toBeInViewport();
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.clock.runFor(500);
  await expect(root).not.toHaveClass(/is-compact/);
  await expect(page.getByRole('button', { name: 'Edit calendar day view' })).toBeVisible();
  await expect(page.locator('.calendar-navigation-toggle')).toHaveCount(0);
  await expect(page.locator('.calendar-navigator').getByRole('button', { name: 'Month', exact: true })).toBeVisible();
  const capacity = week.locator('.view-metrics-summary').first();
  expect(await capacity.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(0);
  const filters = page.locator('.calendar-filter-controls');
  const modes = page.getByRole('group', { name: 'Calendar display mode' });
  expect((await filters.boundingBox())!.x).toBeGreaterThan((await modes.boundingBox())!.x);
  const noDate = filters.getByRole('button', { name: /^No date/ });
  await expect(noDate).toHaveAttribute('aria-pressed', 'true');
  await expect(noDate).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await noDate.click();
  await expect(noDate).toHaveAttribute('aria-pressed', 'false');
  expect(await noDate.evaluate(el => getComputedStyle(el).borderTopWidth)).toBe('0px');
  await expect(noDate).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.screenshot({ path: test.info().outputPath('expanded-compact-calendar.png') });
  await page.evaluate(() => window.scrollTo(0, 650));
  await page.clock.runFor(500);
  await expect(root).toHaveClass(/is-compact/);
  expect(await body.evaluate(el => el.getBoundingClientRect().height)).toBe(bodyHeight);
  await expect(week).toBeInViewport();
  await week.locator('[data-date="2026-09-25"]').focus();
  await page.keyboard.press('Enter');
  await expect(week.locator('.selected')).toHaveAttribute('data-date', '2026-09-25');
  await expect(week).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('compact-glass-week.png') });
});

for (const scope of ['this_occurrence', 'this_and_future'] as const) test(`editor saves recurrence scope ${scope}`, async ({ page }) => {
  const { read } = await setup(page, false, w => {
    w.items = {};
    const series = createItem('Scoped weekly', 'event', now); series.id = 'scoped'; series.role = 'series_template';
    series.schedule = { timezone: 'UTC', startAt: '2026-09-17T10:00:00Z', endAt: '2026-09-17T11:00:00Z', travelDuration: 'PT10M' };
    series.recurrence = { rrule: 'FREQ=WEEKLY;COUNT=4', timezone: 'UTC', anchor: 'schedule', closeAt: 'next_activation', autoRenew: true, activationOffset: 'PT0M', rdates: [], exdates: [] };
    w.items[series.id] = series;
  });
  await page.locator('.calendar-day-list .item-card').filter({ hasText: 'Scoped weekly' }).getByText('Scoped weekly', { exact: true }).click();
  await page.clock.runFor(1000); await page.waitForTimeout(350);
  const editor = page.getByRole('dialog', { name: 'Item editor', exact: true });
  await editor.getByLabel('Recurrence edit scope', { exact: true }).selectOption(scope);
  await editor.getByRole('combobox', { name: 'Title', exact: true }).fill('Changed weekly');
  await editor.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => Object.values((await read()).items).some(item => item.title === 'Changed weekly')).toBe(true);
  const saved = await read();
  expect(saved.items.scoped?.title).toBe('Scoped weekly');
  const changed = Object.values(saved.items).find(item => item.title === 'Changed weekly' && item.role === (scope === 'this_occurrence' ? 'occurrence' : 'series_template'));
  expect(changed).toBeDefined();
  expect(changed!.schedule!.startAt).toContain('2026-09-24');
  if (scope === 'this_and_future') expect(saved.items.scoped?.recurrence?.rrule).toContain('UNTIL=');
});

test('one editor completion closes the selected active-range occurrence, not its series', async ({ page }) => {
  const { read } = await setup(page, false, w => {
    w.items = {};
    const series = createItem('Подготовка к вс', 'event', now);
    series.id = 'preparation'; series.role = 'series_template'; series.canBeCompleted = true;
    series.schedule = { startAt: '2026-09-03T18:15:00.000Z', endAt: '2026-09-03T19:00:00.000Z', dueAt: '2026-09-06T08:00:00.000Z', estimatedDuration: 'PT45M', timezone: 'Europe/Moscow' };
    series.recurrence = { rrule: 'FREQ=WEEKLY;INTERVAL=1', timezone: 'Europe/Moscow', rdates: [], exdates: [], activationOffset: 'PT0M', closeAt: 'due', anchor: 'schedule', autoRenew: true };
    w.items[series.id] = series;
  });
  await page.clock.setSystemTime(new Date('2026-09-26T20:00:00Z'));
  await page.clock.runFor(1000);
  await page.locator('.calendar-day-panel [data-date="2026-09-26"]').click();
  const card = page.locator('.calendar-day-list .item-card').filter({ hasText: 'Подготовка к вс' }).first();
  await card.getByText('Подготовка к вс', { exact: true }).click();
  await page.clock.runFor(1000);
  await page.waitForTimeout(350);
  await page.getByRole('button', { name: 'Complete item', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(card).toHaveClass(/state-done/);
  await expect.poll(async () => Object.values((await read()).items).filter(item => item.occurrence?.seriesId === 'preparation' && item.state === 'done').length).toBe(1);
  expect((await read()).items.preparation?.state).toBe('open');
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
  await expect(currentTimeline(page).getByTestId('timeline-tentative').filter({ hasText: 'A task' })).toHaveAttribute('aria-label', /09:30–10:00/);
  await expect(page.locator('.calendar-page')).not.toContainText('No continuous free slot');
  await settledReload(page);
  await expect(currentTimeline(page).getByTestId('timeline-tentative').filter({ hasText: 'A task' })).toHaveCount(1);
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
  const notice = page.locator('.dismissible-toast');
  if (await notice.isVisible()) await notice.getByRole('button', { name: 'Dismiss message', exact: true }).click();
  await page.locator('.calendar-navigation-body').evaluate(element => element.scrollIntoView({ block: 'end', behavior: 'instant' }));
  await page.clock.runFor(400);
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(currentTimeline(page).getByTestId('timeline-active-range')).toHaveCount(2);
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
  const reference = currentTimeline(page).getByTestId('timeline-active-range');
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

test('temporary List order survives mode switching, leaves Timeline unchanged and resets without writes', async ({ page }) => {
  const { read } = await setup(page), before = (await read()).items;
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  const originalInterval = await currentTimeline(page).getByTestId('timeline-tentative').filter({ hasText: 'A task' }).getAttribute('aria-label');
  await page.getByRole('button', { name: 'List', exact: true }).click();
  const handle = page.locator('[data-view-item-id="task"] .item-main');
  await handle.focus(); await handle.press('ArrowDown');
  await expect(page.locator('[data-view-item-id]').first()).toHaveAttribute('data-view-item-id', 'event');
  expect((await read()).calendarPreferences.planning?.orders).toBeUndefined();
  await expect(handle).toBeFocused();
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(currentTimeline(page).getByTestId('timeline-tentative').filter({ hasText: 'A task' })).toHaveAttribute('aria-label', originalInterval!);
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.locator('[data-view-item-id]').first()).toHaveAttribute('data-view-item-id', 'event');
  const reset = page.getByRole('button', { name: 'Reset list order', exact: true });
  await reset.focus(); await reset.press('Enter');
  await expect(page.locator('[data-view-item-id]').first()).toHaveAttribute('data-view-item-id', 'task');
  await expect(reset).toBeDisabled();
  expect((await read()).calendarPreferences.planning?.orders).toBeUndefined();
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
  const event = currentTimeline(page).getByTestId('timeline-event').filter({ hasText: 'B event' });
  await expect(event).toHaveAttribute('aria-label', /10:00–11:00/); await expect(event).toContainText('↗');
  await expect(page.getByRole('button', { name: 'Reorder B event', exact: true })).toHaveCount(0);
  await page.clock.fastForward(40 * 3_600_000 + 1000);
  await expect(event).toHaveCount(0);
  expect((await read()).items).toEqual(before);
});

test('free-time share exports a PDF, with no event titles', async ({ page }, testInfo) => {
  await setup(page, true, workspace => { workspace.calendarPreferences.appearance.mode = 'dark'; });
  await page.getByRole('button', { name: 'Edit calendar day view' }).click();
  await page.getByText('Share free time', { exact: true }).click();
  await page.getByRole('button', { name: 'Show available time', exact: true }).click();
  const preview = page.locator('.calendar-availability-text pre');
  await expect(preview).toContainText('Available time');
  await expect(preview).not.toContainText('B event');
  await expect(page.locator('.calendar-availability-chart')).toHaveAttribute('role', 'img');
  await expect(page.locator('.calendar-availability-row')).toHaveCount(7);
  await expect(page.locator('.calendar-availability-row').first().locator('.calendar-availability-hour-mark')).toHaveCount(14);
  await expect(page.locator('.calendar-availability-busy').first()).toBeVisible();
  await page.getByLabel('Export language').selectOption('ru');
  await expect(preview).toContainText('Свободное время');
  await page.getByLabel('Export language').selectOption('es');
  await expect(preview).toContainText('Tiempo disponible');
  await expect(page.locator('.calendar-availability-date[data-weekend="true"]')).toHaveCount(2);
  const previewHeight = await page.locator('.calendar-availability-chart').evaluate(element => element.getBoundingClientRect().height);
  expect(previewHeight).toBeLessThanOrEqual(200);
  await expect(page.getByRole('button', { name: 'Share PDF', exact: true })).toBeEnabled();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data: ShareData) => {
      const file = data.files![0]!;
      document.body.dataset.freeTimeShare = JSON.stringify({ keys: Object.keys(data), name: file.name, type: file.type, bytes: [...new Uint8Array(await file.arrayBuffer())] });
    } });
  });
  await page.getByRole('button', { name: 'Share PDF', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.body.dataset.freeTimeShare)).toBeTruthy();
  const shared = await page.evaluate(() => JSON.parse(document.body.dataset.freeTimeShare!));
  expect(shared.keys).toEqual(['files']);
  expect(shared.name).toBe('universal-free-time.pdf');
  expect(shared.type).toBe('application/pdf');
  const pdf = Buffer.from(shared.bytes);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  await testInfo.attach('availability.pdf', { body: pdf, contentType: 'application/pdf' });
});

test('pointer reorder changes only the temporary List order and supports dark mode', async ({ page }) => {
  const { read } = await setup(page), before = (await read()).items;
  const handle = page.locator('[data-view-item-id="task"] .item-main');
  const target = page.locator('[data-view-item-id="event"]');
  // Start at the top: centering a card in this short list can place it behind
  // the sticky week header on Linux, despite toBeInViewport succeeding.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.clock.runFor(500);
  await expect(handle).toBeInViewport();
  await page.waitForTimeout(350);
  await page.clock.runFor(100);
  const source = (await handle.boundingBox())!;
  await expect.poll(() => handle.evaluate(element => {
    const box = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  })).toBe(true);
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down(); await page.clock.runFor(1100);
  await expect(page.locator('[data-view-item-id="task"] .card-reorder-surface')).toHaveClass(/is-dragging/);
  const destination = (await target.boundingBox())!;
  await page.mouse.move(destination.x + 24, destination.y + destination.height * 0.65, { steps: 8 });
  await expect(target.locator('.card-reorder-surface')).toHaveClass(/is-drop-target/);
  await page.mouse.up();
  await expect(page.locator('[data-view-item-id]').first()).toHaveAttribute('data-view-item-id', 'event');
  expect((await read()).calendarPreferences.planning?.orders).toBeUndefined();
  expect((await read()).items).toEqual(before);
  await navigate(page, 'Settings');
  const theme = page.locator('select').filter({ has: page.locator('option[value="dark"]') });
  await theme.evaluate(el => { const details = el.closest('details'); if (details) details.open = true; });
  await theme.selectOption('dark'); await navigate(page, 'Calendar');
  await page.locator('.calendar-navigation-body').evaluate(element => element.scrollIntoView({ block: 'end', behavior: 'instant' }));
  await page.clock.runFor(700);
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await currentTimeline(page).getByTestId('timeline-tentative').filter({ hasText: 'A task' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('calendar-order-dark.png') });
  await expect(page.getByRole('button', { name: 'Reorder A task', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reorder B event', exact: true })).toHaveCount(0);
  expect((await read()).calendarPreferences.planning?.orders).toBeUndefined();
});

test('List moves a fixed event without changing its Timeline interval', async ({ page }) => {
  const { read } = await setup(page), before = (await read()).items;
  const eventHandle = page.locator('[data-view-item-id="event"] .item-main');
  await eventHandle.press('ArrowUp');
  await expect(page.locator('[data-view-item-id]').first()).toHaveAttribute('data-view-item-id', 'event');
  expect((await read()).calendarPreferences.planning?.orders).toBeUndefined();
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reorder B event', exact: true })).toHaveCount(0);
  await expect(currentTimeline(page).getByTestId('timeline-event').filter({ hasText: 'B event' })).toBeVisible();
  expect((await read()).items).toEqual(before);
});

test('active-range Timeline ignores temporary List order and capacity has only one heading', async ({ page }) => {
  const { read } = await setup(page, true, w => {
    w.items.task!.schedule = { timezone: 'UTC', startAt: '2026-09-23T08:00:00Z', dueAt: '2026-09-25T18:00:00Z', estimatedDuration: 'PT1H' };
  });
  const before = (await read()).items;
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  const originalInterval = await currentTimeline(page).getByTestId('timeline-active-range').getAttribute('aria-label');
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await page.locator('[data-view-item-id="event"] .item-main').press('ArrowUp');
  await expect(page.locator('[data-view-item-id]').first()).toHaveAttribute('data-view-item-id', 'event');
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  const range = currentTimeline(page).getByTestId('timeline-active-range');
  await expect(range).toHaveAttribute('aria-label', originalInterval!);
  await expect(range).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(currentTimeline(page).locator('.timeline-planning-summary strong')).toHaveCount(0);
  expect((await read()).items).toEqual(before);
});

test('late anchor can reach the first row even if the remaining task has no free slot', async ({ page }) => {
  const { read } = await setup(page, true, w => {
    w.items.task!.schedule = { timezone: 'UTC', estimatedDuration: 'PT1H' };
    w.items.event!.schedule!.startAt = '2026-09-24T22:00:00Z'; w.items.event!.schedule!.endAt = '2026-09-24T23:15:00Z';
  });
  const before = (await read()).items;
  await page.locator('[data-view-item-id="event"] .item-main').press('ArrowUp');
  await expect(page.locator('[data-view-item-id]').first()).toHaveAttribute('data-view-item-id', 'event');
  await expect(page.locator('[data-view-item-id]').first()).toHaveAttribute('data-view-item-id', 'event');
  await expect(page.locator('.calendar-page')).not.toContainText('No continuous free slot');
  expect((await read()).items).toEqual(before);
});

test('temporary List order permits an event before an active-range task without changing its Due', async ({ page }) => {
  const { read } = await setup(page, true, w => {
    w.items.task!.schedule = { timezone: 'UTC', startAt: '2026-09-23T08:00:00Z', dueAt: '2026-09-24T10:00:00Z', estimatedDuration: 'PT1H' };
  });
  const before = (await read()).items;
  await page.locator('[data-view-item-id="event"] .item-main').press('ArrowUp');
  await expect(page.locator('[data-view-item-id]').first()).toHaveAttribute('data-view-item-id', 'event');
  await expect(page.locator('.calendar-page')).not.toContainText('A task: Placement does not fit before Due.');
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
