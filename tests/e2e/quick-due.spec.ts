import { expect, test, type Page } from '@playwright/test';

async function swipeLeft(page: Page, selector: string) {
  await page.locator(selector).first().evaluate((element) => {
    const dispatch = (type: string, x: number, ended: boolean) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      const touch = { clientX: x, clientY: 220 };
      Object.defineProperties(event, { touches: { value: ended ? [] : [touch] }, changedTouches: { value: [touch] } });
      element.dispatchEvent(event);
    };
    dispatch('touchstart', 260, false);
    dispatch('touchend', 150, true);
  });
}

test('quick Due uses one set of choices in the editor and swipe menu', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('Quick Due');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await page.getByPlaceholder('Add new item').fill('Sample task');
  await page.getByPlaceholder('Add new item').press('Enter');
  const datesSummary = page.locator('.editor-scroll > details > summary').filter({ hasText: 'Dates & time' }).first();
  const dates = datesSummary.locator('..');
  if (!await dates.evaluate((element) => (element as HTMLDetailsElement).open)) await datesSummary.click();
  await dates.getByRole('button', { name: 'Move Due quickly' }).click();
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const bounds = await dates.getByRole('button', { name: /Tomorrow/ }).boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  }
  const due = page.getByLabel('Due / Active range ends', { exact: true });
  await dates.getByRole('button', { name: /Tomorrow/ }).click();
  await expect(due).not.toHaveValue('');
  await expect(page.getByLabel('Calendar duration amount')).toHaveValue('');
  await page.getByRole('button', { name: 'Save item' }).click();
  const card = page.locator('.item-card[data-utm-due-item-id]').filter({ hasText: 'Sample task' }).first();
  await expect(card).toBeVisible();
  await swipeLeft(page, '.item-card[data-utm-due-item-id] .item-main');
  const menu = page.getByRole('dialog', { name: 'Quick Due' });
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: /Same day next week/ }).click();
  await expect(menu).toBeHidden();
  await page.waitForTimeout(400);
  await card.locator('.item-main').click();
  if (!await dates.evaluate((element) => (element as HTMLDetailsElement).open)) await datesSummary.click();
  await expect(due).not.toHaveValue('');
  const savedDue = await due.inputValue();
  await dates.getByRole('button', { name: 'Move Due quickly' }).click();
  await dates.getByRole('button', { name: /Tomorrow/ }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await card.locator('.item-main').click();
  if (!await dates.evaluate((element) => (element as HTMLDetailsElement).open)) await datesSummary.click();
  await expect(due).toHaveValue(savedDue);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.reload();
  await page.getByLabel('Password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.locator('.item-card[data-utm-due-item-id]').filter({ hasText: 'Sample task' }).first().locator('.item-main').click();
  if (!await dates.evaluate((element) => (element as HTMLDetailsElement).open)) await datesSummary.click();
  await expect(due).toHaveValue(savedDue);
});
