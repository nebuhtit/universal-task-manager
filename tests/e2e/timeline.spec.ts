import { expect, test, type Page } from '@playwright/test';
import * as Automerge from '@automerge/automerge';
import { createWorkspace, createItem, createOccurrence } from '../../packages/core/dist/index.js';
import { createAutomergeDocument, encryptWithKey, randomKey, wrapKey } from '../../packages/sdk/dist/index.js';

const password = 'timeline-fixture-test-only';
const now = new Date('2026-09-22T12:00:00Z');
async function setup(page: Page, filter = 'true', quickSource = false) {
  const w = createWorkspace('Timeline', now); w.calendarPreferences.timezone = 'UTC';
  w.calendarPreferences.appearance.mode = 'light'; w.calendarPreferences.dayView.filter.source = filter;
  w.calendarPreferences.dayView.listFields = ['title', 'schedule.startAt'];
  w.calendarPreferences.dayView.timelineFields = ['title', 'reminders'];
  w.calendarPreferences.timeline = { mode: 'timeline', hideSleep: false };
  for (let i = 0; i < 6; i++) {
    const item = createItem(`Overlap ${i}`, 'task', now);
    item.schedule = { timezone: 'UTC', startAt: '2026-09-22T12:00:00Z', endAt: '2026-09-22T13:00:00Z' }; w.items[item.id] = item;
  }
  const short = createItem('One minute title', 'task', now); short.schedule = { timezone: 'UTC', startAt: '2026-09-22T17:00:00Z', endAt: '2026-09-22T17:01:00Z', travelDuration: 'PT30M' }; w.items[short.id] = short;
  if (quickSource) short.extensions = { 'utm:quickEntrySource': { text: 'One minute title начало 22.09.2026 17:00 длительность 1м н начало-30м,начало-60м', timezone: 'UTC', grammarVersion: 2 } };
  const sleep = createItem('Sleep source', 'task', now); sleep.schedule = { timezone: 'UTC', startAt: '2026-09-22T00:00:00Z', endAt: '2026-09-22T07:00:00Z' }; sleep.reminders = [{ id: 'sleep-reminder', mode: 'absolute', at: '2026-09-22T18:00:00Z', urgency: 'normal', repeatUntilAcknowledged: false }]; w.items[sleep.id] = sleep;
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

test('editor opens the full quick line with bounded scrolling and a non-overlapping preview', async ({ page }) => {
  await setup(page, 'true', true);
  const event = page.getByTestId('timeline-event').filter({ hasText: 'One minute title' });
  // Settle sticky navigation before the pointer interaction scrolls far down.
  await event.evaluate(el => el.scrollIntoView({ block: 'center' }));
  await expect(event).toBeInViewport();
  await event.click();
  const editor = page.getByRole('dialog', { name: 'Item editor', exact: true });
  const input = editor.getByRole('combobox', { name: 'Title', exact: true });
  await expect(input).toHaveAttribute('rows', '3');
  const initialHeight = (await input.boundingBox())!.height;
  await expect(input).toHaveValue(/начало-30м, начало-60м/);
  await input.fill('Заметка '.repeat(80) + ' завтра');
  await expect(input).toHaveCSS('overflow-y', 'auto');
  expect(await input.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  expect((await input.boundingBox())!.height).toBe(initialHeight);
  const rows = await input.evaluate(el => { const s = getComputedStyle(el); return (el.clientHeight - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom)) / parseFloat(s.lineHeight); });
  expect(Math.abs(rows - 3)).toBeLessThan(0.1);
  await expect(editor.locator('.live-day-preview')).toHaveCSS('position', 'relative');
  await expect(editor.getByRole('listbox')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('quick-entry-scroll.png') });
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('sticky navigation waits through pointerup until click dispatch', async ({ page }) => {
  await setup(page);
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 1000));
  const nav = page.locator('.calendar-navigator');
  await expect(nav).not.toHaveClass(/is-compact/);
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent('pointerdown'));
    window.scrollTo(0, 650);
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new PointerEvent('pointerup'));
  });
  await page.clock.runFor(50);
  await expect(nav).not.toHaveClass(/is-compact/);
  await page.evaluate(() => window.dispatchEvent(new MouseEvent('click')));
  await page.clock.runFor(50);
  await expect(nav).toHaveClass(/is-compact/);
});

