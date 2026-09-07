import { expect, test } from '@playwright/test';

test('completed statistics option persists and nested filter operators are labelled', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('Statistics smoke');
  await page.getByLabel('Password', { exact: true }).fill('test-only-password');
  await page.getByLabel('Confirm password').fill('test-only-password');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await page.getByRole('button', { name: 'Edit Today', exact: true }).click();
  const section = async (name: string) => {
    const details = page.locator('.view-editor details.view-editor-section').filter({ has: page.getByText(name, { exact: true }) }).first();
    if (!await details.evaluate((element) => (element as HTMLDetailsElement).open)) await details.locator(':scope > summary').click();
    return details;
  };
  await page.getByLabel('Name', { exact: true }).fill('Completed statistics');
  const statistics = await section('Statistics');
  const checkbox = statistics.getByRole('checkbox', { name: 'Include completed items even when hidden' });
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  await section('Visual setup');
  await page.getByRole('button', { name: 'IF', exact: true }).first().click();
  await expect(page.locator('.filter-block-heading').filter({ hasText: /^AND · Level 1$/ })).toBeVisible();
  await expect(page.locator('.filter-block-heading').filter({ hasText: /^IF \/ THEN \/ ELSE · Level 2$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  await page.reload();
  const unlock = page.getByRole('button', { name: 'Unlock', exact: true });
  await expect(unlock).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill('test-only-password');
  await unlock.click();
  const view = page.locator('.view-section').filter({ has: page.getByRole('heading', { name: 'Completed statistics', exact: true }) });
  await view.getByRole('button', { name: /^Edit / }).click();
  await section('Statistics');
  await expect(page.getByRole('checkbox', { name: 'Include completed items even when hidden' })).toBeChecked();
});
