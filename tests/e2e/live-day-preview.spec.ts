import { expect, test } from '@playwright/test';

test('date-aware capture shows a compact day preview and selected calendar day', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('Day preview');
  await page.getByLabel('Password', { exact: true }).fill('day-preview-test-only');
  await page.getByLabel('Confirm password').fill('day-preview-test-only');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  const input = page.locator('.capture-dock input');
  await input.fill('Встреча завтра');
  const preview = page.locator('.capture-dock .live-day-preview');
  await expect(preview).toBeVisible();
  expect((await preview.boundingBox())!.height).toBeLessThan(100);
  await preview.click();
  await expect(page.locator('.calendar-page')).toBeVisible();
  await expect(page.locator('.calendar-timeline')).toBeVisible();
  await expect(page.locator('.capture-dock .live-text-panel')).toBeHidden();
  await input.focus();
  await expect(preview).toHaveCount(0);
  await input.fill('Встреча 12.07');
  await expect(preview).toBeVisible();
  await input.fill('Встреча без даты');
  await expect(preview).toHaveCount(0);
  if ((page.viewportSize()?.width ?? 0) <= 620) {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.locator('.mobile-nav-menu').getByRole('button', { name: 'Calendar', exact: true }).click();
  } else await page.locator('.sidebar').getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(input).toHaveAttribute('placeholder', /^Add new item for /);
  await input.fill('Дело');
  await input.press('Enter');
  const editor = page.getByRole('dialog', { name: 'Item editor' });
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('Event opens date')).not.toHaveValue('');
});
