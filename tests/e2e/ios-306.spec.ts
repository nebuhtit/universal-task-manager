import { expect, test } from '@playwright/test';

test('ordinary unlock, duration timer and reachable editor close', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill('synthetic-306-password');
  await page.getByLabel('Confirm password').fill('synthetic-306-password');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await page.reload();
  await expect(page.getByRole('checkbox', { name: /Безопасное открытие/ })).not.toBeChecked();
  await page.getByLabel('Password', { exact: true }).fill('synthetic-306-password');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  const input = page.getByPlaceholder('Add new item', { exact: true });
  await input.fill('Timer sample дл 45м');
  await input.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByText('Quick timer & stopwatch', { exact: true }).click();
  await expect(page.getByLabel('Timer minutes')).toHaveValue('45');
  const close = dialog.locator('.ui-dialog-close');
  const bounds = await close.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  await close.click();
  await expect(dialog).toBeHidden();
});
