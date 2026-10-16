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

async function openDates(editor: import('@playwright/test').Locator) {
  await editor.locator('[data-editor-section="dates"]').evaluate((element) => { (element as HTMLDetailsElement).open = true; });
}

for (const theme of ['light', 'dark'] as const) test(`duration presets apply reliably and persist in ${theme}`, async ({ page }, testInfo) => {
  await createWorkspaceAndItem(page);
  await page.emulateMedia({ colorScheme: theme });
  const editor = page.getByRole('dialog', { name: 'Item editor', exact: true });
  const amount = editor.getByLabel('Calendar duration amount', { exact: true });
  const choices = editor.getByRole('group', { name: 'Calendar duration amount units', exact: true });
  const opens = editor.getByLabel('Event opens', { exact: true });
  for (const text of ['5 min', '30 min', '1 h', '5 min']) {
    await amount.focus();
    const option = choices.getByRole('button', { name: text, exact: true });
    if (testInfo.project.use.hasTouch) await option.tap(); else await option.click();
    await expect(amount).toHaveValue(text);
    await opens.focus();
    await expect(amount).toHaveValue(text);
  }
  await amount.focus();
  const five = choices.getByRole('button', { name: '5 min', exact: true });
  // WebKit can report -1 for touch button and deliver blur before release.
  await five.dispatchEvent('pointerdown', { pointerId: 71, pointerType: 'touch', button: 0, clientX: 10, clientY: 10 });
  await opens.focus();
  await five.dispatchEvent('pointerup', { pointerId: 71, pointerType: 'touch', button: -1, clientX: 10, clientY: 10 });
  await expect(amount).toHaveValue('5 min');
  await opens.focus(); await expect(amount).toHaveValue('5 min');
  await amount.focus();
  const thirty = choices.getByRole('button', { name: '30 min', exact: true });
  await thirty.dispatchEvent('pointerdown', { pointerId: 72, pointerType: 'touch', button: 0, clientX: 10, clientY: 10 });
  await thirty.dispatchEvent('pointercancel', { pointerId: 72, pointerType: 'touch' });
  await thirty.dispatchEvent('pointerup', { pointerId: 72, pointerType: 'touch', button: 0, clientX: 10, clientY: 10 });
  await expect(amount).toHaveValue('5 min');
  await thirty.focus(); await thirty.press('Enter');
  await expect(amount).toHaveValue('30 min');
  await amount.focus();
  if (testInfo.project.use.hasTouch) await choices.getByRole('button', { name: '5 min', exact: true }).tap();
  else await choices.getByRole('button', { name: '5 min', exact: true }).click();
  await editor.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(editor).toBeHidden();
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.locator('.mobile-nav-menu').getByRole('button', { name: /^All items/ }).click();
  } else await page.locator('.sidebar').getByRole('button', { name: /^All items/ }).click();
  await page.locator('article').getByText('Calendar block', { exact: true }).first().click();
  await openDates(editor);
  await expect(amount).toHaveValue('5 min');
  await expect(opens).toHaveValue('');
});

test('duration unit suggestions remain visible and accept friendly input in the editor', async ({ page }, testInfo) => {
  await createWorkspaceAndItem(page);
  const editor = page.getByRole('dialog', { name: 'Item editor', exact: true });
  const amount = editor.getByLabel('Calendar duration amount', { exact: true });
  await amount.fill('1,5 h');
  await expect(editor.getByLabel('Calendar duration unit', { exact: true })).toHaveCount(0);
  const suggestions = editor.getByRole('group', { name: 'Calendar duration amount units', exact: true });
  await expect(suggestions).toBeVisible();
  const minutes = suggestions.getByRole('button', { name: '1,5 min', exact: true });
  if (testInfo.project.use.hasTouch) await minutes.tap(); else await minutes.click();
  await expect(amount).toHaveValue('1,5 min');
  await editor.getByLabel('Event opens', { exact: true }).focus();
  await expect(amount).toHaveValue('90 sec');
  await expect(suggestions).toBeHidden();
  await amount.fill('30 мин');
  const inputBox = await amount.boundingBox();
  const controlBox = await editor.locator('.calendar-duration-control').boundingBox();
  expect(inputBox!.width).toBeGreaterThan(controlBox!.width * .95);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(suggestions).toBeVisible();
  await amount.fill('1 ч 30 мин');
  await editor.getByLabel('Event opens', { exact: true }).focus();
  await expect(amount).toHaveValue('90 min');
  await amount.fill('45');
  await editor.getByLabel('Event opens', { exact: true }).focus();
  await expect(amount).toHaveValue('45 min');
});

