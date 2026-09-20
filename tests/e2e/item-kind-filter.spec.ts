import { expect, test } from '@playwright/test';

test('visual setup provides a plain-language item kind filter', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('Item kind filter');
  await page.getByLabel('Password', { exact: true }).fill('test-only-password');
  await page.getByLabel('Confirm password').fill('test-only-password');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await page.getByRole('button', { name: 'Edit Today', exact: true }).click();

  const visual = page.locator('.view-editor details.view-editor-section').filter({ has: page.getByText('Visual setup', { exact: true }) }).first();
  if (!await visual.evaluate((element) => (element as HTMLDetailsElement).open)) await visual.locator(':scope > summary').click();
  const condition = visual.locator('.filter-condition').first();
  await condition.getByLabel('Property').selectOption('itemKind');
  await expect(condition.getByLabel('Value')).toHaveValue('regular_item');
  await expect(condition.getByLabel('Property').locator('option[value="itemKind"]')).toHaveText('Item kind');
  await condition.getByLabel('Value').selectOption('repeat_occurrence');
  await page.getByRole('button', { name: 'Save view', exact: true }).click();

  const saved = page.locator('.view-section').filter({ has: page.getByRole('heading', { name: 'Today', exact: true }) });
  await saved.getByRole('button', { name: 'Edit Today', exact: true }).click();
  const reopened = page.locator('.view-editor details.view-editor-section').filter({ has: page.getByText('Visual setup', { exact: true }) }).first();
  if (!await reopened.evaluate((element) => (element as HTMLDetailsElement).open)) await reopened.locator(':scope > summary').click();
  await expect(reopened.locator('.filter-condition').first().getByLabel('Property')).toHaveValue('itemKind');
  await expect(reopened.locator('.filter-condition').first().getByLabel('Value')).toHaveValue('repeat_occurrence');
});
