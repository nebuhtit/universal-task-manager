import { expect, test } from '@playwright/test';

test('Enter creates an item with an explicit start and clock-only due', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('Due clock');
  await page.getByLabel('Password', { exact: true }).fill('due-clock-password');
  await page.getByLabel('Confirm password').fill('due-clock-password');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  const input = page.getByPlaceholder('Add new item');
  await input.fill('На залив завтра 09:00 срок 18');
  const options = page.getByRole('listbox', { name: 'Подсказки Live text' });
  await expect(options.getByRole('option', { name: /^срок 18:00/ })).toBeVisible();
  await input.fill('На залив завтра 09:00 срок 18:00');
  await input.press('Enter');
  const editor = page.getByRole('dialog', { name: 'Item editor', exact: true });
  await expect(editor).toBeVisible();
  await expect(input).toHaveValue('');
  await editor.locator('[data-editor-section="dates"] > summary').click();
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const datePrefix = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  await expect(editor.getByLabel('Event opens', { exact: true })).toHaveValue(`${datePrefix}T09:00`);
  await expect(editor.getByLabel('Due / Active range ends', { exact: true })).toHaveValue(`${datePrefix}T18:00`);
});
