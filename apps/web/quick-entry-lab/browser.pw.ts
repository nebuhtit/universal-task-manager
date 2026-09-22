import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-21T13:00:00Z') });
  await page.goto('/');
});

test('examples, validation and local-only cards', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const entry = page.getByRole('combobox');
  await expect(page).toHaveTitle('UTM · Лаборатория текстового ввода');
  await expect(page.locator('.result')).toContainText('22 сентября 2026 г. в 14:15');
  await page.getByRole('button', { name: /02.*Стрижка начало / }).click();
  await expect(page.locator('.result')).toContainText('22 сентября 2026 г. в 14:15');
  await page.getByRole('button', { name: 'Добавить тестовую карточку' }).click();
  await expect(page.getByRole('region', { name: 'Тестовые карточки' })).toContainText('Стрижка');
  await entry.fill('Ошибка @31.02.2026 12:00');
  await expect(page.getByRole('button', { name: 'Добавить тестовую карточку' })).toBeDisabled();
  await entry.fill('Позвонить r:in45m');
  await page.getByRole('button', { name: 'Добавить тестовую карточку' }).click();
  await expect(page.getByRole('region', { name: 'Тестовые карточки' })).toContainText('21 сентября 2026 г. в 16:45');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Тестовые карточки' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('keyboard completion, Escape, caret editing and touch selection', async ({ page }) => {
  const entry = page.getByRole('combobox');
  await entry.fill('Стрижка @за');
  await expect(page.getByRole('option', { name: /@завтра/ })).toBeVisible();
  await entry.press('Enter');
  await expect(entry).toHaveValue('Стрижка @завтра 16:15 ');
  await expect(page.getByRole('region', { name: 'Тестовые карточки' })).toHaveCount(0);
  await entry.fill('Стрижка нап'); await entry.press('Tab');
  await expect(entry).toHaveValue('Стрижка напомнить ');
  await entry.press('ArrowDown'); await entry.press('Enter');
  await expect(entry).toHaveValue('Стрижка напомнить 1ч ');
  await entry.fill('Дело дор');
  await page.getByRole('option', { name: /^дорога / }).click();
  await expect(entry).toHaveValue('Дело дорога ');
  await expect(entry).toBeFocused();
  await entry.press('Escape'); await expect(page.getByRole('listbox')).toHaveCount(0);
  await entry.fill('Дело дорога:45м @завтра 15:00');
  await entry.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(12, 12));
  await entry.press('ArrowLeft'); await entry.press('ArrowRight');
  await page.getByRole('option', { name: '15м', exact: false }).click();
  await expect(entry).toHaveValue('Дело дорога:15м  @завтра 15:00');
});

