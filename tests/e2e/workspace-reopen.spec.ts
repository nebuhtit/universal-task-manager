import { expect, test } from '@playwright/test';

test('encrypted workspace keeps its item across repeated production reloads', async ({ page }) => {
  test.setTimeout(180_000);
  const failures: string[] = [];
  page.on('crash', () => failures.push('Browser process crashed'));
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto(process.env.UTM_TEST_URL ?? '/', { timeout: 90_000 });
  const password = 'test-only-workspace-reopen-password';
  await page.getByLabel('Workspace name').fill('Reopen regression');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await page.getByPlaceholder('Add new item').fill('Persistence regression item');
  await page.getByPlaceholder('Add new item').press('Enter');
  await expect(page.getByRole('dialog', { name: 'Item editor' })).toBeVisible();
  await page.getByRole('button', { name: 'Save item', exact: true }).click();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // Lock waits for the durable persistence queue before reload.
    const lock = page.locator('.sidebar .sidebar-bottom button').filter({ hasText: 'Lock' });
    if (await lock.isVisible()) await lock.click();
    else await lock.evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.getByRole('heading', { name: 'Unlock your workspace' })).toBeVisible();
    await page.reload();
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(page.getByText('Persistence regression item', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.capture-dock .quick-capture')).toHaveCSS('backdrop-filter', 'blur(6px)');
  }
  expect(failures).toEqual([]);
});
