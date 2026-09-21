import { expect, test } from '@playwright/test';

test('one quick timer session becomes one completion and reaches a count goal', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('Completion goals');
  await page.getByLabel('Password', { exact: true }).fill('completion-test-password');
  await page.getByLabel('Confirm password').fill('completion-test-password');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await page.getByPlaceholder('Add new item').fill('Timed practice');
  await page.getByPlaceholder('Add new item').press('Enter');
  const editor = page.getByRole('dialog', { name: 'Item editor', exact: true });
  const dates = editor.locator('[data-editor-section="dates"]');
  await dates.locator(':scope > summary').click();
  await dates.locator('summary').filter({ hasText: 'Progress & completions' }).click();
  await editor.getByLabel('Completion goal').fill('1');
  const timer = editor.getByLabel('Quick timer and stopwatch', { exact: true });
  await timer.locator('summary').click();
  await timer.getByRole('button', { name: 'Start', exact: true }).click();
  await page.waitForTimeout(1300);
  await timer.getByRole('button', { name: 'Stop', exact: true }).click();
  await timer.getByRole('button', { name: 'Save completion', exact: true }).click();
  await expect(timer.getByRole('button', { name: 'Completion saved', exact: true })).toBeDisabled();
  await expect(dates.getByText('Goal done', { exact: false })).toBeVisible();
  await expect(dates.locator('.item-journal-entry')).toHaveCount(1);
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    expect(await editor.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  }
  await editor.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(editor).toBeHidden();
  if ((page.viewportSize()?.width ?? 0) > 620) await page.locator('.sidebar').getByRole('button', { name: /^All items/ }).click();
  else { await page.getByRole('button', { name: 'Open navigation' }).click(); await page.locator('.mobile-nav-menu').getByRole('button', { name: /^All items/ }).click(); }
  const openCompleted = async () => {
    const section = page.getByText('Completed', { exact: true }).last().locator('xpath=../..');
    if (!(await section.evaluate((node) => node.hasAttribute('open')))) await section.locator(':scope > summary').click();
  };
  await openCompleted();
  await page.locator('.item-card').filter({ hasText: 'Timed practice' }).getByRole('button', { name: /Timed practice/ }).click();
  await expect(editor).toBeVisible();
  await dates.locator(':scope > summary').click();
  await dates.locator('summary').filter({ hasText: 'Progress & completions' }).click();
  await expect(dates.locator('.item-journal-entry')).toHaveCount(1);
  await expect(dates.getByText('Goal done', { exact: false })).toBeVisible();
  await timer.locator('summary').click();
  await timer.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(timer.locator('output')).not.toHaveText('10:00');
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.reload();
  await page.getByLabel('Password', { exact: true }).fill('completion-test-password');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  if ((page.viewportSize()?.width ?? 0) > 620) await page.locator('.sidebar').getByRole('button', { name: /^All items/ }).click();
  else { await page.getByRole('button', { name: 'Open navigation' }).click(); await page.locator('.mobile-nav-menu').getByRole('button', { name: /^All items/ }).click(); }
  await openCompleted();
  await page.locator('.item-card').filter({ hasText: 'Timed practice' }).getByRole('button', { name: /Timed practice/ }).click();
  await timer.locator('summary').click();
  await expect(timer.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await timer.getByRole('button', { name: 'Stop', exact: true }).click();
  await timer.getByRole('button', { name: 'Save completion', exact: true }).click();
  await dates.locator(':scope > summary').click();
  await dates.locator('summary').filter({ hasText: 'Progress & completions' }).click();
  await expect(dates.locator('.item-journal-entry')).toHaveCount(2);
  await expect(dates.getByText('Goal done', { exact: false })).toContainText('+1');
  await editor.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(editor).toBeHidden();
  await page.reload();
  await page.getByLabel('Password', { exact: true }).fill('completion-test-password');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  if ((page.viewportSize()?.width ?? 0) > 620) await page.locator('.sidebar').getByRole('button', { name: /^All items/ }).click();
  else { await page.getByRole('button', { name: 'Open navigation' }).click(); await page.locator('.mobile-nav-menu').getByRole('button', { name: /^All items/ }).click(); }
  await openCompleted();
  await page.locator('.item-card').filter({ hasText: 'Timed practice' }).getByRole('button', { name: /Timed practice/ }).click();
  await dates.locator(':scope > summary').click();
  await dates.locator('summary').filter({ hasText: 'Progress & completions' }).click();
  await expect(dates.locator('.item-journal-entry')).toHaveCount(2);
  await expect(dates.getByText('Goal done', { exact: false })).toContainText('+1');
});
