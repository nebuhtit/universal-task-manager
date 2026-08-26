import { expect, test, type Page } from '@playwright/test';

async function createWorkspace(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('Item editor sections');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
}

async function openSection(page: Page, title: string) {
  const summary = page.locator('.editor-scroll > details > summary').filter({ hasText: title }).first();
  const section = summary.locator('..');
  if (!await section.evaluate((element) => (element as HTMLDetailsElement).open)) await section.locator(':scope > summary').click();
  return section;
}

test('low-risk item sections save values and disclosure state', async ({ page }) => {
  await createWorkspace(page);
  await page.getByPlaceholder('Add new item').fill('Design system item');
  await page.getByPlaceholder('Add new item').press('Enter');

  const priority = await openSection(page, 'Priority');
  await priority.getByLabel('Priority').selectOption('3');
  const tags = await openSection(page, 'Tags');
  await tags.getByLabel('Tags').fill('design, calm');
  const taskLink = await openSection(page, 'Organization');
  await taskLink.getByLabel('Task list').fill('Phase 3');
  const contexts = await openSection(page, 'Contexts');
  await contexts.getByLabel('Contexts').fill('desktop, mobile');
  await page.getByRole('button', { name: 'Save item' }).click();

  await page.getByText('Design system item', { exact: true }).first().click();
  await expect(page.getByLabel('Priority')).toHaveValue('3');
  await expect(page.getByRole('textbox', { name: 'Tags' })).toHaveValue('design, calm');
  await expect(page.locator('input[aria-label="Task list"]')).toHaveValue('Phase 3');
  await expect(page.getByLabel('Contexts')).toHaveValue('desktop, mobile');
  await expect(page.locator('.editor-scroll > details[open]').filter({ has: page.getByText('Priority', { exact: true }) })).toHaveCount(1);
  for (const title of ['Priority', 'Tags', 'Organization', 'Contexts']) {
    await expect(page.locator('.editor-scroll > details > summary').filter({ hasText: title }).first().locator('.section-dot')).toHaveCount(1);
  }
});

test('template toggle uses the shared checkbox without changing template semantics', async ({ page }) => {
  await createWorkspace(page);
  await page.getByPlaceholder('Add new item').fill('Reusable template');
  await page.getByPlaceholder('Add new item').press('Enter');
  const template = await openSection(page, 'Template');
  await template.getByRole('checkbox', { name: 'Save this item as a template' }).check();
  await page.getByRole('button', { name: 'Save item' }).click();

  await expect(page.getByText('Reusable template', { exact: true })).toHaveCount(0);
  await page.getByPlaceholder('Add new item').fill('From template');
  await page.getByPlaceholder('Add new item').press('Enter');
  const picker = await openSection(page, 'Choose a saved template');
  await expect(picker.getByRole('button', { name: 'Reusable template' })).toBeVisible();
});
