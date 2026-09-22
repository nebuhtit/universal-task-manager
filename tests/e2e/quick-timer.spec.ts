import { expect, test } from '@playwright/test';

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
  await timer.locator('summary').click();
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
  await timer.locator('summary').click();
  await expect(timer.getByRole('button', { name: 'Save completion', exact: true })).toBeVisible();
  await timer.getByRole('button', { name: 'Save completion', exact: true }).click();
  await expect(timer.getByRole('button', { name: 'Completion saved', exact: true })).toBeDisabled();
  await editor.getByRole('button', { name: 'Save item', exact: true }).click();
  await page.reload();
  await page.getByLabel('Password', { exact: true }).fill('timer-test-password');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await openItem();
  const dates = editor.locator('[data-editor-section="dates"]');
  await dates.locator(':scope > summary').click();
  await dates.locator('summary').filter({ hasText: 'Progress & completions' }).click();
  await expect(dates.locator('.item-journal-entry')).toHaveCount(1);
});
