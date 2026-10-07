import { expect, test } from '@playwright/test';

test('indexed rr suggestions preserve selection and editing in light and dark', async ({ page }, info) => {
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('Indexed Live Text');
  await page.getByLabel('Password', { exact: true }).fill('index-test-password');
  await page.getByLabel('Confirm password').fill('index-test-password');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  const input = page.getByPlaceholder('Add new item');
  await input.fill('Work'); await input.press('Enter');
  const editor = page.getByRole('dialog', { name: 'Item editor', exact: true });
  await expect(editor).toBeVisible();
  const save = editor.getByRole('button', { name: 'Save item', exact: true });
  if (info.project.use.hasTouch) await save.tap(); else await save.click();
  await expect(editor).toBeHidden();
  for (const [command, colorScheme] of [['rr', 'light'], ['рр', 'dark']] as const) {
    await page.emulateMedia({ colorScheme });
    await input.fill(`Task ${command} Wo`);
    const option = page.getByRole('option', { name: /^Work/ });
    await expect(option).toBeVisible();
    if (info.project.use.hasTouch) await option.tap(); else await option.click();
    await expect(input).toBeFocused();
    await expect(input).not.toHaveValue(/item:/);
    await input.fill('Ordinary title');
    await expect(page.getByRole('option', { name: /^Work/ })).toHaveCount(0);
    const remove = page.getByRole('button', { name: 'Убрать связь: Work', exact: true });
    if (info.project.use.hasTouch) await remove.tap(); else await remove.click();
  }
});
