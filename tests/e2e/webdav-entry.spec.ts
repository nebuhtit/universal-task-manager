import { expect, test } from '@playwright/test';

for (const language of ['ru', 'en']) test(`WebDAV entry retains fields on denied access: ${language}`, async ({ page }) => {
  await page.emulateMedia({ colorScheme: language === 'ru' ? 'dark' : 'light' });
  await page.goto('/');
  await page.locator('.language-picker select').selectOption(language);
  const entry = page.locator('.webdav-entry');
  await entry.locator('summary').click();
  const labels = language === 'ru'
    ? ['Адрес WebDAV (HTTPS)', 'Логин WebDAV', 'Пароль WebDAV', 'Код рабочего пространства', 'Общий пароль синхронизации', 'Новый локальный пароль для этого устройства']
    : ['WebDAV URL (HTTPS)', 'WebDAV username', 'WebDAV password', 'Workspace code', 'Shared sync password', 'New local password for this device'];
  const values = ['https://entry-test.invalid/dav/', 'synthetic', 'synthetic-secret', '11111111-1111-4111-8111-111111111111', 'synthetic-sync-secret', 'synthetic-local-secret'];
  await entry.getByLabel(labels[0]!, { exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(entry.getByLabel(language === 'ru' ? 'Папка внутри WebDAV' : 'Folder inside WebDAV')).toBeFocused();
  for (let index = 0; index < labels.length; index++) await entry.getByLabel(labels[index]!, { exact: true }).fill(values[index]!);
  await page.route('https://entry-test.invalid/**', route => route.fulfill({ status: 403, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' }));
  const submit = entry.getByRole('button', { name: language === 'ru' ? 'Загрузить и открыть' : 'Download and open' });
  await submit.scrollIntoViewIfNeeded(); await submit.click();
  await expect(entry.getByRole('alert')).toContainText('webdav-access-denied');
  await expect(submit).toBeEnabled();
  await expect(entry.getByLabel(labels[0]!, { exact: true })).toHaveValue(values[0]!);
  await expect(page.locator('.lock-card')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
