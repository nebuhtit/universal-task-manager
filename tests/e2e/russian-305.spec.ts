import { expect, test } from '@playwright/test';

test('Russian backup and device help follows interface language on an English device', async ({ page, isMobile }) => {
  await page.addInitScript(() => localStorage.setItem('utm-interface-language', 'ru'));
  await page.goto('/');
  await page.getByText('Помощь', { exact: true }).click();
  await expect(page.getByText('Полное тестовое пространство', { exact: true })).toHaveCount(0); // production bundle
  // Extended explanations are hidden by default, but their copy must be translated too.
  await expect(page.getByText('Рабочее пространство хранится локально, а не на GitHub.', { exact: false })).toHaveCount(1);
  await page.getByLabel('Пароль', { exact: true }).fill('synthetic-russian-password');
  await page.getByLabel('Подтвердите пароль', { exact: true }).fill('synthetic-russian-password');
  await page.getByRole('button', { name: 'Создать зашифрованное пространство' }).click();
  if (isMobile) {
    await page.getByRole('button', { name: 'Открыть меню' }).click();
    await page.locator('.mobile-nav-menu').getByRole('button', { name: 'Настройки', exact: true }).click();
  } else await page.locator('.sidebar').getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByText('Быстрый вход на устройстве', { exact: true }).click();
  await expect(page.getByText('Недоступно в этом браузере или на устройстве. Вход по паролю остаётся доступен.')).toHaveCount(1);
  await page.getByText('Руководство', { exact: true }).click();
  await page.getByText('Идея и сценарии', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Одно рабочее пространство для внимания, времени и контекста' })).toBeVisible();
});