test('week stays below the header while month and controls return at the top', async ({ page }) => {
  await setup(page);
  const nav = page.locator('.calendar-navigator');
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await expect(nav.locator('.calendar-day-choice')).toHaveCount(30);
  await nav.locator('[data-date="2026-09-30"]').click();
  const snapshot = await primary(page);
  await page.evaluate(() => window.scrollTo(0, 650));
  await expect(nav).toHaveClass(/is-compact/);
  await expect(nav.locator('.calendar-day-choice')).toHaveCount(7);
  await expect(nav.locator('[data-date="2026-10-04"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Month', exact: true })).toBeHidden();
  const title = (await page.locator('.calendar-title').boundingBox())!;
  const box = (await nav.boundingBox())!;
  expect(Math.abs(box.y - title.y - title.height)).toBeLessThan(3);
  await nav.locator('[data-date="2026-10-01"]').focus();
  await page.keyboard.press('Enter');
  await expect(nav.locator('[data-date="2026-10-01"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(nav.locator('[data-date="2026-10-01"]')).toBeFocused();
  await page.screenshot({ path: test.info().outputPath('sticky-week-light.png') });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.screenshot({ path: test.info().outputPath('sticky-week-dark.png') });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(nav).not.toHaveClass(/is-compact/);
  await expect(page.getByRole('button', { name: 'Month', exact: true })).toBeVisible();
  await expect(nav.locator('.calendar-day-choice')).toHaveCount(31);
  expect(await primary(page)).toBe(snapshot);
});

test('holding an empty hour opens an unsaved one-hour draft with focused title', async ({ page }) => {
  await setup(page);
  const tick = page.locator('.timeline-tick').filter({ hasText: '18:00' });
  await tick.scrollIntoViewIfNeeded();
  const box = await tick.boundingBox();
  const axis = page.locator('.timeline-axis');
  const saved = await primary(page);
  await tick.locator('span').dispatchEvent('pointerdown', { pointerId: 1, isPrimary: true, pointerType: 'touch', button: 0, clientX: box!.x + 20, clientY: box!.y + 3 });
  await page.clock.fastForward(600);
  const editor = page.getByRole('dialog', { name: 'Item editor', exact: true });
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('combobox', { name: 'Title', exact: true })).toBeFocused();
  await editor.locator('[data-editor-section="dates"] > summary').click();
  await expect(editor.getByLabel('Event opens', { exact: true })).toHaveValue('2026-09-22T18:00');
  await expect(editor.getByLabel('Event ends', { exact: true })).toHaveValue('2026-09-22T19:00');
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await primary(page)).toBe(saved);
  await axis.dispatchEvent('pointerdown', { pointerId: 1, isPrimary: true, pointerType: 'touch', button: 0, clientX: box!.x + 20, clientY: box!.y + 3 });
  await axis.dispatchEvent('pointermove', { pointerId: 1, isPrimary: true, clientX: box!.x + 20, clientY: box!.y + 40 });
  await page.clock.fastForward(600);
  await expect(editor).toHaveCount(0);
});

test('calendar time filters cross a threshold without a workspace write', async ({ page }) => {
  await setup(page, 'title == "One minute title" && minutesUntil(schedule.startAt) < 60');
  const card = page.getByTestId('timeline-event').filter({ hasText: 'One minute title' });
  await expect(card).toHaveCount(0);
  const saved = await primary(page);
  // minutesUntil rounds up: 16:00:01 still means 60 minutes until 17:00.
  await page.clock.fastForward(4 * 3_600_000 + 61_000);
  await expect(card).toHaveCount(1);
  expect(await primary(page)).toBe(saved);
});

test('remaining calendar capacity updates each minute without changing stored items', async ({ page }) => {
  // No ongoing occupied interval: elapsed time must reduce remaining free time.
  await setup(page, 'title == "One minute title"');
  const capacity = page.getByTestId('calendar-header-capacity');
  const before = await capacity.textContent();
  const saved = await primary(page);
  await page.clock.fastForward(60_000);
  await expect(capacity).not.toHaveText(before!);
  expect(await primary(page)).toBe(saved);
});

async function swipeTouch(page: Page, selector: string, fromX: number, toX: number) {
  await page.locator(selector).evaluate((target, { fromX, toX }) => {
    const dispatch = (kind: 'touchstart' | 'touchend', x: number) => {
      const event = new Event(kind, { bubbles: true, cancelable: true });
      const point = { clientX: x, clientY: 400 };
      Object.defineProperty(event, 'touches', { value: kind === 'touchstart' ? [point] : [] });
      Object.defineProperty(event, 'changedTouches', { value: [point] });
      target.dispatchEvent(event);
    };
    dispatch('touchstart', fromX);
    dispatch('touchend', toX);
  }, { fromX, toX });
}

