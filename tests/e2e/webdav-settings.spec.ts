import { expect, test } from '@playwright/test';

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
  const url = form.getByLabel(language === 'ru' ? 'Адрес WebDAV (HTTPS)' : 'WebDAV URL (HTTPS)');
  await expect(url).toHaveValue('');
  await expect(form.locator('input[type="checkbox"]').first()).not.toBeChecked();
  await url.focus(); await page.keyboard.press('Tab');
  await expect(form.getByLabel(language === 'ru' ? 'Папка внутри WebDAV' : 'Folder inside WebDAV')).toBeFocused();
  await page.route('https://webdav-ui-test.invalid/**', route => route.fulfill({ status: 401, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,PUT,MKCOL,OPTIONS,DELETE' }, body: '' }));
  await url.fill('https://webdav-ui-test.invalid/dav/');
  await form.getByLabel(language === 'ru' ? 'Логин WebDAV' : 'WebDAV username', { exact: true }).fill('synthetic-user');
  await form.getByLabel(language === 'ru' ? 'Пароль WebDAV' : 'WebDAV password', { exact: true }).fill('synthetic-secret');
  await form.getByLabel(language === 'ru' ? 'Общий пароль шифрования синхронизации' : 'Shared sync encryption password').fill('synthetic-sync-secret');
  await form.locator('input[type="checkbox"]').first().check();
  const save = form.getByRole('button', { name: language === 'ru' ? 'Проверить и сохранить' : 'Check and save' });
  await save.scrollIntoViewIfNeeded(); await save.click();
  await expect(form.getByRole('status')).toContainText(language === 'ru' ? 'Сервер отклонил доступ' : 'Access denied');
  await expect(save).toBeEnabled();
  await expect(url).toHaveValue('https://webdav-ui-test.invalid/dav/');
  await expect(form.locator('input[type="password"]')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
