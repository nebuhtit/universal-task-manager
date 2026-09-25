import { expect, test } from '@playwright/test';

test('compact dates and glass editor preserve schedule while renaming', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill('synthetic-308-password');
  await page.getByLabel('Confirm password').fill('synthetic-308-password');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  const input = page.getByPlaceholder('Add new item', { exact: true });
  await input.fill('Даша вт 29.09.2026 16:00 тт 60м');
  await input.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue(/Даша вт 16:00/);
  const filter = await dialog.evaluate(element => getComputedStyle(element).backdropFilter);
  expect(filter).toContain('blur(');
  await dialog.getByLabel('Title', { exact: true }).fill('Встреча вт 16:00 тт 60м');
  await dialog.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByText('Встреча', { exact: true }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByLabel('Title', { exact: true })).toHaveValue(/Встреча вт 16:00/);
});
