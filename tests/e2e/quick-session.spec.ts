import { test, expect } from '@playwright/test';

for (const colorScheme of ['light', 'dark'] as const) test('quick session survives closing in ' + colorScheme, async ({ page }) => {
  await page.emulateMedia({ colorScheme });
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('Quick sessions');
  await page.getByLabel('Password', { exact: true }).fill('test-password-326');
  await page.getByLabel('Confirm password').fill('test-password-326');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  const capture = page.locator('[data-quick-capture] input');
  await expect(capture).toBeVisible();
  await capture.fill('с'); await capture.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Timer and stopwatch', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await capture.fill('timer'); await capture.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(dialog.getByText('Result saved.', { exact: false })).toBeVisible();
  await dialog.getByLabel('Search item').fill('Recorded work');
  await dialog.getByRole('button', { name: 'Create item', exact: true }).click();
  await expect(dialog.getByLabel('Attach to item')).not.toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await capture.fill('timer'); await capture.press('Enter');
  await expect(dialog.getByLabel('Attach to item').locator('option:checked')).toHaveText('Recorded work');
});
