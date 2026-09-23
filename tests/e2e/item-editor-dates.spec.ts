import { expect, test, type Page } from '@playwright/test';

async function createWorkspaceAndItem(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('Dates migration');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await page.getByPlaceholder('Add new item').fill('Calendar block');
  await page.getByPlaceholder('Add new item').press('Enter');
  await page.getByRole('dialog').waitFor({ state: 'visible' });
  if (!await page.getByRole('dialog').isVisible()) {
    await page.locator('.item-card').filter({ hasText: 'Calendar block' }).first().locator('.item-main').click();
  }
  const summary = page.locator('.editor-scroll > details > summary').filter({ hasText: 'Dates & time' }).first();
  const section = summary.locator('..');
  await section.evaluate((element) => { (element as HTMLDetailsElement).open = true; });
}

async function reopenItem(page: Page) {
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.locator('.item-card').filter({ hasText: 'Calendar block' }).first().locator('.item-main').click();
  await page.getByRole('dialog').waitFor({ state: 'visible' });
}

test('event end and duration stay linked in both directions and allow clearing', async ({ page }) => {
  await createWorkspaceAndItem(page);
  const opens = page.getByLabel('Event opens', { exact: true });
  const ends = page.getByLabel('Event ends', { exact: true });
  const due = page.locator('input[aria-label="Due / Active range ends"]');

  await expect(opens).toHaveValue('');
  await expect(ends).toHaveCount(0);
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
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
});

test('clearing a timed end and start persists without silently restoring either date', async ({ page }) => {
  await createWorkspaceAndItem(page);
  await page.getByLabel('Event opens', { exact: true }).fill('2030-09-23T12:00');
  await expect(page.getByLabel('Event ends', { exact: true })).not.toHaveValue('');
  await page.getByRole('button', { name: 'Clear Event ends' }).click();
  await expect(page.getByLabel('Event ends', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Save item' }).click();
  await reopenItem(page);
  await page.locator('.editor-scroll > details').filter({ hasText: 'Dates & time' }).first().evaluate((element) => { (element as HTMLDetailsElement).open = true; });
  await expect(page.getByLabel('Event ends', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Clear Event opens' }).click();
  await expect(page.getByLabel('Event opens', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Save item' }).click();
  await reopenItem(page);
  await page.locator('.editor-scroll > details').filter({ hasText: 'Dates & time' }).first().evaluate((element) => { (element as HTMLDetailsElement).open = true; });
  await expect(page.getByLabel('Event opens', { exact: true })).toHaveValue('');
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
  await expect(page.getByRole('alert')).toContainText('Event ends must be after Event opens.');
});

test('calendar details stay compact at the bottom and persist location and time zone', async ({ page }) => {
  await createWorkspaceAndItem(page);
  await page.getByLabel('Event opens', { exact: true }).fill('2030-09-23T12:00');
  const details = page.locator('[data-editor-section="calendar-details"]');
  await details.locator(':scope > summary').click();
  await details.getByLabel('Location', { exact: true }).fill('Library');
  await details.getByLabel('Time zone', { exact: true }).fill('Europe/Moscow');
  await details.getByLabel('Time zone', { exact: true }).blur();
  await expect(details.getByLabel('All day', { exact: true })).not.toBeChecked();
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(details.getByLabel('Location', { exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Save item' }).click();
  await page.getByRole('article').getByRole('button', { name: 'Calendar block', exact: true }).first().click();
  await details.locator(':scope > summary').click();
  await expect(details.getByLabel('Location', { exact: true })).toHaveValue('Library');
  await expect(details.getByLabel('Time zone', { exact: true })).toHaveValue('Europe/Moscow');
});
