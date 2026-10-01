import { expect, test } from '@playwright/test';

test('touch completion commits once after release and reopening leaves the neighbour unchanged', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('Completion gesture');
  await page.getByLabel('Password', { exact: true }).fill('test-password-123');
  await page.getByLabel('Confirm password').fill('test-password-123');
  await page.getByRole('button', { name: 'Create encrypted workspace', exact: true }).click();
  for (const title of ['Gesture first', 'Gesture neighbour']) {
    const input = page.getByPlaceholder('Add new item', { exact: true });
    await input.fill(title); await input.press('Enter');
    const editor = page.getByRole('dialog', { name: 'Item editor' });
    await editor.getByRole('button', { name: 'Save item', exact: true }).click();
    await expect(editor).toBeHidden();
  }
  const first = page.locator('.item-card').filter({ hasText: 'Gesture first' }).first();
  const neighbour = page.locator('.item-card').filter({ hasText: 'Gesture neighbour' }).first();
  const toggle = first.locator('.state-toggle');
  await toggle.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 1, button: 0 });
  await expect(first).toHaveClass(/state-open/);
  await toggle.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 1, button: 0 });
  await toggle.dispatchEvent('click', { detail: 1 });
  await expect(first).toHaveClass(/state-done/);
  await toggle.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 2, button: 0 });
  await expect(first).toHaveClass(/state-done/);
  await toggle.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 2, button: 0 });
  await toggle.dispatchEvent('click', { detail: 1 });
  await expect(first).toHaveClass(/state-open/);
  await expect(neighbour).toHaveClass(/state-open/);
});
