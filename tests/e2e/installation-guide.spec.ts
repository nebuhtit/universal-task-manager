import { expect, test } from '@playwright/test';

for (const language of ['en', 'ru'] as const) {
  test(`installation help is shared with Settings and stays localized: ${language}`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: language === 'ru' ? 'dark' : 'light' });
    await page.goto('/');
    const languagePicker = page.locator('.language-picker select');
    await languagePicker.selectOption(language);
    await page.locator('.install-guide > summary').click();
    const support = page.locator('.install-guide .support-development');
    const supportUrl = 'https://yoomoney.ru/fundraise/1L286389BIR.261021';
    await expect(support.getByRole('link')).toHaveAttribute('href', supportUrl);
    await page.context().route('https://yoomoney.ru/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Payment page stub</title>' }));
    const popupEvent = page.waitForEvent('popup');
    await support.getByRole('link').click();
    const popup = await popupEvent;
    await popup.waitForLoadState();
    expect(popup.url()).toBe(supportUrl);
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    await popup.close();
    await expect(page.locator('.lock-card')).toBeVisible();
    const guide = page.locator('.installation-guide');
    await expect(guide).toHaveAttribute('lang', language);
    await guide.locator('summary').filter({ hasText: 'Xcode' }).click();
    await expect(guide.getByText('Important: 7 days.', { exact: true }).or(guide.getByText('Важно: 7 дней.', { exact: true }))).toBeVisible();
    const original = await guide.textContent();
    if (language === 'en') expect(original).not.toMatch(/[А-Яа-яЁё]/);
    const lastLink = guide.getByRole('link').last();
    await lastLink.scrollIntoViewIfNeeded();
    await lastLink.focus();
    await expect(lastLink).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    // Switching languages must replace the copy instead of re-translating old DOM text.
    await languagePicker.selectOption(language === 'en' ? 'ru' : 'en');
    await languagePicker.selectOption(language);
    await expect(guide).toHaveText(original!);
    await page.locator('input[name="password"]').fill('installation-guide-password');
    await page.locator('input[name="confirm-password"]').fill('installation-guide-password');
    await page.locator('form button.primary').click();
    await expect(page.locator('.capture-dock input')).toBeVisible();
    await page.getByRole('button', { name: language === 'ru' ? 'Уведомления' : 'Notifications', exact: true }).click();
    const notificationDonate = page.locator('.notification-center footer').getByRole('link', { name: language === 'ru' ? 'Подарить мне кофе ☺️' : 'Buy me a coffee ☺️', exact: true });
    await expect(notificationDonate).toBeVisible();
    await expect(notificationDonate).toHaveAttribute('href', supportUrl);
    await expect(notificationDonate).toHaveCSS('text-decoration-line', 'none');
    await notificationDonate.focus();
    await expect(notificationDonate).toBeFocused();
    await page.locator('.notification-center header button').click();
    const settings = language === 'ru' ? 'Настройки' : 'Settings';
    if (info.project.use.hasTouch) {
      await page.getByRole('button', { name: language === 'ru' ? 'Открыть меню' : 'Open navigation', exact: true }).click();
      await page.locator('.mobile-nav-menu').getByRole('button', { name: settings, exact: true }).click();
    } else await page.locator('.sidebar').getByRole('button', { name: settings, exact: true }).click();
    await expect(page.locator('.settings-page .support-development').getByRole('link')).toHaveAttribute('href', supportUrl);
    await page.locator('.settings-disclosure > summary').filter({ hasText: language === 'ru' ? 'Руководство' : 'Guide' }).click();
    const settingsGuide = page.locator('.settings-guide .installation-guide');
    await expect(settingsGuide).toHaveText(original!);
    await settingsGuide.locator('summary').filter({ hasText: 'Xcode' }).click();
    await expect(settingsGuide.getByRole('link').last()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}