test('light and dark narrow layout, scroll, offline parsing', async ({ page, context }, testInfo) => {
  await page.getByRole('button', { name: 'Тёмная тема' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: `/tmp/utm-quick-entry-${testInfo.project.name}-dark.png`, fullPage: true, animations: 'disabled' });
  await page.getByText('Синтаксис и правила', { exact: true }).click();
  await expect(page.getByText('Результат разбора (JSON)', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.setOffline(true);
  await page.getByRole('combobox').fill('Офлайн начало:завтра 10:00 tt:30m r:leave-1h');
  await page.getByRole('button', { name: 'Добавить тестовую карточку' }).click();
  await expect(page.getByRole('region', { name: 'Тестовые карточки' })).toContainText('22 сентября 2026 г. в 08:30');
  await page.getByRole('button', { name: 'Тёмная тема' }).click();
  await page.screenshot({ path: `/tmp/utm-quick-entry-${testInfo.project.name}.png`, fullPage: true, animations: 'disabled' });
});

test('preserves edited time, clears deleted duration and filters departure suggestions', async ({ page }) => {
  const entry = page.getByRole('combobox');
  const text = 'Стрижка @завт 15:10 дорога: напомнить:';
  await entry.fill(text);
  await entry.evaluate((element: HTMLTextAreaElement) => { const position = element.value.indexOf(' 15:10'); element.setSelectionRange(position, position); });
  await entry.press('ArrowLeft'); await entry.press('ArrowRight');
  await expect(page.getByRole('option', { name: /@завтра 15:10/ })).toBeVisible();
  await entry.press('Enter');
  await expect(entry).toHaveValue('Стрижка @завтра 15:10 дорога: напомнить:');
  await expect(page.locator('.errors')).not.toContainText('Некорректная длительность');
  await entry.fill('Стрижка @завтра 15:10 дорога:45м напомнить:');
  await expect(page.getByRole('option', { name: /выезд-2ч/ })).toBeVisible();
  await entry.fill('Стрижка @завтра 15:10 дорога: напомнить:');
  await expect(page.getByRole('option', { name: /выезд/ })).toHaveCount(0);
  await entry.fill('Стрижка @завтра 15:10 дорога:');
  await expect(page.locator('.errors')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Добавить тестовую карточку' })).toBeEnabled();
});

test('due default and independent event boundaries update automatic reminders', async ({ page }) => {
  const entry = page.getByRole('combobox');
  await entry.fill('Отчёт @завтра 18:00 напомнить:30м');
  await expect(page.locator('.result')).toContainText('22 сентября 2026 г. в 17:30');
  await expect(page.locator('.result')).toContainText('до due');
  await entry.fill('Отчёт @завтра 18:00 event opens:завтра 15:00 event ends:завтра 16:00 напомнить:30м');
  await expect(page.locator('.result')).toContainText('22 сентября 2026 г. в 14:30');
  await expect(page.locator('.result')).toContainText('до event opens');
  await expect(page.getByRole('button', { name: 'Добавить тестовую карточку' })).toBeEnabled();
  await entry.fill('Отчёт @завтра 18:00 event ends:завтра 16:00 напомнить:30м');
  await expect(page.locator('.result')).toContainText('22 сентября 2026 г. в 17:30');
});

test('date alternatives, partial time and native calendar entry', async ({ page }) => {
  const entry = page.getByRole('combobox');
  await entry.fill('Дело @завтра 15:1 напомнить:');
  await entry.evaluate((element: HTMLTextAreaElement) => { const i = element.value.indexOf(' напомнить:'); element.setSelectionRange(i, i); });
  await entry.press('ArrowLeft'); await entry.press('ArrowRight');
  await page.getByRole('option', { name: /@завтра 15:15/ }).click();
  await expect(entry).toHaveValue('Дело @завтра 15:15 напомнить:');
  await entry.fill('Дело @завтра 15:10');
  await expect(page.getByRole('option', { name: /@сегодня 15:10/ })).toHaveCount(0);
  await expect(page.getByRole('option', { name: /@вторник 15:10/ })).toBeVisible();
  await page.evaluate(() => { HTMLInputElement.prototype.showPicker = function() { this.dataset.pickerRequested = 'true'; }; });
  await page.getByRole('option', { name: /Выбрать дату/ }).click();
  const date = page.getByLabel('Дата в календаре', { exact: true });
  await expect(date).toHaveAttribute('data-picker-requested', 'true');
  await date.fill('2026-10-07');
  await expect(entry).toHaveValue('Дело @2026-10-07 15:10 ');
  await expect(entry).toBeFocused();
  await expect(page.locator('.result')).toContainText('7 октября 2026 г. в 15:10');
});

test('orders minute completion by whole hour, half hour and quarters', async ({ page }) => {
  const entry = page.getByRole('combobox');
  await entry.fill('Дело завтра 15:');
  await expect(page.getByRole('option')).toHaveCount(13); // 12 times plus the calendar action.
  const labels = await page.getByRole('option').allTextContents();
  expect(labels.slice(0, 6).map(label => label.match(/15:\d{2}/)?.[0])).toEqual(['15:00', '15:15', '15:30', '15:45', '15:05', '15:10']);
});

test('offers minute completion after a bare hour and trailing space', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-21T07:00:00Z'));
  await page.reload();
  const entry = page.getByRole('combobox');
  await entry.fill('сегодня 14 ');
  const labels = await page.getByRole('option').allTextContents();
  expect(labels.slice(0, 4).map(label => label.match(/14:\d{2}/)?.[0])).toEqual(['14:00', '14:15', '14:30', '14:45']);
});

test('spaced reminders never suggest dates at the caret', async ({ page }) => {
  const entry = page.getByRole('combobox');
  await entry.fill('футбол @чт 15 00 напомнить: 1 день ');
  await expect(page.getByRole('option', { name: /^1д/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /@|Выбрать дату|дорога:/ })).toHaveCount(0);
  await page.getByRole('option', { name: /^2ч/ }).click();
  await expect(entry).toHaveValue('футбол @чт 15 00 напомнить:2ч ');
  await expect(page.locator('.errors')).toHaveCount(0);
});

test('natural dates and labels without punctuation keep completion context', async ({ page }) => {
  const entry = page.getByRole('combobox');
  await entry.fill('Футбол чт 15 00 напоминание за 1 день');
  await expect(page.locator('.errors')).toHaveCount(0);
  await expect(page.locator('.result')).toContainText('Футбол');
  await expect(page.getByRole('option', { name: /^1д/ })).toBeVisible();
  await page.getByRole('option', { name: /^2ч/ }).click();
  await expect(entry).toHaveValue('Футбол чт 15 00 напоминание 2ч ');
  await entry.fill('Встреча срок завтра 18:00 начало завтра 15:00 конец завтра 16:00 напомнить 30м');
  await expect(page.locator('.errors')).toHaveCount(0);
  await expect(page.locator('.result')).toContainText('22 сентября 2026 г. в 14:30');
  await entry.fill('Отчёт ср');
  await expect(page.locator('.result')).toContainText('23 сентября 2026 г. в 09:00');
  await expect(page.getByRole('option', { name: /Выбрать дату/ })).toBeVisible();
});

test('time before weekday stays the entered time', async ({ page }) => {
  const entry = page.getByRole('combobox');
  await entry.fill('Футбол 15 00 пятница');
  await expect(page.locator('.result')).toContainText('25 сентября 2026 г. в 15:00');
  await expect(page.getByRole('option', { name: '15:00 пятница' })).toBeVisible();
  await page.getByRole('option', { name: '15:00 пятница' }).click();
  await expect(entry).toHaveValue('Футбол 15:00 пятница ');
  await expect(page.locator('.result')).toContainText('25 сентября 2026 г. в 15:00');
});

test('Russian next-weekday phrase does not become an item title', async ({ page }) => {
  const entry = page.getByRole('combobox');
  await entry.fill('Футбол в следующий чт 17 32');
  await expect(page.locator('.result')).toContainText('1 октября 2026 г. в 17:32');
  await expect(page.locator('.result')).toContainText('Футбол');
  await expect(page.locator('.result')).not.toContainText('в следующий');
});

test('Russian next-weekday phrase after a title does not leak into the title', async ({ page }) => {
  const entry = page.getByRole('combobox');
  await entry.fill('в магаз в следущий пт 14 22');
  await expect(page.locator('.result')).toContainText('2 октября 2026 г. в 14:22');
  await expect(page.locator('.result h2')).toHaveText('в магаз');
  await expect(page.getByRole('option', { name: /пт 14:22 2 октября/ })).toBeVisible();
});

test('deadline without a clock and day-part words use fixed times', async ({ page }) => {
  const entry = page.getByRole('combobox');
  await entry.fill('позвонить в срок в след пт');
  await expect(page.locator('.result h2')).toHaveText('позвонить');
  await expect(page.locator('.result')).toContainText('2 октября 2026 г. в 09:00');
  await entry.fill('позвонить в срок в след пт вечером');
  await expect(page.locator('.result')).toContainText('2 октября 2026 г. в 18:00');
});

test('a preposition before due does not swallow the preceding duration', async ({ page }) => {
  await page.getByRole('combobox').fill('позвонить длительность 45м в срок в след пт вечером начало сегодня 09:00');
  await expect(page.locator('.errors')).toHaveCount(0);
  await expect(page.locator('.result h2')).toHaveText('позвонить');
  await expect(page.locator('.result')).toContainText('2 октября 2026 г. в 18:00');
  await expect(page.locator('.result')).toContainText('21 сентября 2026 г. в 09:45');
  await expect(page.locator('.result')).toContainText('45 мин');
});

test('paired с and по dates set event boundaries, with contextual completion', async ({ page }) => {
  const entry = page.getByRole('combobox');
  await entry.fill('Встреча с ');
  await expect(page.getByRole('option', { name: /с завтра 09:00/ })).toBeVisible();
  await entry.fill('Встреча с завтра 10:00 по ');
  await expect(page.getByRole('option', { name: /по 2026-09-22 11:00/ })).toBeVisible();
  await entry.fill('Встреча с завтра 10:00 по завтра 11:00');
  await expect(page.locator('.errors')).toHaveCount(0);
  await expect(page.locator('.result h2')).toHaveText('Встреча');
  await expect(page.locator('.result')).toContainText('22 сентября 2026 г. в 10:00');
  await expect(page.locator('.result')).toContainText('22 сентября 2026 г. в 11:00');
  await entry.fill('Встреча с завтра 10:00');
  await expect(page.locator('.errors')).toContainText('обе границы');
});

test('dashed boundaries and Russian or English travel and reminder aliases', async ({ page }) => {
  const entry = page.getByRole('combobox');
  for (const value of [
    'Стрижка завтра 10:00 - завтра 11:00 ехать 45м напомни 30м',
    'Meeting tomorrow 10:00 — tomorrow 11:00 travel 45m remind 30m',
  ]) {
    await entry.fill(value);
    await expect(page.locator('.errors')).toHaveCount(0);
    await expect(page.locator('.result')).toContainText('22 сентября 2026 г. в 10:00');
    await expect(page.locator('.result')).toContainText('22 сентября 2026 г. в 11:00');
    await expect(page.locator('.result')).toContainText('45 мин');
  }
  await entry.fill('Meeting tomorrow 10:00 -');
  await expect(page.locator('.errors')).toContainText('обеих сторон');
});

test('keeps a title after or between commands', async ({ page }) => {
  const entry = page.getByRole('combobox');
  await entry.fill('начало завтра 15:11 дорога 45м напомнить выезд-1д,выезд-2ч стрижка');
  await expect(page.locator('.errors')).toHaveCount(0);
  await expect(page.locator('.result h2')).toHaveText('стрижка');
  await expect(page.locator('.result')).toContainText('45 мин');
  await entry.fill('начало завтра 15:11 стрижка дорога 45м напомнить выезд-2ч');
  await expect(page.locator('.errors')).toHaveCount(0);
  await expect(page.locator('.result h2')).toHaveText('стрижка');
  await entry.fill('Стрижка; начало завтра 15:11; дорога 45м');
  await expect(page.locator('.errors')).toHaveCount(0);
  await expect(page.locator('.result h2')).toHaveText('Стрижка');
});

test('plain date creates an event while до creates due only', async ({ page }) => {
  const entry = page.getByRole('combobox');
  await entry.fill('Даша вс 15 00');
  await expect(page.locator('.errors')).toHaveCount(0);
  await expect(page.locator('.result h2')).toHaveText('Даша');
  await expect(page.locator('.result')).toContainText('27 сентября 2026 г. в 15:00');
  await expect(page.locator('.result')).toContainText('27 сентября 2026 г. в 16:00');
  await expect(page.locator('.result')).toContainText('60 мин');
  await entry.fill('Домашнее задание до вс 15 00');
  await expect(page.locator('.errors')).toHaveCount(0);
  await expect(page.locator('.result h2')).toHaveText('Домашнее задание');
  await expect(page.locator('.result')).toContainText('10 мин');
  const values = await page.locator('.result dd').allTextContents();
  expect(values[0]).toContain('27 сентября 2026 г. в 15:00');
  expect(values[1]).toBe('Не задано');
  expect(values[5]).toBe('Не задано');
});
