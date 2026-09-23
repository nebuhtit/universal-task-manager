import { expect, test } from '@playwright/test';

test('Live text date-only item survives save, swipe rescheduling and reopen without a clock', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-22T12:00:00Z') });
  await page.goto(process.env.UTM_TEST_URL ?? '/');
  await page.getByLabel('Workspace name').fill('Planned date');
  await page.getByLabel('Password', { exact: true }).fill('date-only-test-password');
  await page.getByLabel('Confirm password').fill('date-only-test-password');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  const capture = page.getByPlaceholder('Add new item');
  await capture.fill('Отчёт завтра 2ч'); await capture.press('Enter');
  const summary = page.locator('.editor-scroll > details > summary').filter({ hasText: 'Dates & time' }).first();
  await summary.locator('..').evaluate(el => { (el as HTMLDetailsElement).open = true; });
  await expect(page.getByLabel('Event opens date', { exact: true })).toHaveValue('2026-09-23');
  await expect(page.getByLabel('Event opens precision')).toHaveValue('date');
  await page.getByRole('button', { name: 'Save item', exact: true }).click();
  const card = page.locator('.item-card').filter({ hasText: 'Отчёт' }).first();
  await expect(card).toBeVisible();
  await card.evaluate(element => {
    for (const [type, x, ended] of [['touchstart', 260, false], ['touchend', 100, true]] as const) {
      const event = new Event(type, { bubbles: true, cancelable: true }); const touch = { clientX: x, clientY: 220 };
      Object.defineProperties(event, { touches: { value: ended ? [] : [touch] }, changedTouches: { value: [touch] } }); element.dispatchEvent(event);
    }
  });
  const menu = page.getByRole('dialog', { name: 'Quick Due' });
  await expect(menu.locator('input[type="datetime-local"]')).toHaveCount(0);
  await menu.locator('input[type="date"]').fill('2026-09-22');
  await menu.getByRole('button', { name: 'Reschedule', exact: true }).click();
  await expect(menu).toBeHidden();
  await expect(page.getByTestId('save-status')).toHaveCount(0, { timeout: 30000 });
  // Startup remains pending for ten seconds to catch immediate render failures.
  await page.clock.fastForward(11_000);
  await page.reload(); await page.getByLabel('Password', { exact: true }).fill('date-only-test-password');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await card.locator('.item-main').click();
  await summary.locator('..').evaluate(el => { (el as HTMLDetailsElement).open = true; });
  await expect(page.getByLabel('Event opens date', { exact: true })).toHaveValue('2026-09-22');
  await expect(page.getByLabel('Event opens precision')).toHaveValue('date');
});

test('date-only Event ends makes an inclusive day range, or a timed end starts at midnight', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-22T12:00:00Z') });
  await page.goto(process.env.UTM_TEST_URL ?? '/');
  await page.getByLabel('Workspace name').fill('Date range');
  await page.getByLabel('Password', { exact: true }).fill('date-range-test-password');
  await page.getByLabel('Confirm password').fill('date-range-test-password');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  const capture = page.getByPlaceholder('Add new item');
  await capture.fill('Поездка завтра'); await capture.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Item editor' })).toBeVisible();
  await expect(page.getByLabel('Event opens date')).toHaveValue('2026-09-23');
  const summary = page.locator('.editor-scroll > details > summary').filter({ hasText: 'Dates & time' }).first();
  await summary.locator('..').evaluate(el => { (el as HTMLDetailsElement).open = true; });
  await expect(page.getByLabel('Event ends date')).toBeVisible();
  await page.getByLabel('Event ends date').fill('2026-09-25');
  await expect(page.getByLabel('Event opens date')).toHaveValue('2026-09-23');
  await expect(page.getByLabel('Event ends date')).toHaveValue('2026-09-25');
  await page.getByRole('button', { name: 'Clear Event ends' }).click();
  await expect(page.getByLabel('Event ends date')).toHaveValue('');
  await page.getByLabel('Event ends date').fill('2026-09-25');
  await page.getByRole('button', { name: 'Save item', exact: true }).click();
  await page.getByText('Поездка', { exact: true }).first().click();
  await summary.locator('..').evaluate(el => { (el as HTMLDetailsElement).open = true; });
  await expect(page.getByLabel('Event ends date')).toHaveValue('2026-09-25');
  await page.getByLabel('Event ends precision').selectOption('datetime');
  await page.getByRole('button', { name: 'Clear Event ends' }).click();
  await expect(page.getByLabel('Event ends date')).toHaveCount(0);
  await page.getByLabel('Event ends', { exact: true }).fill('2026-09-25T18:00');
  await expect(page.getByLabel('Event opens precision')).toHaveValue('datetime');
  await expect(page.getByLabel('Event opens', { exact: true })).toHaveValue('2026-09-23T00:00');
  const title = page.getByLabel('Title', { exact: true });
  await title.fill('Поездка завтра');
  const suggestions = page.locator('.item-editor-dialog .live-text-panel');
  await expect(suggestions).toBeVisible();
  const fieldBox = await title.boundingBox(); const panelBox = await suggestions.boundingBox();
  expect(panelBox!.y).toBeGreaterThanOrEqual(fieldBox!.y + fieldBox!.height);
});