test('travel title draft survives rejected blur and saves after event bounds are supplied', async ({ page }, testInfo) => {
  await createWorkspaceAndItem(page);
  const editor = page.getByRole('dialog', { name: 'Item editor', exact: true });
  const title = editor.getByRole('combobox', { name: 'Title', exact: true });
  await title.fill('Test ttb 45m');
  await editor.getByLabel('Event opens', { exact: true }).focus();
  await expect(editor.locator('.warning-notice-stack').getByRole('alert').first()).toContainText('Для дороги нужно время начала.');
  // Include parent clock rerenders after the unsuccessful blur.
  await page.waitForTimeout(2200);
  await expect(title).toHaveValue('Test ttb 45m');
  const incident = await page.evaluate(() => JSON.parse(localStorage.getItem('utm:diagnostics:v1') ?? '[]').findLast((e: { operation: string }) => e.operation === 'Item title validation'));
  expect(JSON.parse(incident.details)).toMatchObject({ stage: 'commit', hasStart: false, hasEnd: false, draftLength: 12 });
  expect(incident.details).not.toContain('Test');
  await editor.getByLabel('Event opens', { exact: true }).fill('2030-09-23T12:00');
  await editor.getByLabel('Event ends', { exact: true }).fill('2030-09-23T13:00');
  await expect(title).toHaveValue('Test ttb 45m');
  const save = editor.getByRole('button', { name: 'Save item', exact: true });
  if (testInfo.project.use.hasTouch) await save.tap(); else await save.click();
  await expect(editor).toBeHidden();
});

test('reminder number can be cleared before replacement', async ({ page }) => {
  await createWorkspaceAndItem(page);
  const reminders = page.locator('details').filter({ has: page.locator(':scope > summary').filter({ hasText: /^Reminders/ }) });
  await reminders.evaluate(el => { (el as HTMLDetailsElement).open = true; });
  await page.getByRole('button', { name: '+ Add reminder', exact: true }).click();
  await page.getByLabel('Reminder 1 mode', { exact: true }).selectOption('before');
  const amount = page.getByLabel('Reminder 1 amount', { exact: true });
  await amount.fill(''); await expect(amount).toHaveValue('');
  await amount.fill('25 h'); await page.getByLabel('Reminder 1 mode', { exact: true }).focus();
  await expect(amount).toHaveValue('25 h');
  await amount.fill('3 месяца'); await page.getByLabel('Reminder 1 mode', { exact: true }).focus();
  await expect(amount).toHaveValue('3 mo');
  await expect(page.getByLabel('Reminder 1 unit', { exact: true })).toHaveCount(0);
  await amount.fill(''); await page.getByLabel('Reminder 1 mode', { exact: true }).focus();
  await expect(amount).toHaveValue('3 mo');
});

