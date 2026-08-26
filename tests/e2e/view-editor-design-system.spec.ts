import { expect, test, type Page } from '@playwright/test';

async function createWorkspace(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('View editor design system');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
}

async function openSection(page: Page, name: string) {
  const details = page.locator('.view-editor details.view-editor-section').filter({ has: page.getByText(name, { exact: true }) }).first();
  if (!await details.evaluate((element) => (element as HTMLDetailsElement).open)) await details.locator(':scope > summary').click();
  return details;
}

test('view editor keeps visual, display, sorting, and creation-default semantics', async ({ page }) => {
  await createWorkspace(page);
  const trigger = page.getByRole('button', { name: 'New view' });
  await trigger.click();

  const dialog = page.getByRole('dialog', { name: 'Edit view' });
  await expect(dialog).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('Design system view');

  const visual = await openSection(page, 'Visual setup');
  const row = visual.locator('.visual-condition-row').first();
  await row.getByRole('combobox', { name: 'Property' }).selectOption('state');
  await row.getByRole('combobox', { name: 'Value' }).selectOption('done');

  await page.getByRole('button', { name: 'Hide all' }).click();
  const core = page.locator('.field-groups details').filter({ has: page.getByText('Core', { exact: true }) });
  if (!await core.evaluate((element) => (element as HTMLDetailsElement).open)) await core.locator(':scope > summary').click();
  await core.getByRole('checkbox', { name: /^Title/ }).check();

  await openSection(page, 'Advanced filter code');
  await expect(page.getByLabel('Advanced filter code')).toHaveValue(/state == "done"/);

  await openSection(page, 'Sorting');
  await page.getByRole('combobox', { name: 'Sort field 1' }).selectOption('priority');
  await expect(page.getByLabel('SQL-like sorting')).toHaveValue('priority desc nulls last');

  await openSection(page, 'Defaults for new items');
  await page.getByRole('button', { name: '+ Pin property' }).click();
  const defaults = page.locator('.creation-default-row').first();
  await defaults.getByRole('spinbutton').fill('4');

  await page.getByRole('button', { name: 'Save view' }).click();
  const view = page.locator('.view-section').filter({ hasText: 'Design system view' });
  await expect(view.getByRole('heading', { name: 'Design system view' })).toBeVisible();

  await view.getByRole('button', { name: /^Edit / }).click();
  await openSection(page, 'Visual setup');
  await expect(page.locator('.field-groups').getByRole('checkbox', { name: /^Title/ })).toBeChecked();
  await openSection(page, 'Defaults for new items');
  await expect(page.locator('.creation-default-row').getByRole('spinbutton')).toHaveValue('4');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  if ((page.viewportSize()?.width ?? 0) > 620) await expect(view.getByRole('button', { name: /^Edit / })).toBeFocused();
});

test('view editor is readable as a dark mobile sheet', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) > 620, 'mobile contract');
  await page.emulateMedia({ colorScheme: 'dark' });
  await createWorkspace(page);
  await page.getByRole('button', { name: 'New view' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit view' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('border-bottom-left-radius', '0px');
  const colors = await dialog.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color };
  });
  expect(colors.background).not.toBe(colors.color);
  await openSection(page, 'Visual setup');
  await expect(dialog.locator('.ui-dialog-content')).toHaveCSS('overflow-y', 'auto');
  await page.getByRole('button', { name: 'Close view editor' }).click();
  await expect(dialog).toBeHidden();
});
