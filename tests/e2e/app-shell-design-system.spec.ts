import { expect, test, type Page } from '@playwright/test';

async function createWorkspace(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('App shell design system');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
}

test('top actions share control geometry and the clock stays centered when space allows', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) <= 950, 'desktop contract');
  await createWorkspace(page);
  const topbar = page.locator('.topbar');
  const actions = [
    page.getByRole('button', { name: 'New view' }),
    page.getByRole('button', { name: 'Notifications' }),
  ];
  const sizes = await Promise.all(actions.map((action) => action.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  })));
  expect(new Set(sizes.map(({ width, height }) => `${width}:${height}`)).size).toBe(1);

  const [barBox, clockBox] = await Promise.all([topbar.boundingBox(), page.locator('.top-summary').boundingBox()]);
  expect(barBox).not.toBeNull();
  expect(clockBox).not.toBeNull();
  expect(Math.abs((clockBox!.x + clockBox!.width / 2) - (barBox!.x + barBox!.width / 2))).toBeLessThan(2);
});

test('mobile navigation and notification center remain usable without overlap', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) > 620, 'mobile contract');
  await page.emulateMedia({ colorScheme: 'dark' });
  await createWorkspace(page);

  const clock = page.locator('.top-summary');
  const actions = page.locator('.top-actions');
  const [clockBox, actionsBox] = await Promise.all([clock.boundingBox(), actions.boundingBox()]);
  expect(clockBox).not.toBeNull();
  expect(actionsBox).not.toBeNull();
  expect(clockBox!.x + clockBox!.width).toBeLessThanOrEqual(actionsBox!.x + 1);

  await page.getByRole('button', { name: 'Open navigation' }).click();
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(navigation).toBeVisible();
  await navigation.getByRole('button', { name: /Settings/ }).click();
  await expect(navigation).toBeHidden();

  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  const center = page.getByRole('complementary', { name: 'Notification center' });
  await expect(center).toBeVisible();
  await expect(center).toHaveCSS('overflow-y', 'auto');
  await center.getByRole('button', { name: 'Close notification center' }).click();
  await expect(center).toBeHidden();
});
