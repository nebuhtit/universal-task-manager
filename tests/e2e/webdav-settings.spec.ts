import { expect, test } from '@playwright/test';
test.use({ serviceWorkers: 'block' });

test('WebDAV drafts do not redirect an active exchange; stop drains and persists until resume', async ({ page }, info) => {
  await page.goto('/');
  await page.locator('.language-picker select').selectOption('en');
  await page.locator('input[name="password"]').fill('webdav-stop-fixture-password');
  await page.locator('input[name="confirm-password"]').fill('webdav-stop-fixture-password');
  await page.locator('form button.primary').click();
  await expect(page.locator('.capture-dock input')).toBeVisible();
  const openSettings = async () => {
    if (info.project.use.hasTouch) {
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      await page.locator('.mobile-nav-menu').getByRole('button', { name: 'Settings', exact: true }).click();
    } else await page.locator('.sidebar').getByRole('button', { name: 'Settings', exact: true }).click();
    const disclosure = page.locator('details').filter({ has: page.locator(':scope > summary', { hasText: 'WebDAV synchronization' }) });
    if (!(await disclosure.evaluate(node => (node as HTMLDetailsElement).open))) await disclosure.locator(':scope > summary').click();
  };
  await openSettings();
  const form = page.getByRole('region', { name: 'WebDAV settings' });
  const url = form.getByLabel('WebDAV URL (HTTPS)', { exact: true });
  await url.fill('https://old-sync.invalid/dav/');
  await form.getByLabel('WebDAV username', { exact: true }).fill('fixture');
  await form.getByLabel('WebDAV password', { exact: true }).fill('fixture-password');
  await form.getByLabel('Shared sync encryption password').fill('fixture-sync-password');
  await form.locator('input[type="checkbox"]').nth(1).uncheck();
  await form.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(form.getByRole('status')).toHaveText('Settings saved on this device. Connection has not been verified.');
  let allowReply!: () => void;
  const held = new Promise<void>(resolve => { allowReply = resolve; });
  const requests: string[] = [];
  await page.route('https://old-sync.invalid/**', async route => { requests.push(route.request().url()); await held; await route.fulfill({ status: 403, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' }); });
  await page.route('https://new-sync.invalid/**', async route => { requests.push(route.request().url()); await route.fulfill({ status: 403, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' }); });
  await form.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  await url.fill('https://new-sync.invalid/dav/');
  await form.getByRole('button', { name: 'Stop synchronization', exact: true }).click();
  await expect(form.getByRole('status')).toContainText('waiting for the current operation');
  await expect(form.getByRole('button', { name: 'Save settings', exact: true })).toBeDisabled();
  expect(requests.every(value => value.startsWith('https://old-sync.invalid/'))).toBe(true);
  allowReply();
  await expect(form.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
  await expect(form.getByRole('status')).toContainText('Synchronization stopped');
  await expect(url).toHaveValue('https://new-sync.invalid/dav/');
  // Enabling automatic sync must not make saving depend on a reachable server.
  await form.locator('input[type="checkbox"]').first().check();
  const requestsBeforeSave = requests.length;
  await form.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(form.getByRole('button', { name: 'Sync now', exact: true })).toBeDisabled();
  await expect(form.getByRole('button', { name: 'Save settings', exact: true })).toBeEnabled();
  expect(requests.length).toBe(requestsBeforeSave);
  await page.reload();
  await page.locator('input[name="password"]').fill('webdav-stop-fixture-password');
  await page.locator('form button.primary').click();
  await expect(page.locator('.capture-dock input')).toBeVisible();
  await openSettings();
  await expect(url).toHaveValue('https://new-sync.invalid/dav/');
  await expect(form.getByRole('status')).toContainText('Synchronization stopped');
  await expect(form.getByRole('button', { name: 'Sync now', exact: true })).toBeDisabled();
  await form.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect.poll(() => requests.some(value => value.startsWith('https://new-sync.invalid/'))).toBe(true);
  await expect(form.getByRole('alert')).toContainText('Checking folder access (MKCOL)');
});

for (const language of ['en', 'ru'] as const) test(`WebDAV private settings and safe failure: ${language}`, async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: language === 'ru' ? 'dark' : 'light' });
  await page.goto('/');
  await page.locator('.language-picker select').selectOption(language);
  await page.locator('input[name="password"]').fill('webdav-ui-fixture-password');
  await page.locator('input[name="confirm-password"]').fill('webdav-ui-fixture-password');
  await page.locator('form button.primary').click();
  await expect(page.locator('.capture-dock input')).toBeVisible();
  const settingsName = language === 'ru' ? 'Настройки' : 'Settings';
  if (info.project.use.hasTouch) {
    await page.getByRole('button', { name: language === 'ru' ? 'Открыть меню' : 'Open navigation', exact: true }).click();
    await page.locator('.mobile-nav-menu').getByRole('button', { name: settingsName, exact: true }).click();
  } else await page.locator('.sidebar').getByRole('button', { name: settingsName, exact: true }).click();
  await page.locator('summary').filter({ hasText: language === 'ru' ? 'Синхронизация WebDAV' : 'WebDAV synchronization' }).click();
  const form = page.getByRole('region', { name: 'WebDAV settings' });
  // Touch must focus the real editable input synchronously, including secrets.
  // Read-only share/code fields deliberately do not request a keyboard.
  const editable = form.locator('input:not([readonly]):not([disabled]):not([type="checkbox"])');
  for (let index = 0; index < await editable.count(); index++) {
    const input = editable.nth(index), before = await input.inputValue();
    await input.scrollIntoViewIfNeeded();
    if (info.project.use.hasTouch) await input.tap(); else await input.click();
    await expect(input).toBeFocused();
    await page.keyboard.type('x');
    await expect(input).toBeFocused();
    await input.fill(before);
  }
  const url = form.getByLabel(language === 'ru' ? 'Адрес WebDAV (HTTPS)' : 'WebDAV URL (HTTPS)');
  await expect(url).toHaveValue('');
  await expect(form.locator('input[type="checkbox"]').first()).not.toBeChecked();
  await url.focus(); await page.keyboard.press('Tab');
  await expect(form.getByPlaceholder('https://your-worker.workers.dev/dav')).toBeFocused();
  const codeField = form.getByLabel(language === 'ru' ? 'Код для входа на другом устройстве' : 'Code for opening on another device');
  const workspaceCode = await codeField.inputValue();
  const shared = `https://webdav-ui-test.invalid/dav/custom@${workspaceCode}`;
  await url.fill(shared);
  await expect(codeField).toHaveValue(workspaceCode);
  await expect(form.getByLabel(language === 'ru' ? 'Папка внутри WebDAV' : 'Folder inside WebDAV')).toHaveValue('');
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { sessionStorage.setItem('test-copied-address', value); } } }); });
  await form.getByRole('button', { name: language === 'ru' ? 'Копировать' : 'Copy', exact: true }).click();
  expect(await page.evaluate(() => sessionStorage.getItem('test-copied-address'))).toBe(shared);
  await url.fill('https://webdav-ui-test.invalid/dav/custom@99999999-9999-4999-8999-999999999999');
  await expect(codeField).toHaveValue('99999999-9999-4999-8999-999999999999');
  await expect(form.getByRole('button', { name: language === 'ru' ? 'Сохранить настройки' : 'Save settings' })).toBeDisabled();
  await expect(form.getByRole('alert')).toContainText(language === 'ru' ? 'другого пространства' : 'different workspace');
  await page.route('https://webdav-ui-test.invalid/**', route => route.fulfill({ status: 401, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,PUT,MKCOL,OPTIONS,DELETE' }, body: '' }));
  await url.fill('https://webdav-ui-test.invalid/dav/');
  await form.getByLabel(language === 'ru' ? 'Логин WebDAV' : 'WebDAV username', { exact: true }).fill('synthetic-user');
  await form.getByLabel(language === 'ru' ? 'Пароль WebDAV' : 'WebDAV password', { exact: true }).fill('synthetic-secret');
  await form.getByLabel(language === 'ru' ? 'Общий пароль шифрования синхронизации' : 'Shared sync encryption password').fill('synthetic-sync-secret');
  await form.locator('input[type="checkbox"]').first().check();
  const save = form.getByRole('button', { name: language === 'ru' ? 'Сохранить настройки' : 'Save settings' });
  await save.scrollIntoViewIfNeeded(); await save.click();
  await expect(form.getByRole('status')).toContainText(language === 'ru' ? 'Сервер отклонил доступ' : 'Access denied');
  await expect(save).toBeEnabled();
  await expect(url).toHaveValue('https://webdav-ui-test.invalid/dav/');
  await expect(form.locator('input[type="password"]')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