test('reminder and travel presets commit the exact tapped choice without a keyboard blur race', async ({ page }, testInfo) => {
  await createWorkspaceAndItem(page);
  const editor = page.getByRole('dialog', { name: 'Item editor', exact: true });
  const activate = async (control: import('@playwright/test').Locator) => {
    if (testInfo.project.use.hasTouch) await control.tap(); else await control.click();
  };

  const reminders = page.locator('details').filter({ has: page.locator(':scope > summary').filter({ hasText: /^Reminders/ }) });
  await reminders.evaluate(el => { (el as HTMLDetailsElement).open = true; });
  await activate(editor.getByRole('button', { name: '+ Add reminder', exact: true }));
  await editor.getByLabel('Reminder 1 mode', { exact: true }).selectOption('before');
  const reminder = editor.getByLabel('Reminder 1 amount', { exact: true });
  const reminderChoices = editor.getByRole('group', { name: 'Reminder 1 amount units', exact: true });
  await reminder.focus();
  await expect(reminderChoices).toBeVisible();
  await activate(reminderChoices.getByRole('button', { name: '2 h', exact: true }));
  await expect(reminder).toHaveValue('2 h');
  await activate(reminderChoices.getByRole('button', { name: '45 min', exact: true }));
  await expect(reminder).toHaveValue('45 min');

  await editor.getByLabel('Event opens', { exact: true }).fill('2030-09-23T12:00');
  const travel = editor.locator('.travel-time-disclosure').first();
  await travel.locator(':scope > summary').click();
  const travelAmount = editor.getByLabel('Travel time amount', { exact: true });
  const travelChoices = editor.getByRole('group', { name: 'Travel time amount units', exact: true });
  await travelAmount.focus();
  await expect(travelChoices).toBeVisible();
  await activate(travelChoices.getByRole('button', { name: '3 h', exact: true }));
  await expect(travelAmount).toHaveValue('3 h');

  await activate(editor.getByRole('button', { name: 'Save item', exact: true }));
  await expect(editor).toBeHidden();
  if ((page.viewportSize()?.width ?? 0) <= 620) {
    await activate(page.getByRole('button', { name: 'Open navigation', exact: true }));
    await activate(page.locator('.mobile-nav-menu').getByRole('button', { name: /^All items/ }));
  } else await activate(page.locator('.sidebar').getByRole('button', { name: /^All items/ }));
  await page.locator('.item-card').filter({ hasText: 'Calendar block' }).first().locator('.item-main').click();
  await expect(editor).toBeVisible();
  await openDates(editor);
  await page.locator('details').filter({ has: page.locator(':scope > summary').filter({ hasText: /^Reminders/ }) }).evaluate(el => { (el as HTMLDetailsElement).open = true; });
  await expect(editor.getByLabel('Reminder 1 amount', { exact: true })).toHaveValue('45 min');
  await editor.locator('.travel-time-disclosure').first().locator(':scope > summary').click();
  await expect(editor.getByLabel('Travel time amount', { exact: true })).toHaveValue('3 h');
  await expect(editor.getByLabel('Travel time unit', { exact: true })).toHaveCount(0);
});

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

  await page.getByLabel('Calendar duration amount').fill('30 min');
  await opens.focus();
  await expect(page.getByLabel('Calendar duration amount')).toHaveValue('30 min');
  const difference = await page.evaluate(({ start, end }) => new Date(end).getTime() - new Date(start).getTime(), { start: await opens.inputValue(), end: await ends.inputValue() });
  expect(difference).toBe(30 * 60_000);
  await expect(due).toHaveValue('');

  const oneHourLater = await page.evaluate((start) => {
    const value = new Date(start);
    value.setHours(value.getHours() + 1);
    return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }, await opens.inputValue());
  await ends.fill(oneHourLater);
  await expect(page.getByLabel('Calendar duration amount')).toHaveValue('1 h');
  await page.getByRole('button', { name: 'Save item' }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
});

test('editing a title with a travel-back command keeps the existing event schedule', async ({ page }) => {
  await createWorkspaceAndItem(page);
  const opens = page.getByLabel('Event opens', { exact: true });
  const ends = page.getByLabel('Event ends', { exact: true });
  const start = await page.evaluate(() => {
    const date = new Date();
    date.setSeconds(0, 0);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  await opens.fill(start);
  await page.getByLabel('Duration preset').selectOption('1h');
  const originalEnd = await ends.inputValue();
  await page.getByLabel('Title', { exact: true }).fill('Meeting ттб 45м');
  await expect(opens).toHaveValue(start);
  await expect(ends).toHaveValue(originalEnd);
  await page.getByRole('button', { name: 'Save item' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
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
