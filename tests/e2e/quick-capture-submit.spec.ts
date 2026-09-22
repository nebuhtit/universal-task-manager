import { expect, test } from '@playwright/test';

test('Enter and mobile beforeinput capture imperfect prose and repeated reminders', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(process.env.UTM_TEST_URL ?? '/');
  await page.getByLabel('Workspace name').fill('Capture regression');
  await page.getByLabel('Password', { exact: true }).fill('capture-regression-only');
  await page.getByLabel('Confirm password').fill('capture-regression-only');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  const input = page.getByPlaceholder('Add new item');
  await expect(input).toBeVisible({ timeout: 30_000 });
  for (const [text, expected, beforeInput] of [
    ['Пт 12 даша напомнить 1ч напомнить 1д', 'даша', false],
    ['Задача напомнить абракадабра', 'Задача напомнить абракадабра', false],
    ['Странный текст срок 99:88', 'Странный текст срок 99:88', true],
  ] as const) {
    await input.fill(text);
    if (beforeInput) await input.evaluate(el => el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertLineBreak' })));
    else await input.press('Enter');
    const editor = page.getByRole('dialog', { name: 'Item editor' });
    await expect(editor).toBeVisible();
    await expect(editor.getByLabel('Title', { exact: true })).toHaveValue(expected);
    await editor.getByRole('button', { name: 'Save item', exact: true }).click();
    await expect(editor).toHaveCount(0); await expect(input).toHaveValue('');
  }
});
