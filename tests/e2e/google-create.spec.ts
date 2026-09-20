import { expect, test } from '@playwright/test';

test('edits one Google occurrence with conflict recovery and keeps local journals', async ({ page }) => {
  test.setTimeout(120_000);
  let patches = 0;
  const start = new Date(Date.now() + 30 * 60000).toISOString();
  let remote = { id: 'instance', recurringEventId: 'master', summary: 'Editable meeting', etag: 'v1', start: { dateTime: start, timeZone: 'UTC' }, end: { dateTime: new Date(Date.parse(start) + 3600000).toISOString(), timeZone: 'UTC' }, htmlLink: 'https://calendar.google.com/event?eid=test', description: '' };
  await page.addInitScript(() => { (window as any).google = { accounts: { oauth2: { initTokenClient: (options: any) => ({ requestAccessToken: () => options.callback({ access_token: 'test', expires_in: 3600, scope: options.scope }) }) } } }; });
  await page.route('https://www.googleapis.com/calendar/v3/**', async (route) => {
    const request = route.request();
    if (request.url().includes('calendarList')) return route.fulfill({ json: { items: [{ id: 'test@example.com', primary: true, summary: 'Calendar', accessRole: 'owner', timeZone: 'UTC' }] } });
    if (request.method() === 'PATCH') {
      patches++; expect(request.headers()['if-match']).toBe(remote.etag);
      expect(request.postDataJSON()).toEqual({ summary: 'Changed in UTM' });
      remote = { ...remote, ...request.postDataJSON(), etag: 'v3' };
      return route.abort('failed');
    }
    if (request.url().includes('/events/instance')) return route.fulfill({ json: remote });
    if (request.url().includes('/events/master')) return route.fulfill({ json: { ...remote, id: 'master' } });
    return route.fulfill({ json: { items: [remote], nextSyncToken: 'sync' } });
  });
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('Journals and editing');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  const navigate = async (name: string) => { if ((page.viewportSize()?.width ?? 0) <= 620) { await page.getByRole('button', { name: 'Open navigation' }).click(); await page.locator('.mobile-nav-menu').getByRole('button', { name, exact: true }).click(); } else await page.locator('.sidebar').getByRole('button', { name, exact: true }).click(); };
  await navigate('Settings'); await page.getByText('Calendar and Google Calendar', { exact: true }).click(); await page.getByRole('button', { name: 'Connect Google Calendar', exact: true }).click(); await expect(page.getByRole('button', { name: 'Sync now', exact: true })).toBeVisible();
  await navigate('Calendar'); await page.getByText('Editable meeting', { exact: true }).first().click();
  const properties = page.getByRole('dialog', { name: 'Google Calendar properties', exact: true });
  await properties.locator('summary').filter({ hasText: 'Actual time' }).click();
  await properties.getByRole('button', { name: 'Add time entry' }).click();
  await properties.getByLabel('Minutes', { exact: true }).fill('25'); await properties.getByLabel('Comment', { exact: true }).fill('Measured preparation');
  await properties.getByRole('button', { name: 'Apply entry' }).click(); await expect(properties.getByText('Measured preparation', { exact: true })).toBeVisible();
  await properties.getByRole('button', { name: 'Edit event', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit Google event', exact: true });
  await edit.getByRole('button', { name: 'Load event for editing' }).click();
  await edit.getByLabel('Title', { exact: true }).fill('Changed in UTM');
  await edit.getByRole('button', { name: 'Preview changes' }).click();
  remote = { ...remote, etag: 'v2', description: 'Edited on another device' };
  await edit.getByRole('button', { name: 'Save in Google', exact: true }).click();
  await expect(edit.getByRole('alert')).toContainText('changed in Google'); expect(patches).toBe(0);
  await edit.getByRole('button', { name: 'Load current event; keep my draft' }).click();
  await expect(edit.getByLabel('Title', { exact: true })).toHaveValue('Changed in UTM');
  // Keep the independently changed description while retaining our title edit.
  await expect(edit.getByLabel('Description', { exact: true })).toHaveValue('Edited on another device');
  await edit.getByRole('button', { name: 'Preview changes' }).click();
  for (const colorScheme of ['light', 'dark'] as const) { await page.emulateMedia({ colorScheme }); await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, colorScheme); await page.screenshot({ animations: 'disabled', path: test.info().outputPath(`google-edit-${colorScheme}.png`) }); expect((await edit.boundingBox())!.width).toBeLessThanOrEqual(page.viewportSize()!.width); }
  await edit.getByRole('button', { name: 'Save in Google', exact: true }).click(); await expect(edit.getByRole('alert')).toBeVisible();
  await edit.getByRole('button', { name: 'Check / retry save' }).click(); await expect(edit).toBeHidden(); expect(patches).toBe(1);
  await page.getByText('Changed in UTM', { exact: true }).first().click();
  await properties.locator('summary').filter({ hasText: 'Actual time' }).click(); await expect(properties.getByText('Measured preparation', { exact: true })).toBeVisible();
  await properties.getByRole('button', { name: 'Close', exact: true }).click();
  await navigate('Home'); await page.getByPlaceholder('Add new item').fill('Journal task'); await page.getByPlaceholder('Add new item').press('Enter');
  const itemEditor = page.getByRole('dialog', { name: 'Item editor', exact: true });
  await itemEditor.locator('summary').filter({ hasText: /^History/ }).click();
  await itemEditor.locator('summary').filter({ hasText: 'Actual time' }).click(); await itemEditor.getByRole('button', { name: 'Add time entry' }).click();
  await itemEditor.getByLabel('Hours', { exact: true }).fill('1'); await itemEditor.getByLabel('Minutes', { exact: true }).fill('5'); await itemEditor.getByLabel('Comment', { exact: true }).fill('Focused work'); await itemEditor.getByRole('button', { name: 'Apply entry' }).click();
  await itemEditor.locator('summary').filter({ hasText: 'Completions' }).click(); await itemEditor.getByRole('button', { name: 'Add completion entry' }).click(); await itemEditor.getByLabel('Comment', { exact: true }).fill('Reviewed outcome'); await itemEditor.getByRole('button', { name: 'Apply entry' }).click();
  await itemEditor.getByRole('button', { name: 'Save item', exact: true }).click();
  await page.getByText('Journal task', { exact: true }).first().click();
  const history = itemEditor.locator('summary').filter({ hasText: /^History/ });
  if (!await history.evaluate((element) => element.parentElement?.hasAttribute('open'))) await history.click();
  await itemEditor.locator('summary').filter({ hasText: 'Actual time' }).click(); await expect(itemEditor.getByText('Focused work', { exact: true })).toBeVisible();
  await itemEditor.locator('summary').filter({ hasText: 'Completions' }).click(); await expect(itemEditor.getByText('Reviewed outcome', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(itemEditor).toBeHidden();
});

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
  await page.screenshot({ animations: 'disabled', path: test.info().outputPath('google-preview-light.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ animations: 'disabled', path: test.info().outputPath('google-preview-dark.png') });
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
