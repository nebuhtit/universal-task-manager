import { expect, test, type Page } from '@playwright/test';

async function navigate(page: Page, name: string) {
  if ((page.viewportSize()?.width ?? 0) > 620) await page.locator('.sidebar').getByRole('button', { name, exact: true }).click();
  else { await page.getByRole('button', { name: 'Open navigation', exact: true }).click(); await page.locator('.mobile-nav-menu').getByRole('button', { name, exact: true }).click(); }
}

test('project links survive reload and open PARA without completion controls', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('Project links');
  await page.getByLabel('Password', { exact: true }).fill('test-only-project-password');
  await page.getByLabel('Confirm password').fill('test-only-project-password');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await navigate(page, 'PARA');
  await page.getByLabel('New Area', { exact: true }).fill('Work');
  await page.getByRole('button', { name: 'Add Area', exact: true }).click();
  const group = page.locator('.organization-area-group').filter({ hasText: 'Work' });
  await group.locator(':scope > summary').click();
  await group.getByLabel('New Project in Work').fill('Launch');
  await group.getByRole('button', { name: 'Add Project', exact: true }).click();
  await group.getByRole('button', { name: 'Launch', exact: true }).click();
  const quick = page.getByLabel('Quick add item to launch');
  await quick.fill('Launch task'); await quick.press('Enter');
  await page.getByRole('button', { name: 'Save item', exact: true }).click();
  await navigate(page, 'Home');
  await page.getByRole('button', { name: 'Edit All items', exact: true }).click();
  await page.getByText('Visual setup', { exact: true }).click();
  await page.getByLabel('Result types', { exact: true }).selectOption('project');
  const projectFilter = page.locator('.filter-program').first();
  await projectFilter.getByRole('button', { name: 'Condition', exact: true }).click();
  await projectFilter.getByLabel('Operator', { exact: true }).selectOption('==');
  await projectFilter.getByText('Choose values…', { exact: true }).click();
  await projectFilter.getByRole('checkbox', { name: 'Launch', exact: true }).check();
  await projectFilter.getByRole('button', { name: 'Code (Python-like)', exact: true }).click();
  await expect(projectFilter.getByLabel('Filter code', { exact: true })).toHaveValue(/Launch/);
  await projectFilter.getByRole('button', { name: 'Blocks', exact: true }).click();
  await expect(projectFilter.getByLabel('Property', { exact: true })).toHaveValue('project');
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  const link = page.getByRole('button', { name: 'Open project Launch', exact: true });
  await expect(link).toBeVisible();
  await expect(link).toContainText('For this view');
  await link.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.organization-detail-header').getByRole('heading', { name: 'Launch', exact: true })).toBeVisible();
  await page.reload();
  await page.getByLabel('Password', { exact: true }).fill('test-only-project-password');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(link).toBeVisible();
  for (const renderer of ['table', 'board']) {
    await page.getByRole('button', { name: 'Edit All items', exact: true }).click();
    await page.getByLabel('Renderer', { exact: true }).selectOption(renderer);
    await page.getByRole('button', { name: 'Save view', exact: true }).click();
    await expect(link).toBeVisible();
    await expect(page.getByRole('button', { name: 'Complete Launch', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(link).toBeVisible();
  await link.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: `/tmp/utm-project-${test.info().project.name}.png`, fullPage: true });
});
