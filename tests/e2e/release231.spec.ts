import { expect, test } from '@playwright/test';

test('long PARA titles fit and appearance date preference persists', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('Layout check');
  await page.getByLabel('Password', { exact: true }).fill('release-test-password');
  await page.getByLabel('Confirm password').fill('release-test-password');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  const navigate = async (name: string) => {
    if ((page.viewportSize()?.width ?? 0) > 620) await page.locator('.sidebar').getByRole('button', { name, exact: true }).click();
    else { await page.getByRole('button', { name: 'Open navigation' }).click(); await page.locator('.mobile-nav-menu').getByRole('button', { name, exact: true }).click(); }
  };
  await navigate('PARA');
  const title = 'C.A very long calendar title for testing wrapping and navigation';
  await page.getByRole('textbox', { name: 'New tag', exact: true }).fill(title);
  await page.getByRole('button', { name: 'Add Tag', exact: true }).click();
  await page.locator('.organization-tag-entry').filter({ hasText: title }).first().click();
  await expect(page.locator('.organization-detail-header')).toContainText(title);
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await page.locator('.organization-detail-header').evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const heading = await page.locator('.organization-detail-page .view-section-title').boundingBox();
    const actions = await page.locator('.organization-detail-page .view-section-actions').boundingBox();
    expect(actions!.y).toBeGreaterThanOrEqual(heading!.y + heading!.height);
    await page.screenshot({ path: test.info().outputPath(`para-${theme}.png`) });
  }
  await page.getByRole('button', { name: '‹ PARA', exact: true }).click();
  await navigate('Settings');
  await page.getByText('Appearance and sounds', { exact: true }).click();
  const format = page.getByLabel('Header date format');
  await expect(format).toHaveValue('ru-adaptive');
  await format.selectOption('numeric');
  await expect(page.locator('.responsive-clock > span').first()).toHaveText(/^\d{2}\.\d{2}(?:\.\d{4})?, /);
  await navigate('Home'); await navigate('Settings');
  await expect(format).toHaveValue('numeric');
});

test('text program validates, switches modes and saves; home controls remain compact', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('Release 231');
  await page.getByLabel('Password', { exact: true }).fill('release-test-password');
  await page.getByLabel('Confirm password').fill('release-test-password');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  const clock = page.locator('.responsive-clock > span').first();
  await expect(clock).not.toHaveText(/\d+\/\d+/);
  const home = page.locator('.home-view').first();
  if (await home.locator('.view-section-title').getAttribute('aria-expanded') === 'true') await home.locator('.view-section-title').click();
  await expect(home.locator('.view-section-reorder')).toBeVisible();
  await expect(home.locator('.view-metrics-summary')).toHaveCount(0);
  await home.locator('.view-section-title').click();
  await expect(home.locator('.view-section-reorder')).toHaveCount(0);
  await expect(home.getByText('No items match this view.')).toBeHidden();
  await page.getByPlaceholder('Add new item').fill('Text workshop');
  await page.getByPlaceholder('Add new item').press('Enter');
  const editor = page.getByRole('dialog', { name: 'Item editor', exact: true });
  const dates = editor.locator('[data-editor-section="dates"]');
  await dates.locator(':scope > summary').click();
  await editor.getByLabel('Event opens', { exact: true }).fill('2030-09-21T17:00');
  await editor.getByLabel('Event ends', { exact: true }).fill('2030-09-22T10:00');
  const program = dates.locator('.event-program');
  await program.locator(':scope > summary').click();
  await program.getByRole('button', { name: 'Text', exact: true }).click();
  const code = program.getByRole('textbox', { name: 'Program text' });
  await code.fill('17:00–17:45 Lesson\n18:15–21:00 Tea\n+1 09:00–10:00 Breakfast');
  await code.fill('17:00–17:45 Lesson\nWrong');
  await expect(program.getByRole('alert')).toContainText('Line 2');
  await editor.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(editor).toBeVisible();
  await code.fill('17:00–17:45 Lesson\n18:15–21:00 Tea\n+1 09:00–10:00 Breakfast');
  await program.getByRole('button', { name: 'Blocks', exact: true }).click();
  await expect(program.locator('.program-block')).toHaveCount(3);
  await expect(program.getByLabel('Start day 3', { exact: true })).toHaveValue('1');
  await expect(program.locator('.schedule-explainer').first()).toBeHidden();
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(program.getByRole('button', { name: 'Add block', exact: true })).toHaveCSS('color', theme === 'dark' ? 'rgb(241, 241, 241)' : 'rgb(13, 13, 13)');
    expect(await editor.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`program-text-${theme}.png`) });
  }
  await editor.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(editor).toBeHidden();
  await page.getByText('Text workshop', { exact: true }).first().click();
  if (await dates.getAttribute('open') === null) await dates.locator(':scope > summary').click();
  await program.locator(':scope > summary').click();
  await program.getByRole('button', { name: 'Text', exact: true }).click();
  await expect(code).toHaveValue('17:00–17:45 Lesson\n18:15–21:00 Tea\n+1 09:00–10:00 Breakfast');
  await expect(editor.locator('.item-script-row')).toHaveCount(1);
  await dates.locator('summary').filter({ hasText: 'Progress & completions' }).click();
  const journal = dates.locator('.item-journals');
  await journal.getByRole('button', { name: 'Add completion', exact: true }).click();
  await journal.getByLabel('Minutes', { exact: true }).fill('12');
  await journal.getByLabel('Comment', { exact: true }).fill('One recorded session');
  await journal.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(journal.locator('.item-journal-entry')).toHaveCount(1);
  await expect(journal.locator('.item-journal-entry')).toContainText('0:12:00');
  await expect(journal.locator('.item-journal-entry').getByRole('button', { name: 'Edit', exact: true })).toHaveCount(1);
  await expect(editor.locator('[data-editor-section="history"]')).toHaveCount(0);
  await editor.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(editor).toBeHidden();
});
