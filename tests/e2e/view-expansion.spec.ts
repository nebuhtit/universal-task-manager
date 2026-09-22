import { expect, test } from '@playwright/test';

test('All items stays collapsed or expanded after navigation and reopening', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-22T12:00:00Z') });
  await page.goto(process.env.UTM_TEST_URL ?? '/');
  await page.getByLabel('Workspace name').fill('Expansion');
  await page.getByLabel('Password', { exact: true }).fill('expansion-test-password');
  await page.getByLabel('Confirm password').fill('expansion-test-password');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  const section = page.locator('.view-section').filter({ has: page.getByRole('heading', { name: 'All items', exact: true }) });
  const toggle = section.locator('.view-section-title');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  for (const name of ['Calendar', 'Home']) {
    if ((page.viewportSize()?.width ?? 0) <= 620) {
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await page.locator('.mobile-nav-menu').getByRole('button', { name, exact: true }).click();
    } else await page.locator('.sidebar').getByRole('button', { name, exact: true }).click();
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.clock.fastForward(11_000);
  for (const expanded of [false, true]) {
    await page.reload();
    await page.getByLabel('Password', { exact: true }).fill('expansion-test-password');
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(toggle).toHaveAttribute('aria-expanded', String(expanded));
    if (!expanded) {
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await page.clock.fastForward(11_000);
    }
  }
});
