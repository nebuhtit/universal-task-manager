import { expect, test, type Page } from '@playwright/test';

async function createWorkspaceAndItem(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('Dates migration');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await page.getByPlaceholder('Add new item').fill('Calendar block');
  await page.getByPlaceholder('Add new item').press('Enter');
  const summary = page.locator('.editor-scroll > details > summary').filter({ hasText: 'Dates & time' }).first();
  const section = summary.locator('..');
  if (!await section.evaluate((element) => (element as HTMLDetailsElement).open)) await summary.click();
}

test('dates, duration and clearing remain synchronized', async ({ page }) => {
  await createWorkspaceAndItem(page);
  const opens = page.getByLabel('Event opens', { exact: true });
  const ends = page.getByLabel('Event ends', { exact: true });
  const due = page.locator('input[aria-label="Due / Active range ends"]');

  await expect(opens).toHaveValue('');
  const start = await page.evaluate(() => {
    const date = new Date();
    date.setSeconds(0, 0);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  await opens.fill(start);
  await expect(due).toHaveValue('');
  await due.click();
  await expect(due).toHaveValue(await opens.inputValue());
  await page.getByRole('button', { name: 'Clear Due / Active range ends' }).click();
  await expect(due).toHaveValue('');

  await page.getByLabel('Duration preset').selectOption('30');
  await expect(page.getByLabel('Calendar duration amount')).toHaveValue('30');
  const difference = await page.evaluate(({ start, end }) => new Date(end).getTime() - new Date(start).getTime(), { start: await opens.inputValue(), end: await ends.inputValue() });
  expect(difference).toBe(30 * 60_000);
  await expect(due).toHaveValue('');

  const oneHourLater = await page.evaluate((start) => {
    const value = new Date(start);
    value.setHours(value.getHours() + 1);
    return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }, await opens.inputValue());
  await ends.fill(oneHourLater);
  await expect(page.getByLabel('Calendar duration amount')).toHaveValue('1');
  await expect(page.getByLabel('Calendar duration unit')).toHaveValue('hours');
  await page.getByRole('button', { name: 'Save item' }).click();

  await page.getByText('Calendar block', { exact: true }).first().click();
  await expect(page.getByLabel('Event ends', { exact: true })).toHaveValue(oneHourLater);
  await expect(page.locator('input[aria-label="Due / Active range ends"]')).toHaveValue('');
});

test('end and due dates before Event opens remain invalid', async ({ page }) => {
  await createWorkspaceAndItem(page);
  const opens = page.getByLabel('Event opens', { exact: true });
  const start = await page.evaluate(() => {
    const date = new Date();
    date.setSeconds(0, 0);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  await opens.fill(start);
  const earlier = await page.evaluate((value) => {
    const date = new Date(value);
    date.setMinutes(date.getMinutes() - 10);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }, start);
  await page.getByLabel('Event ends', { exact: true }).fill(earlier);
  await page.getByRole('button', { name: 'Save item' }).click();
  await expect(page.getByRole('alert')).toContainText('Event ends cannot be earlier than Event opens.');
});
