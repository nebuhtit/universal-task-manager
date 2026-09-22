import { expect, test } from '@playwright/test';

test('queues offline saves, retries silently, colors calendars and applies PARA bindings', async ({ page }) => {
  test.setTimeout(120_000);
  let inserts = 0; let name = 'Work calendar'; let color = '#345678'; let remote: any;
  await page.addInitScript(() => { (window as any).authCount = 0; (window as any).google = { accounts: { oauth2: { initTokenClient: (options: any) => ({ requestAccessToken: () => { (window as any).authCount++; options.callback({ access_token: 'test', expires_in: 3600, scope: options.scope }); } }) } } }; });
  await page.route('https://www.googleapis.com/calendar/v3/**', async (route) => {
    if (route.request().url().includes('calendarList')) return route.fulfill({ json: { items: [{ id: 'test@example.com', primary: true, summary: name, backgroundColor: color, accessRole: 'owner', timeZone: 'UTC' }] } });
    if (route.request().method() === 'POST') { inserts++; if (inserts === 1) return route.abort('failed'); remote = { ...route.request().postDataJSON(), etag: 'v1' }; return route.fulfill({ json: remote }); }
    return route.fulfill({ json: { items: remote ? [remote] : [], nextSyncToken: 'sync' } });
  });
  await page.goto('/'); await page.getByLabel('Workspace name').fill('Outbox'); await page.getByLabel('Password', { exact: true }).fill('test-only-outbox-password'); await page.getByLabel('Confirm password').fill('test-only-outbox-password'); await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  const nav = async (name: string) => { if (page.viewportSize()!.width <= 620) { await page.getByRole('button', { name: 'Open navigation' }).click(); await page.locator('.mobile-nav-menu').getByRole('button', { name, exact: true }).click(); } else await page.locator('.sidebar').getByRole('button', { name, exact: true }).click(); };
  await nav('PARA'); await page.getByLabel('New Area', { exact: true }).fill('Office'); await page.getByRole('button', { name: 'Add Area', exact: true }).click();
  await nav('Settings'); await page.getByText('Calendar and Google Calendar', { exact: true }).click(); await page.getByRole('button', { name: 'Connect Google Calendar', exact: true }).click(); await expect(page.getByRole('button', { name: 'Sync now', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Beta: edit events older than three hours' })).not.toBeChecked();
  await page.getByText('Google data protection', { exact: true }).click();
  await expect(page.getByLabel('Changes per 24 hours', { exact: true })).toHaveValue('25');
  await expect(page.getByLabel('Per synchronization', { exact: true })).toHaveValue('5');
  await page.getByLabel('Changes per 24 hours', { exact: true }).fill('1');
  await page.getByText('Work calendar · PARA', { exact: true }).click(); await page.locator('summary').filter({ hasText: /^Areas ·/ }).click(); await page.getByRole('checkbox', { name: 'Office', exact: true }).check();
  await nav('Home'); await page.getByPlaceholder('Add new item').fill('Offline event'); await page.getByPlaceholder('Add new item').press('Enter');
  const editor = page.getByRole('dialog', { name: 'Item editor', exact: true });
  await editor.locator('[data-editor-section="dates"] > summary').click(); await editor.getByLabel('Event opens', { exact: true }).fill('2030-09-23T12:00'); await editor.getByRole('button', { name: 'Save item', exact: true }).click(); await expect(editor).toBeHidden(); expect(inserts).toBe(1);
  const authorizations = await page.evaluate(() => (window as any).authCount);
  await page.getByPlaceholder('Add new item').fill('Unrelated task'); await page.getByPlaceholder('Add new item').press('Enter'); await editor.getByRole('button', { name: 'Save item', exact: true }).click(); await expect(editor).toBeHidden(); await expect.poll(() => inserts).toBe(2);
  expect(await page.evaluate(() => (window as any).authCount)).toBe(authorizations);
  await expect(page.locator('.external-calendar-state-marker').first()).toHaveCSS('color', 'rgb(52, 86, 120)');
  await page.getByPlaceholder('Add new item').fill('Quota protected'); await page.getByPlaceholder('Add new item').press('Enter');
  await editor.locator('[data-editor-section="dates"] > summary').click(); await editor.getByLabel('Event opens', { exact: true }).fill('2030-09-24T12:00'); await editor.getByRole('button', { name: 'Save item', exact: true }).click(); await expect(editor).toBeHidden();
  await expect(page.getByText(/Saved in UTM, waiting for sync/)).toBeVisible(); expect(inserts).toBe(2);
  name = 'Renamed calendar'; color = '#987654'; await page.getByRole('button', { name: 'Google Calendar sync', exact: true }).click(); await expect(page.getByRole('button', { name: 'UTM + Google Calendar', exact: true })).toHaveCSS('color', 'rgb(152, 118, 84)'); expect(inserts).toBe(2);
  await nav('PARA'); await page.getByRole('button', { name: 'Office', exact: true }).first().click(); await expect(page.getByText('Offline event', { exact: true })).toBeVisible();
  for (const theme of ['light', 'dark'] as const) { await page.emulateMedia({ colorScheme: theme }); await page.screenshot({ path: test.info().outputPath(`outbox-para-${theme}.png`) }); }
});

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
  const navigate = async (name: string) => { if ((page.viewportSize()?.width ?? 0) <= 620) { await page.getByRole('button', { name: 'Open navigation' }).click(); await page.locator('.mobile-nav-menu').getByRole('button', { name: name === 'All items' ? /^All items/ : name, exact: name !== 'All items' }).click(); } else await page.locator('.sidebar').getByRole('button', { name: name === 'All items' ? /^All items/ : name, exact: name !== 'All items' }).click(); };
  await navigate('Settings'); await page.getByText('Calendar and Google Calendar', { exact: true }).click(); await page.getByRole('button', { name: 'Connect Google Calendar', exact: true }).click(); await expect(page.getByRole('button', { name: 'Sync now', exact: true })).toBeVisible();
  await navigate('Calendar'); await page.getByText('Editable meeting', { exact: true }).first().click();
  const properties = page.getByRole('dialog', { name: 'Google Calendar properties', exact: true });
  await properties.locator('summary').filter({ hasText: /^Completions/ }).click();
  await properties.getByRole('button', { name: 'Add completion' }).click();
  await properties.getByLabel('Minutes', { exact: true }).fill('25'); await properties.getByLabel('Comment', { exact: true }).fill('Measured preparation');
  await properties.getByRole('button', { name: 'Apply' }).click(); await expect(properties.getByText('Measured preparation', { exact: true })).toBeVisible();
  await properties.getByRole('button', { name: 'Edit event', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit Google event', exact: true });
  await edit.getByRole('button', { name: 'Load event for editing' }).click();
  await edit.getByLabel('Title', { exact: true }).fill('Changed in UTM');
  remote = { ...remote, etag: 'v2', description: 'Edited on another device' };
  await edit.getByRole('button', { name: 'Save in Google', exact: true }).click();
  await expect(edit.getByRole('alert')).toContainText('changed in Google'); expect(patches).toBe(0);
  await edit.getByRole('button', { name: 'Load current event; keep my draft' }).click();
  await expect(edit.getByLabel('Title', { exact: true })).toHaveValue('Changed in UTM');
  // Keep the independently changed description while retaining our title edit.
  await expect(edit.getByLabel('Description', { exact: true })).toHaveValue('Edited on another device');
  for (const colorScheme of ['light', 'dark'] as const) { await page.emulateMedia({ colorScheme }); await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, colorScheme); await page.screenshot({ animations: 'disabled', path: test.info().outputPath(`google-edit-${colorScheme}.png`) }); expect((await edit.boundingBox())!.width).toBeLessThanOrEqual(page.viewportSize()!.width); }
  await edit.getByRole('button', { name: 'Save in Google', exact: true }).click(); await expect(edit.getByRole('alert')).toBeVisible();
  await edit.getByRole('button', { name: 'Check / retry save' }).click(); await expect(edit).toBeHidden(); expect(patches).toBe(1);
  await page.getByText('Changed in UTM', { exact: true }).first().click();
  await properties.locator('summary').filter({ hasText: /^Completions/ }).click(); await expect(properties.getByText('Measured preparation', { exact: true })).toBeVisible();
  await properties.getByRole('button', { name: 'Close', exact: true }).click();
  await navigate('Home'); await page.getByPlaceholder('Add new item').fill('Journal task'); await page.getByPlaceholder('Add new item').press('Enter');
  const itemEditor = page.getByRole('dialog', { name: 'Item editor', exact: true });
  await itemEditor.locator('summary').filter({ hasText: /^History/ }).click();
  await itemEditor.locator('summary').filter({ hasText: /^Completions/ }).click();
  await itemEditor.getByRole('button', { name: 'Add completion' }).click();
  await itemEditor.getByLabel('Hours', { exact: true }).fill('1'); await itemEditor.getByLabel('Minutes', { exact: true }).fill('5'); await itemEditor.getByLabel('Comment', { exact: true }).fill('Focused work'); await itemEditor.getByRole('button', { name: 'Apply' }).click();
  await expect(itemEditor.locator('summary').filter({ hasText: /^Completions · 1 ·/ })).toBeVisible();
  await itemEditor.getByRole('button', { name: 'Save item', exact: true }).click();
  await page.getByText('Journal task', { exact: true }).first().click();
  const history = itemEditor.locator('summary').filter({ hasText: /^History/ });
  if (!await history.evaluate((element) => element.parentElement?.hasAttribute('open'))) await history.click();
  await itemEditor.locator('summary').filter({ hasText: /^Completions/ }).click();
  await expect(itemEditor.getByText('Focused work', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(itemEditor).toBeHidden();
});

test('saves one linked event directly and recovers a lost response', async ({ page }) => {
  test.setTimeout(120_000);
  let inserts = 0; let patches = 0; let moves = 0;
  let created: Record<string, any> | undefined;
  await page.addInitScript(() => { (window as any).google = { accounts: { oauth2: { initTokenClient: (options: any) => ({ requestAccessToken: () => options.callback({ access_token: 'test', expires_in: 3600, scope: options.scope }) }) } } }; });
  await page.route('https://www.googleapis.com/calendar/v3/**', async (route) => {
    const request = route.request(); const url = request.url();
    if (url.includes('calendarList')) return route.fulfill({ json: { items: [{ id: 'test@example.com', primary: true, summary: 'Test calendar', accessRole: 'owner', timeZone: 'UTC' }, { id: 'other', summary: 'Other calendar', accessRole: 'writer', timeZone: 'UTC' }] } });
    if (url.includes('/move?')) { moves++; expect(url).toContain('destination=other'); created = { ...created, etag: 'moved' }; return route.fulfill({ json: created }); }
    if (request.method() === 'PATCH') { patches++; created = { ...created, ...request.postDataJSON(), etag: 'v2' }; return route.fulfill({ json: created }); }
    if (request.method() === 'POST') { inserts++; if (!created) { created = { ...request.postDataJSON(), etag: 'v1' }; return route.abort('failed'); } return route.fulfill({ status: 409, json: {} }); }
    if (/\/events\/utm/.test(url)) return route.fulfill({ json: { ...created, status: 'confirmed', htmlLink: 'https://calendar.google.com/event?eid=test' } });
    return route.fulfill({ json: { items: [], nextSyncToken: 'test-sync' } });
  });
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('Unified save');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  const navigate = async (name: string) => {
    if ((page.viewportSize()?.width ?? 0) <= 620) { await page.getByRole('button', { name: 'Open navigation' }).click(); await page.locator('.mobile-nav-menu').getByRole('button', { name: name === 'All items' ? /^All items/ : name, exact: name !== 'All items' }).click(); }
    else await page.locator('.sidebar').getByRole('button', { name: name === 'All items' ? /^All items/ : name, exact: name !== 'All items' }).click();
  };
  await navigate('Settings'); await page.getByText('Calendar and Google Calendar', { exact: true }).click();
  await page.getByRole('button', { name: 'Connect Google Calendar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sync now', exact: true })).toBeVisible();
  await navigate('Home'); await page.getByPlaceholder('Add new item').fill('Create from UTM'); await page.getByPlaceholder('Add new item').press('Enter');
  const editor = page.getByRole('dialog', { name: 'Item editor', exact: true });
  await expect(editor.getByRole('button', { name: 'Create linked Google event', exact: true })).toHaveCount(0);
  await editor.locator('[data-editor-section="dates"] > summary').click();
  await editor.getByLabel('Event opens', { exact: true }).fill('2030-09-23T12:00');
  await expect(editor.getByLabel('Event ends', { exact: true })).not.toHaveValue('');
  await editor.getByRole('button', { name: 'Clear Event ends', exact: true }).click();
  await editor.getByRole('button', { name: 'Save item', exact: true }).click(); await expect(editor).toBeHidden(); expect(inserts).toBe(0);
  await navigate('All items'); await page.locator('.all-sections').getByText('Create from UTM', { exact: true }).click();
  await editor.locator('[data-editor-section="dates"] > summary').click();
  await expect(editor.getByLabel('Event ends', { exact: true })).toHaveValue('');
  await editor.getByLabel('Event ends', { exact: true }).fill('2030-09-23T13:00');
  await editor.locator('[data-editor-section="calendar-details"] > summary').click();
  await expect(editor.getByRole('combobox', { name: 'Google Calendar', exact: true })).toHaveValue('test@example.com');
  for (const theme of ['light', 'dark'] as const) { await page.emulateMedia({ colorScheme: theme }); await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme); await page.screenshot({ path: test.info().outputPath('unified-' + theme + '.png') }); }
  await editor.getByRole('button', { name: 'Save item', exact: true }).click(); await expect(editor).toBeHidden(); expect(inserts).toBe(1);
  await page.locator('.all-sections').getByText('Create from UTM', { exact: true }).click();
  await editor.locator('[data-editor-section="calendar-details"] > summary').click();
  await expect(page.getByText(/Saved in UTM, waiting for sync/)).toBeVisible();
  await page.keyboard.press('Escape'); await expect(editor).toBeHidden();
  await page.reload(); await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple'); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await navigate('All items'); await page.locator('.all-sections').getByText('Create from UTM', { exact: true }).click();
  await editor.getByRole('button', { name: 'Save item', exact: true }).click(); await expect(editor).toBeHidden(); expect(inserts).toBe(2);
  await expect(page.locator('.all-sections').getByText('Create from UTM', { exact: true })).toHaveCount(1);
  await expect(page.locator('.all-sections .state-toggle')).toHaveCount(0);
  await page.locator('.all-sections').getByText('Create from UTM', { exact: true }).click();
  await editor.getByLabel('Title', { exact: true }).fill('Edited linked event');
  await editor.getByRole('button', { name: 'Save item', exact: true }).click(); await expect(editor).toBeHidden(); expect(patches).toBe(1);
  await expect(page.locator('.all-sections').getByText('Edited linked event', { exact: true })).toHaveCount(1);
  await page.locator('.all-sections').getByText('Edited linked event', { exact: true }).click();
  await editor.locator('[data-editor-section="calendar-details"] > summary').click();
  await editor.getByRole('combobox', { name: 'Google Calendar', exact: true }).selectOption('other');
  await editor.getByRole('button', { name: 'Save item', exact: true }).click(); await expect(editor).toBeHidden();
  expect(moves).toBe(1); expect(inserts).toBe(2); expect(patches).toBe(1);
  await page.locator('.all-sections').getByText('Edited linked event', { exact: true }).click();
  await editor.locator('[data-editor-section="calendar-details"] > summary').click();
  await expect(editor.getByRole('combobox', { name: 'Google Calendar', exact: true })).toHaveValue('other');
  await editor.locator('[data-editor-section="dates"] > summary').click();
  await editor.getByRole('button', { name: 'Clear Event ends', exact: true }).click();
  await expect(editor.getByLabel('Event ends', { exact: true })).not.toHaveValue('');
  await page.keyboard.press('Escape'); await expect(editor).toBeHidden();
});
