import { expect, test } from '@playwright/test';

test('PARA keeps at least one result type visible and remembers both filters', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('PARA filter check');
  await page.getByLabel('Password', { exact: true }).fill('test-only-para-password');
  await page.getByLabel('Confirm password').fill('test-only-para-password');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  if ((page.viewportSize()?.width ?? 0) > 620) await page.locator('.sidebar').getByRole('button', { name: 'PARA', exact: true }).click();
  else { await page.getByRole('button', { name: 'Open navigation', exact: true }).click(); await page.locator('.mobile-nav-menu').getByRole('button', { name: 'PARA', exact: true }).click(); }
  await page.locator('.organization-area-groups').getByRole('button', { name: 'No Area', exact: true }).click();
  const filters = page.locator('.organization-scope-filters').first();
  const completable = filters.getByRole('button', { name: 'Completable items' });
  const other = filters.getByRole('button', { name: 'Other items and events' });
  await expect(completable).toHaveAttribute('aria-pressed', 'true');
  await expect(other).toHaveAttribute('aria-pressed', 'false');
  await completable.click();
  await expect(completable).toHaveAttribute('aria-pressed', 'true');
  await other.click();
  await expect(other).toHaveAttribute('aria-pressed', 'true');
  await completable.click();
  await expect(completable).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: '‹ PARA', exact: true }).click();
  await page.locator('.organization-area-groups').getByRole('button', { name: 'No Area', exact: true }).click();
  await expect(filters.getByRole('button', { name: 'Completable items' })).toHaveAttribute('aria-pressed', 'false');
  await expect(filters.getByRole('button', { name: 'Other items and events' })).toHaveAttribute('aria-pressed', 'true');
});
