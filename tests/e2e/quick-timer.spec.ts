import { expect, test, type Locator } from '@playwright/test';

async function expandTimer(timer: Locator) {
  // Initial editor normalization may remount its native disclosure. Wait for
  // that to settle rather than assuming the first click kept it open.
  await expect(async () => {
    if (!(await timer.evaluate(element => (element as HTMLDetailsElement).open))) await timer.locator('summary').click();
    await expect(timer.getByLabel('Quick timer mode')).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 5000 });
}

async function expandHistory(dates: Locator, editor: Locator) {
  await expect(async () => {
    if (!(await dates.evaluate(element => (element as HTMLDetailsElement).open))) await dates.locator(':scope > summary').click();
    await expect(editor.getByText('Progress & completions', { exact: false })).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 4000 });
  const text = editor.getByText('Progress & completions', { exact: false });
  const progress = text.locator('xpath=ancestor::details[1]');
  await expect(async () => {
    if (!(await progress.evaluate(element => (element as HTMLDetailsElement).open))) await progress.locator(':scope > summary').click();
    await expect(editor.locator('.item-journal-entry').first()).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 4000 });
  return editor.locator('.item-journal-entry');
}

test('native countdown completed while suspended is saved once after reopening', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'webkit', { configurable: true, value: { messageHandlers: {
      utmNativeReminders: { postMessage(message: { id: string }) {
        queueMicrotask(() => window.dispatchEvent(new CustomEvent('utm-native-reminders-status', { detail: { id: message.id, ok: true } })));
      } },
    } } });
  });
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('Native timer recovery');
  await page.getByLabel('Password', { exact: true }).fill('timer-test-password');
  await page.getByLabel('Confirm password').fill('timer-test-password');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await page.getByPlaceholder('Add new item').fill('Countdown recovery');
  await page.getByPlaceholder('Add new item').press('Enter');
  const editor = page.getByRole('dialog', { name: 'Item editor', exact: true });
  await editor.getByRole('button', { name: 'Save item', exact: true }).click();
  const openItem = async () => {
    if ((page.viewportSize()?.width ?? 0) > 620) await page.locator('.sidebar').getByRole('button', { name: /^All items/ }).click();
    else { await page.getByRole('button', { name: 'Open navigation' }).click(); await page.locator('.mobile-nav-menu').getByRole('button', { name: /^All items/ }).click(); }
    await page.locator('.item-card').filter({ hasText: 'Countdown recovery' }).getByRole('button', { name: /Countdown recovery/ }).click();
  };
  await openItem();
  const timer = editor.getByLabel('Quick timer and stopwatch', { exact: true });
  await expandTimer(timer);
  await timer.getByLabel('Timer minutes').fill('1');
  await timer.getByRole('button', { name: 'Start', exact: true }).click();
  // Wait for the real persistence queue before simulating process suspension.
  await expect.poll(() => page.evaluate(() => {
    const profile = JSON.parse(localStorage.getItem('utm:performance-profile:v1') ?? 'null');
    return JSON.stringify(profile).includes('timer.state');
  }), { timeout: 20_000 }).toBe(true);
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  // No timer callbacks run during this wall-clock jump.
  await page.clock.setFixedTime(new Date(Date.now() + 120_000));
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await expect.poll(() => page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('utm:performance-profile:v1') ?? 'null')).includes('timer.reconcile')), { timeout: 20_000 }).toBe(true);
  await page.reload();
  await page.getByLabel('Password', { exact: true }).fill('timer-test-password');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await openItem();
  const dates = editor.locator('[data-editor-section="dates"]');
  const recoveredEntries = await expandHistory(dates, editor);
  await expect(recoveredEntries.first()).toBeVisible();
  await expect(recoveredEntries.first()).toContainText('0:01:00');
});

test('short stopwatch record survives editor close and reload until saved', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('Timer persistence');
  await page.getByLabel('Password', { exact: true }).fill('timer-test-password');
  await page.getByLabel('Confirm password').fill('timer-test-password');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await page.getByPlaceholder('Add new item').fill('Short exercise');
  await page.getByPlaceholder('Add new item').press('Enter');
  const editor = page.getByRole('dialog', { name: 'Item editor', exact: true });
  await editor.getByRole('button', { name: 'Save item', exact: true }).click();
  const openItem = async () => {
    if ((page.viewportSize()?.width ?? 0) > 620) await page.locator('.sidebar').getByRole('button', { name: /^All items/ }).click();
    else { await page.getByRole('button', { name: 'Open navigation' }).click(); await page.locator('.mobile-nav-menu').getByRole('button', { name: /^All items/ }).click(); }
    await page.locator('.item-card').filter({ hasText: 'Short exercise' }).getByRole('button', { name: /Short exercise/ }).click();
  };
  await openItem();
  const timer = editor.getByLabel('Quick timer and stopwatch', { exact: true });
  await expandTimer(timer);
  await timer.getByRole('checkbox', { name: 'Interval sound', exact: true }).check();
  const interval = timer.getByLabel('Interval sound value');
  await interval.fill('');
  await expect(interval).toHaveValue('');
  await interval.fill('2');
  await timer.getByLabel('Quick timer mode').selectOption('stopwatch');
  await timer.getByRole('button', { name: 'Start', exact: true }).click();
  await page.waitForTimeout(1200);
  await timer.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(timer.getByRole('button', { name: 'Save completion', exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.reload();
  await page.getByLabel('Password', { exact: true }).fill('timer-test-password');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await openItem();
  await expandTimer(timer);
  await expect(timer.getByRole('button', { name: 'Save completion', exact: true })).toBeVisible();
  await timer.getByRole('button', { name: 'Save completion', exact: true }).click();
  await expect(timer.getByRole('button', { name: 'Completion saved', exact: true })).toBeDisabled();
  await editor.getByRole('button', { name: 'Save item', exact: true }).click();
  await page.reload();
  await page.getByLabel('Password', { exact: true }).fill('timer-test-password');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await openItem();
  const dates = editor.locator('[data-editor-section="dates"]');
  await expect(await expandHistory(dates, editor)).toHaveCount(1);
});
