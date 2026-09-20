import { expect, test } from '@playwright/test';

test('creates one Google copy after preview and recovers a lost response', async ({ page }) => {
  test.setTimeout(120_000);
  let inserts = 0;
  let created: Record<string, unknown> | undefined;
  await page.addInitScript(() => {
    (window as any).google = { accounts: { oauth2: { initTokenClient: (options: any) => ({ requestAccessToken: () => options.callback({ access_token: 'test-token', expires_in: 3600, scope: options.scope }) }) } } };
  });
  await page.route('https://www.googleapis.com/calendar/v3/**', async (route) => {
    const request = route.request(); const url = request.url();
    if (url.includes('/calendarList?')) return route.fulfill({ json: { items: [{ id: 'test@example.com', primary: true, summary: 'Test calendar', accessRole: 'owner' }] } });
    if (request.method() === 'POST') {
      inserts++;
      if (!created) { created = request.postDataJSON(); return route.abort('failed'); }
      expect(request.postDataJSON().id).toBe(created.id);
      return route.fulfill({ status: 409, json: {} });
    }
    if (/\/events\/utm/.test(url)) return route.fulfill({ json: { ...created, status: 'confirmed', htmlLink: 'https://calendar.google.com/event?eid=test' } });
    return route.fulfill({ json: { items: [], nextSyncToken: 'test-sync' } });
  });
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('Google creation test');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  const navigate = async (name: string) => {
    if ((page.viewportSize()?.width ?? 0) <= 620) { await page.getByRole('button', { name: 'Open navigation' }).click(); await page.locator('.mobile-nav-menu').getByRole('button', { name, exact: true }).click(); }
    else await page.locator('.sidebar').getByRole('button', { name, exact: true }).click();
  };
  await navigate('Settings');
  await page.getByText('Calendar and Google Calendar', { exact: true }).click();
  await page.getByRole('button', { name: 'Connect Google Calendar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sync now', exact: true })).toBeVisible();
  await navigate('Home');
  await page.getByPlaceholder('Add new item').fill('Create from UTM');
  await page.getByPlaceholder('Add new item').press('Enter');
  await page.getByRole('button', { name: 'Save item', exact: true }).click();
  await page.getByText('Create from UTM', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Create Google Calendar copy', exact: true }).click();
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Create Google Calendar copy' }) });
  await dialog.getByRole('button', { name: 'Authorize event creation' }).click();
  await dialog.getByLabel('Title', { exact: true }).fill('One Google meeting');
  await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
  expect(inserts).toBe(0);
  await expect(dialog.getByText('One Google meeting', { exact: true })).toBeVisible();
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: test.info().outputPath('google-preview-light.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: test.info().outputPath('google-preview-dark.png') });
  await dialog.getByRole('button', { name: 'Create in Google Calendar', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.reload();
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.getByText('Create from UTM', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Create Google Calendar copy', exact: true }).click();
  await dialog.getByRole('button', { name: 'Authorize event creation' }).click();
  await expect(dialog.getByText('One Google meeting', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Check / retry creation' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Event created and added to UTM.');
  expect(inserts).toBe(2);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Item editor' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Item editor' })).not.toBeVisible();
  await navigate('Calendar');
  await page.getByText('One Google meeting', { exact: true }).first().click();
  const properties = page.getByRole('dialog', { name: 'Google Calendar properties', exact: true });
  await expect(properties).toBeVisible();
  await expect(properties.getByText('Event opens', { exact: true })).toBeVisible();
  await expect(properties.getByText('Event ends', { exact: true })).toBeVisible();
  await expect(properties.getByRole('link', { name: 'Open in Google Calendar' })).toHaveAttribute('href', 'https://calendar.google.com/event?eid=test');
  expect(page.context().pages()).toHaveLength(1);
});
