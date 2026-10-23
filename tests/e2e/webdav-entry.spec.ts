import { expect, test } from '@playwright/test';

for (const language of ['ru', 'en']) test(`WebDAV entry retains fields on denied access: ${language}`, async ({ page }) => {
  await page.emulateMedia({ colorScheme: language === 'ru' ? 'dark' : 'light' });
  await page.goto('/');
  await page.locator('.language-picker select').selectOption(language);
  const entry = page.locator('.webdav-entry');
  await entry.locator(':scope > summary').click();
  const guide = entry.locator('.settings-guide-section');
  await guide.locator('summary').click();
  await expect(guide).toContainText('Cloudflare');
  const relayLink = guide.getByRole('link', { name: language === 'ru' ? 'Скачать локальный посредник' : 'Download local relay' });
  const script = await page.request.get((await relayLink.getAttribute('href'))!);
  expect(script.ok()).toBe(true); expect(await script.text()).toContain('createLocalProxy');
  await guide.locator('summary').click();
  const labels = language === 'ru'
    ? ['Адрес WebDAV (HTTPS)', 'Логин WebDAV', 'Пароль WebDAV', 'Код рабочего пространства', 'Пароль рабочего пространства']
    : ['WebDAV URL (HTTPS)', 'WebDAV username', 'WebDAV password', 'Workspace code', 'Workspace password'];
  const values = ['https://entry-test.invalid/dav/', 'synthetic', 'synthetic-secret', '11111111-1111-4111-8111-111111111111', 'synthetic-sync-secret'];
  const controls = entry.locator('input:not([placeholder="https://your-worker.workers.dev/dav"])');
  await expect(controls).toHaveCount(labels.length);
  await controls.nth(0).focus();
  await page.keyboard.press('Tab');
  await expect(controls.nth(1)).toBeFocused();
  await expect(entry.locator('input[autocomplete="new-password"]')).toHaveCount(0);
  for (let index = 0; index < labels.length; index++) await controls.nth(index).fill(values[index]!);
  await page.route('https://entry-test.invalid/**', route => route.fulfill({ status: 403, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' }));
  const submit = entry.getByRole('button', { name: language === 'ru' ? 'Загрузить и открыть' : 'Download and open' });
  await submit.scrollIntoViewIfNeeded(); await submit.click();
  await expect(entry.getByRole('alert')).toContainText('403');
  await expect(submit).toBeEnabled();
  await expect(controls.nth(0)).toHaveValue(values[0]!);
  await expect(page.locator('.lock-card')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