test('List shows clock-only metadata while Timeline shows reminders with separate field settings', async ({ page }) => {
  await setup(page);
  const sleepBlock = page.getByTestId('timeline-event').filter({ hasText: 'Sleep source' });
  await expect(sleepBlock).toContainText('normal');
  await expect(sleepBlock).not.toContainText('00:00–07:00');
  await page.getByRole('button', { name: 'Edit calendar day view' }).click();
  await expect(page.getByText('List card fields', { exact: true })).toBeVisible();
  await expect(page.getByText('Timeline card fields', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close calendar day view editor' }).click();
  await page.getByRole('button', { name: 'List', exact: true }).click();
  const sleepCard = page.locator('.calendar-day-list .item-card').filter({ hasText: 'Sleep source' }).first();
  await expect(sleepCard).toContainText('00:00');
  await expect(sleepCard).not.toContainText('22 Sep');
});

test('calendar statistics stay pinned and blank Timeline swipes change day without stealing item swipes', async ({ page }) => {
  await setup(page);
  const title = page.locator('.calendar-heading-date h1');
  const header = page.locator('.calendar-title');
  await expect(header).toHaveCSS('position', 'sticky');
  await expect(header.getByTestId('calendar-header-capacity')).toHaveCSS('margin-left', '0px');
  await swipeTouch(page, '.timeline-axis', 290, 120);
  await expect(title).toContainText('September 23, 2026');
  await swipeTouch(page, '.timeline-axis', 120, 290);
  await expect(title).toContainText('September 22, 2026');
  await swipeTouch(page, '.timeline-events [data-testid="timeline-event"]:has-text("One minute title")', 290, 120);
  await expect(title).toContainText('September 22, 2026');
  await expect(page.getByRole('dialog', { name: 'Quick Due' })).toContainText('Move Due');
});

test('active-range work is an unfilled outline on successive days and opens its item', async ({ page }) => {
  await setup(page);
  const cue = page.getByTestId('timeline-active-range');
  await expect(cue).toHaveCount(1);
  await expect(cue).toContainText('Active preparation');
  await expect(cue).toContainText('15 min / day');
  await expect(cue).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await swipeTouch(page, '.timeline-axis', 290, 120);
  await expect(page.locator('.calendar-heading-date h1')).toContainText('September 23, 2026');
  await expect(cue).toHaveCount(1);
  await cue.evaluate(element => element.scrollIntoView({ block: 'center' }));
  await cue.click();
  await expect(page.getByRole('dialog')).toContainText('Active preparation');
});

test('timeline titles, More, clock, sleep, dark mode and persisted display choice', async ({ page }, testInfo) => {
  test.setTimeout(180_000); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await setup(page);
  const allDayButton = page.locator('.timeline-toolbar').getByRole('button', { name: /^All day/ });
  await allDayButton.click(); await expect(page.locator('.timeline-all-day-items')).toHaveCount(0);
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.locator('.calendar-all-day')).toHaveCount(0);
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(allDayButton).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('save-status')).toHaveCount(0, { timeout: 30_000 });
  await page.clock.fastForward(11_000);
  await page.reload();
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  if ((page.viewportSize()?.width ?? 0) <= 620) {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.locator('.mobile-nav-menu').getByRole('button', { name: 'Calendar', exact: true }).click();
  } else await page.locator('.sidebar').getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(allDayButton).toHaveAttribute('aria-pressed', 'false');
  await allDayButton.click();
  await expect(page.locator('.timeline-all-day-items .item-card')).toBeVisible();
  const active = page.getByTestId('timeline-active-range');
  await expect(active).toHaveCount(1);
  await expect(active).toContainText('Active preparation');
  await active.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `/tmp/utm-timeline-top-${testInfo.project.name}-light.png` });
  const tentative = page.getByTestId('timeline-tentative');
  await expect(tentative).toHaveCount(0);
  const showUndated = page.locator('.timeline-toolbar').getByRole('button', { name: /^No date/ });
  await expect(showUndated).toHaveAttribute('aria-pressed', 'false');
  await showUndated.evaluate(element => element.scrollIntoView({ block: 'center' }));
  await showUndated.click();
  await expect(showUndated).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('save-status')).toHaveCount(0, { timeout: 30_000 });
  const saved = await primary(page);
  await expect(tentative).toHaveCount(1);
  await expect(tentative).toHaveCSS('border-top-style', 'dotted');
  await expect(tentative).toHaveAttribute('aria-label', 'Tentative · Tentative task · 13:00–15:00');
  await expect(page.locator('.timeline-planning-summary strong')).toHaveCount(0);
  await tentative.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `/tmp/utm-tentative-${testInfo.project.name}-light.png` });
  await tentative.focus();
  await expect(tentative).toBeFocused();
  const minute = page.locator('.timeline-events').getByRole('button', { name: /^One minute title/ }); await minute.scrollIntoViewIfNeeded();
  expect((await minute.boundingBox())!.height).toBeGreaterThanOrEqual(36);
  await expect(minute.locator('strong')).toHaveText('One minute title');
  await minute.click();
  const editor = page.getByRole('dialog');
  await expect(editor.getByRole('button', { name: 'Complete item', exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
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
  await page.getByRole('button', { name: 'Edit calendar day view' }).click();
  await page.getByText('Timeline settings', { exact: true }).click();
  await page.getByText('Choose sleep item…', { exact: true }).click();
  await page.getByRole('button', { name: 'Sleep source', exact: true }).click();
  await page.getByRole('button', { name: 'Save view' }).click();
  await expect(page.locator('.timeline-break')).toContainText('00:00–07:00');
  await page.locator('.timeline-break').first().click(); await expect(page.locator('.timeline-break')).toHaveCount(0);
  await page.getByRole('button', { name: /^Collapse night/ }).click(); await expect(page.locator('.timeline-break')).toContainText('00:00–07:00');
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await tentative.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `/tmp/utm-tentative-${testInfo.project.name}-dark.png` });
  await minute.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `/tmp/utm-timeline-${testInfo.project.name}-dark.png` });
  await expect(page.getByTestId('timeline-now')).toHaveCSS('pointer-events', 'none');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await active.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `/tmp/utm-timeline-top-${testInfo.project.name}-dark.png` });
  await active.evaluate(element => element.scrollIntoView({ block: 'center' }));
  await active.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Complete item', exact: true }).click();
  await expect(active).toHaveCount(0);
  await page.getByRole('button', { name: 'List', exact: true }).click(); await expect(page.locator('.calendar-timeline')).toHaveCount(0);
  const listUndated = page.locator('.calendar-list-toolbar').getByRole('button', { name: /^No date/ });
  await expect(listUndated).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.calendar-no-date')).toContainText('Undated sentinel');
  await listUndated.evaluate(element => element.scrollIntoView({ block: 'center' }));
  await listUndated.click(); await expect(page.locator('.calendar-no-date')).toHaveCount(0);
  await expect(listUndated).toHaveAttribute('aria-pressed', 'false');
  // Removing the section changes scroll anchoring. Center the control again
  // before the second pointer action so sticky navigation can settle.
  await listUndated.evaluate(element => element.scrollIntoView({ block: 'center' }));
  await listUndated.click(); await expect(listUndated).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.calendar-no-date')).toContainText('Undated sentinel');
  await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const listAllDay = page.locator('.calendar-list-toolbar').getByRole('button', { name: /^All day/ });
  await expect(page.locator('.calendar-all-day')).toContainText('All day sentinel');
  await listAllDay.click(); await expect(page.locator('.calendar-all-day')).toHaveCount(0);
  await expect(page.getByTestId('save-status')).toHaveCount(0, { timeout: 30_000 });
  const lock = page.locator('.sidebar .sidebar-bottom button').filter({ hasText: 'Lock' }); await lock.evaluate((el: HTMLButtonElement) => el.click());
  await expect(page.getByRole('heading', { name: 'Unlock your workspace' })).toBeVisible(); await page.reload();
  await page.getByLabel('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByPlaceholder('Add new item')).toBeVisible({ timeout: 30_000 });
  if ((page.viewportSize()?.width ?? 0) <= 620) { await page.getByRole('button', { name: 'Open navigation' }).click(); await page.locator('.mobile-nav-menu').getByRole('button', { name: 'Calendar', exact: true }).click(); }
  else await page.locator('.sidebar').getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-pressed', 'true'); expect(errors).toEqual([]);
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(showUndated).toHaveAttribute('aria-pressed', 'true');
  await showUndated.click();
  await expect(tentative).toHaveCount(0);
});
