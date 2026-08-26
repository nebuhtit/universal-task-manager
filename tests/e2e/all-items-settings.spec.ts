import { expect, test } from '@playwright/test';

async function createWorkspace(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('Design system pilot');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  if ((page.viewportSize()?.width ?? 0) > 620) await page.locator('.sidebar').getByRole('button', { name: /^All items/ }).click();
  else {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.locator('.mobile-nav-menu').getByRole('button', { name: /^All items/ }).click();
  }
}

test('All Items settings uses accessible dialog behavior and preserves fields', async ({ page }) => {
  await createWorkspace(page);
  const trigger = page.getByRole('button', { name: 'Customize' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Customize all items' });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close all items settings' })).toBeVisible();

  const state = dialog.getByRole('checkbox', { name: /State/ });
  await expect(state).not.toBeChecked();
  await state.check();
  await page.waitForTimeout(1100);
  await expect(state).toBeChecked();
  await dialog.getByRole('button', { name: 'Save fields' }).click();
  await expect(dialog).toBeHidden();

  await trigger.click();
  await expect(dialog.getByRole('checkbox', { name: /State/ })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  if ((page.viewportSize()?.width ?? 0) > 620) await expect(trigger).toBeFocused();
  else await expect(trigger).toBeEnabled();
});

test('All Items settings remains scrollable and sheet-shaped on narrow screens', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) > 620, 'mobile contract');
  await page.emulateMedia({ colorScheme: 'dark' });
  await createWorkspace(page);
  await page.getByRole('button', { name: 'Customize' }).click();
  const dialog = page.getByRole('dialog', { name: 'Customize all items' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('border-bottom-left-radius', '0px');
  const content = dialog.locator('.ui-dialog-content');
  expect(await content.evaluate((element) => element.scrollHeight >= element.clientHeight)).toBeTruthy();
  const colors = await dialog.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color };
  });
  expect(colors.background).not.toBe(colors.color);
});
