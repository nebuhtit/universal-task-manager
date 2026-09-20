import { expect, test } from '@playwright/test';

test('formatted filter stays readable and can be copied in both themes', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('Code editor test');
  await page.getByLabel('Password', { exact: true }).fill('test-only-password');
  await page.getByLabel('Confirm password').fill('test-only-password');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await page.getByRole('button', { name: 'Edit Today', exact: true }).click();
  const visual = page.locator('.view-editor details.view-editor-section').filter({ has: page.getByText('Visual setup', { exact: true }) }).first();
  if (!await visual.evaluate((element) => (element as HTMLDetailsElement).open)) await visual.locator(':scope > summary').click();
  await visual.getByRole('button', { name: 'Code (Python-like)', exact: true }).click();
  const source = 'return (\n    state == "open" # current items\n    and isTemplate != True\n)';
  const input = visual.getByRole('textbox', { name: 'Filter code' });
  await input.fill(source);
  const editor = visual.locator('.syntax-python').first();
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => document.documentElement.dataset.theme = value, theme);
    await expect(editor.locator('pre')).toBeVisible();
    await expect(editor.locator('pre')).toHaveText(source);
    const colors = await editor.evaluate((element) => {
      const token = element.querySelector('.syntax-keyword')!;
      const textarea = element.querySelector('textarea')!;
      return { keyword: getComputedStyle(token).color, text: getComputedStyle(element).color, background: getComputedStyle(textarea).backgroundColor };
    });
    expect(colors.keyword).not.toBe(colors.text);
    expect(colors.background).toBe('rgba(0, 0, 0, 0)');
    await editor.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(source);
  }
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Today', exact: true }).click();
  if (!await visual.evaluate((element) => (element as HTMLDetailsElement).open)) await visual.locator(':scope > summary').click();
  await visual.getByRole('button', { name: 'Code (Python-like)', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Filter code' })).toHaveValue(source);
});
