import { expect, test, type Page } from '@playwright/test';

async function navigate(page: Page, name: string) {
  if ((page.viewportSize()?.width ?? 0) > 620) await page.locator('.sidebar').getByRole('button', { name, exact: true }).click();
  else { await page.getByRole('button', { name: 'Open navigation' }).click(); await page.locator('.mobile-nav-menu').getByRole('button', { name, exact: true }).click(); }
}
test('live text suggestions, correction reports and saved preference', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('Live text');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  const input = page.getByPlaceholder('Add new item');
  await input.fill('Встреча завтра');
  const options = page.getByRole('listbox', { name: 'Подсказки Live text' });
  await expect(options).toBeVisible();
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    const panel = await page.locator('.live-text-panel').boundingBox(); const field = await input.boundingBox();
    expect(panel!.y + panel!.height).toBeLessThanOrEqual(field!.y);
    expect(panel!.x).toBeGreaterThanOrEqual(0);
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.screenshot({ path: test.info().outputPath(`live-text-${colorScheme}.png`) });
  }
  await input.press('ArrowDown'); await input.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Item editor' })).toBeHidden();
  await expect(input).not.toHaveValue('Встреча завтра');
  await input.fill('Встреча завтра'); await input.press('Tab');
  await expect(options.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await input.press('ArrowDown');
  await expect(options.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
  await input.press('ArrowUp');
  await expect(options.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await input.press('Shift+Tab');
  await expect(options.getByRole('option').last()).toHaveAttribute('aria-selected', 'true');
  await input.press('Tab');
  await expect(options.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await input.press('Space');
  await expect(input).not.toHaveValue('Встреча завтра');
  await expect(input).toBeFocused();
  await input.fill('на залив 19.09');
  await expect(options.getByRole('option', { name: /^вечером/ })).toBeVisible();
  await expect(options.getByRole('option', { name: /^19:00/ })).toBeVisible();
  await options.getByRole('option', { name: /^19:00/ }).click();
  await expect(input).toHaveValue('на залив 19.09 19:00 ');
  await input.fill('Тест начало 31.02.2026 10:00');
  await expect(page.locator('.live-text-panel [role="alert"]')).toBeVisible();
  await input.press('Enter'); await expect(input).toHaveValue('Тест начало 31.02.2026 10:00');
  await page.getByRole('button', { name: 'Сообщить о неточности', exact: true }).click();
  const report = page.getByRole('dialog', { name: 'Ошибка разбора Live text' });
  await report.getByLabel('Как должно быть').fill('Нужна корректная дата, например 28 февраля');
  await report.getByRole('button', { name: 'Сохранить отчёт' }).click();
  await expect(report).toBeHidden();
  const logs = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('utm:live-text-reports:')).map((key) => JSON.parse(localStorage.getItem(key)!)));
  expect(logs[0][0].input).toBe('Тест начало 31.02.2026 10:00');
  expect(logs[0][0].expected).toContain('28 февраля');
  expect(JSON.stringify(logs)).not.toContain('correct horse battery staple');
  await input.fill('Встреча завтра 15:00'); await input.press('Escape'); await input.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Item editor' })).toBeVisible();
  const title = page.getByLabel('Title', { exact: true });
  await title.fill('Встреча ');
  const titlePanel = page.locator('.live-text-panel-overlay');
  await expect(titlePanel).toBeVisible();
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    const panelBox = (await titlePanel.boundingBox())!;
    const titleBox = (await title.boundingBox())!;
    const dialogBox = (await page.getByRole('dialog', { name: 'Item editor' }).boundingBox())!;
    expect(panelBox.y).toBeGreaterThanOrEqual(dialogBox.y - 1);
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(titleBox.y);
  }
  await title.fill('Встреча след месяц');
  await page.getByText('Dates & time', { exact: true }).click();
  const expectedMonth = new Date(); expectedMonth.setDate(1); expectedMonth.setMonth(expectedMonth.getMonth() + 1);
  await expect(page.getByLabel('Event opens', { exact: true })).toHaveValue(new RegExp(`^${expectedMonth.getFullYear()}-${String(expectedMonth.getMonth() + 1).padStart(2, '0')}-`));
  await page.getByRole('button', { name: 'Save item', exact: true }).click();
  await navigate(page, 'Settings');
  const appearance = page.locator('details.settings-disclosure').filter({ has: page.getByText('Appearance and sounds', { exact: true }) });
  if (!await appearance.evaluate((el) => (el as HTMLDetailsElement).open)) await appearance.locator(':scope > summary').click();
  await page.getByLabel('Подсказки над строкой ввода').uncheck();
  await expect(page.getByText('Настройка сохранена', { exact: true })).toBeVisible();
  const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: 'Скачать логи JSON' }).click();
  expect((await downloaded).suggestedFilename()).toBe('utm-live-text-reports.json');
  await page.reload(); await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple'); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await input.fill('Другой item завтра'); await expect(options).toBeHidden();
  expect(await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith('utm:live-text-reports:')))).toBe(true);
});
