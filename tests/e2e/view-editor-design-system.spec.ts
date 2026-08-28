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

  await openSection(page, 'Show in results');
  await page.getByRole('button', { name: 'Hide all' }).click();
  const core = page.locator('.field-groups details').filter({ has: page.getByText('Core', { exact: true }) });
  if (!await core.evaluate((element) => (element as HTMLDetailsElement).open)) await core.locator(':scope > summary').click();
  await core.getByRole('checkbox', { name: /^Title/ }).check();

  await openSection(page, 'Advanced filter code');
  await expect(page.getByLabel('Advanced filter code')).toHaveValue(/state == "done"/);

  await openSection(page, 'Sorting');
  await page.getByRole('combobox', { name: 'Sort field 1' }).selectOption('priority');
  await expect(page.getByLabel('SQL-like sorting')).toHaveValue('priority desc nulls last\nupdatedAt desc nulls last');

  await openSection(page, 'Defaults for new items');
  await page.getByRole('button', { name: '+ Pin property' }).click();
  const defaults = page.locator('.creation-default-row').first();
  await defaults.getByRole('spinbutton').fill('4');

  await page.getByRole('button', { name: 'Save view' }).click();
  const view = page.locator('.view-section').filter({ hasText: 'Design system view' });
  await expect(view.getByRole('heading', { name: 'Design system view' })).toBeVisible();

  await view.getByRole('button', { name: /^Edit / }).click();
  await expect(page.locator('.view-editor details.view-editor-section[open]')).toHaveCount(0);
  await openSection(page, 'Show in results');
  const reopenedCore = page.locator('.field-groups details').filter({ has: page.getByText('Core', { exact: true }) });
  await reopenedCore.locator(':scope > summary').click();
  await expect(page.locator('.field-groups').getByRole('checkbox', { name: /^Title/ })).toBeChecked();
  await openSection(page, 'Defaults for new items');
  await expect(page.locator('.creation-default-row').getByRole('spinbutton')).toHaveValue('4');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  if ((page.viewportSize()?.width ?? 0) > 620) await expect(view.getByRole('button', { name: /^Edit / })).toBeFocused();
});

test('view ordering uses drag handles and a keyboard alternative', async ({ page }) => {
  await createWorkspace(page);
  await page.getByRole('button', { name: 'New view' }).click();
  await openSection(page, 'Show in results');
  const rows = page.locator('.selected-fields > div');
  const labels = async () => await rows.locator('code').allTextContents();
  const initial = await labels();
  expect(initial.length).toBeGreaterThan(1);

  await page.getByRole('button', { name: `Reorder ${initial[0]}` }).press('ArrowDown');
  await expect.poll(labels).toEqual([initial[1], initial[0], ...initial.slice(2)]);

  const source = page.getByRole('button', { name: `Reorder ${initial[0]}` });
  const target = rows.first();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull(); expect(targetBox).not.toBeNull();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(labels).toEqual(initial);
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
