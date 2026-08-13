import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/Please remember your password\./)).toBeVisible();
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('utm-secure-v1');
      request.onsuccess = () => resolve(); request.onerror = () => resolve(); request.onblocked = () => resolve();
    });
  });
  await page.reload();
});

test('lock screen uses a muted animated spectrum', async ({ page }) => {
  const lockScreen = page.locator('.lock-shell');
  await expect(page.locator('html')).toHaveCSS('font-size', '15px');
  await expect(lockScreen.locator('h1')).toHaveCSS('font-size', '30px');
  await expect(lockScreen.locator('h1')).toHaveCSS('font-weight', '600');
  await expect(lockScreen.locator('label').first()).toHaveCSS('font-weight', '500');
  await expect(lockScreen.locator('button.primary')).toHaveCSS('font-weight', '500');
  await expect(lockScreen).toHaveCSS('animation-name', 'ambient-spectrum');
  await expect(lockScreen).toHaveCSS('background-image', /radial-gradient/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(lockScreen).toHaveCSS('animation-name', 'none');
});

test('create, lock, unlock and edit a universal item', async ({ page }) => {
  await page.getByLabel('Workspace name').fill('My system');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await expect(page.getByText('Everything is clear')).toBeVisible();

  await page.getByPlaceholder('Capture anything…').fill('Prepare material by Thursday');
  await page.getByPlaceholder('Capture anything…').press('Enter');
  await expect(page.getByText('Prepare material by Thursday')).toBeVisible();

  await page.getByText('Prepare material by Thursday', { exact: true }).click();
  const scheduleSection = page.getByText('Schedule & deadline', { exact: true });
  await expect(scheduleSection).toHaveCSS('font-size', '13px');
  await expect(scheduleSection).toHaveCSS('font-weight', '500');
  await page.getByText('Reminders', { exact: true }).click();
  const addReminder = page.getByRole('button', { name: '+ Add reminder' });
  await expect(addReminder).toHaveCSS('font-size', '13px');
  await expect(addReminder).toHaveCSS('font-weight', '400');
  await expect(addReminder).toHaveCSS('padding-top', '8px');
  await page.getByText('System metadata', { exact: true }).click();
  await expect(page.getByText('Created at', { exact: true })).toBeVisible();
  await expect(page.getByText('Last modified', { exact: true })).toBeVisible();
  await expect(page.getByText('Universal Task Manager v0.3.4', { exact: true })).toBeVisible();
  await expect(page.getByText('dev.universal-task-manager', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Priority' }).selectOption({ label: '3 — High' });
  await page.getByRole('button', { name: 'Save item' }).click();
  const priority = page.getByRole('button', { name: 'Priority 3: High. Edit item' }).first();
  await expect(priority).toHaveAttribute('title', 'Priority 3: High. Click to edit.');
  await priority.click();
  await expect(page.getByRole('dialog', { name: 'Item editor' })).toBeVisible();
  const closeEditor = page.getByRole('button', { name: 'Close item editor' });
  await expect(closeEditor.locator('svg.close-icon')).toBeVisible();
  await expect(closeEditor).toHaveCSS('display', 'grid');
  await expect(closeEditor).toHaveCSS('align-items', 'center');
  await expect(closeEditor).toHaveCSS('justify-items', 'center');
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCSS('background-color', 'rgb(243, 243, 243)');
  await closeEditor.click();

  await page.getByRole('button', { name: 'Lock' }).click();
  await expect(page.getByRole('heading', { name: 'Unlock your workspace' })).toBeVisible();
  await page.getByLabel('Password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('Prepare material by Thursday')).toBeVisible();
  await page.getByRole('button', { name: 'All items' }).click();
  const openSection = page.locator('.all-sections details').filter({ has: page.getByText('open', { exact: true }) }).first();
  const openLabel = openSection.locator('summary > span');
  await expect(openLabel).toHaveCSS('font-size', '13px');
  await expect(openLabel).toHaveCSS('font-weight', '500');
  await expect(openLabel).toHaveCSS('color', 'rgb(68, 68, 68)');
  await expect(openSection.locator('.item-title')).toHaveCSS('font-size', '15px');
  await expect(openSection.locator('.item-title')).toHaveCSS('color', 'rgb(13, 13, 13)');
  await page.getByRole('button', { name: 'Views' }).click();
  const nowSection = page.locator('.view-section').filter({ hasText: 'Now' });
  await expect(nowSection.getByText('Prepare material by Thursday', { exact: true })).toBeVisible();
  await nowSection.getByRole('heading', { name: 'Now' }).click();
  await expect(nowSection.getByText('Prepare material by Thursday', { exact: true })).toBeHidden();
  await nowSection.getByRole('heading', { name: 'Now' }).click();
  await expect(nowSection.getByText('Prepare material by Thursday', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText('v0.3.4', { exact: true })).toBeVisible();
  await expect(page.getByText('Released', { exact: true })).toBeVisible();
});

test('mobile shell stays usable at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByLabel('Workspace name').fill('Mobile');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await expect(page.locator('.bottom-nav')).toBeVisible();
  await expect(page.locator('.bottom-nav svg.line-icon')).toHaveCount(5);
  await page.getByRole('button', { name: '+ New item' }).click();
  await expect(page.getByRole('dialog', { name: 'Item editor' })).toBeVisible();
});

test('edited view parameters change results and survive reload', async ({ page }) => {
  const password = 'correct horse battery staple';
  await page.getByLabel('Workspace name').fill('Persistent views');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await page.getByPlaceholder('Capture anything…').fill('Visible open item');
  await page.getByPlaceholder('Capture anything…').press('Enter');

  await page.getByRole('button', { name: 'Views' }).click();
  let view = page.locator('.view-section').filter({ hasText: 'Now' });
  const editView = view.getByRole('button', { name: 'Edit view' });
  await expect(editView).toHaveCSS('font-size', '13px');
  await expect(editView).toHaveCSS('font-weight', '400');
  await expect(editView).toHaveCSS('padding-top', '8px');
  await editView.click();
  await page.getByLabel('Name', { exact: true }).fill('Done only');
  await page.getByRole('combobox', { name: 'Field' }).selectOption('state');
  await page.getByRole('combobox', { name: 'Operator' }).selectOption('==');
  await page.getByRole('textbox', { name: 'Value' }).fill('done');
  await page.getByRole('combobox', { name: 'Renderer' }).selectOption('table');
  await expect(page.getByText('This condition will replace the DSL expression when you save.')).toBeVisible();
  await page.getByRole('button', { name: 'Save view' }).click();

  view = page.locator('.view-section').filter({ hasText: 'Done only' });
  await expect(view.getByText('state == "done"', { exact: true })).toBeVisible();
  await expect(view.getByText('table', { exact: true })).toBeVisible();
  await expect(view.getByText('0 matching items', { exact: true })).toBeVisible();
  await expect(view.getByText('Visible open item', { exact: true })).toBeHidden();

  await page.waitForTimeout(300);
  await page.reload();
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('button', { name: 'Views' }).click();
  view = page.locator('.view-section').filter({ hasText: 'Done only' });
  await expect(view.getByText('state == "done"', { exact: true })).toBeVisible();
  await expect(view.getByText('table', { exact: true })).toBeVisible();
  await expect(view.getByText('0 matching items', { exact: true })).toBeVisible();
});

test('visual view builder supports OR and inclusive comparison operators', async ({ page }) => {
  const password = 'correct horse battery staple';
  await page.getByLabel('Workspace name').fill('OR views');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();

  await page.getByRole('button', { name: '+ New item' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Priority two item');
  await page.getByRole('combobox', { name: 'Priority' }).selectOption({ label: '2 — Medium' });
  await page.getByRole('button', { name: 'Save item' }).click();

  await page.getByRole('button', { name: 'Views' }).click();
  await page.getByRole('button', { name: '+ New view' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Priority OR');
  await page.getByRole('combobox', { name: 'Field' }).selectOption('priority');
  await page.getByRole('combobox', { name: 'Operator' }).selectOption('==');
  await page.getByRole('textbox', { name: 'Value' }).fill('3');
  await page.getByRole('button', { name: 'Apply condition' }).click();
  await page.getByRole('combobox', { name: 'Operator' }).selectOption('<');
  await page.getByRole('textbox', { name: 'Value' }).fill('3');
  await page.getByRole('button', { name: '+ Add OR condition' }).click();
  await expect(page.getByLabel('DSL expression')).toHaveValue('priority == 3 || priority < 3');
  await page.getByRole('button', { name: 'Save view' }).click();

  const view = page.locator('.view-section').filter({ hasText: 'Priority OR' });
  await expect(view.getByText('priority == 3 || priority < 3', { exact: true })).toBeVisible();
  await expect(view.getByText('1 matching items', { exact: true })).toBeVisible();
  await expect(view.getByText('Priority two item', { exact: true })).toBeVisible();

  await view.getByRole('button', { name: 'Edit view' }).click();
  const operator = page.getByRole('combobox', { name: 'Operator' });
  await operator.selectOption({ label: '>=' });
  await page.getByRole('textbox', { name: 'Value' }).fill('2');
  await page.getByRole('button', { name: 'Apply condition' }).click();
  await operator.selectOption({ label: '<=' });
  await page.getByRole('textbox', { name: 'Value' }).fill('2');
  await page.getByRole('button', { name: '+ Add AND condition' }).click();
  await expect(page.getByLabel('DSL expression')).toHaveValue('priority >= 2 && priority <= 2');
  await page.getByRole('button', { name: 'Save view' }).click();
  await expect(view.getByText('priority >= 2 && priority <= 2', { exact: true })).toBeVisible();
  await expect(view.getByText('1 matching items', { exact: true })).toBeVisible();
  await expect(view.getByText('Priority two item', { exact: true })).toBeVisible();
});

test('notifications auto-hide, close individually, and remain in the bell center', async ({ page }) => {
  const password = 'correct horse battery staple';
  await page.getByLabel('Workspace name').fill('Notifications');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();

  await page.getByRole('button', { name: '+ New item' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Reminder item');
  await page.getByText('Reminders', { exact: true }).click();
  await page.getByRole('button', { name: '+ Add reminder' }).click();
  await page.getByRole('button', { name: '+ Add reminder' }).click();
  const past = await page.evaluate(() => {
    const date = new Date(Date.now() - 3_600_000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const reminderInputs = page.locator('.inline-row input[type="datetime-local"]');
  await reminderInputs.nth(0).fill(past);
  await reminderInputs.nth(1).fill(past);
  await page.getByRole('button', { name: 'Save item' }).click();
  await page.getByRole('button', { name: 'Lock' }).click();
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Unlock' }).click();

  const popups = page.locator('.notice-popups .notice-card');
  await expect(popups).toHaveCount(2);
  await page.getByRole('button', { name: 'Close notification' }).first().click();
  await expect(popups).toHaveCount(1);
  await page.waitForTimeout(3_200);
  await expect(page.locator('.notice-popups')).toBeHidden();

  await page.getByRole('button', { name: 'Notifications' }).click();
  const center = page.getByRole('complementary', { name: 'Notification center' });
  await expect(center).toBeVisible();
  await expect(center.locator('.notice-card')).toHaveCount(2);
  await center.getByRole('button', { name: 'Delete notification' }).first().click();
  await expect(center.locator('.notice-card')).toHaveCount(1);
  await center.getByRole('button', { name: 'Close notification center' }).click();
  await expect(center).toBeHidden();
});

test('recurring item accepts Due as its schedule anchor and explains missing dates', async ({ page }) => {
  await page.getByLabel('Workspace name').fill('Recurring items');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();

  await page.getByRole('button', { name: '+ New item' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Weekly due-only item');
  await page.getByText('Recurrence & auto-renew', { exact: true }).click();
  await page.getByLabel('Make this a recurring series').check();
  await page.getByRole('button', { name: 'Save item' }).click();
  await expect(page.getByRole('alert')).toHaveText('A recurring item needs a Start or Due date.');

  await page.getByText('Schedule & deadline', { exact: true }).click();
  const dueInOneHour = await page.evaluate(() => {
    const date = new Date(Date.now() + 3_600_000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  await page.getByLabel('Due', { exact: true }).fill(dueInOneHour);
  await expect(page.getByLabel('Due', { exact: true })).toHaveValue(dueInOneHour);
  await page.getByRole('button', { name: 'Save item' }).click();
  await expect(page.getByRole('dialog', { name: 'Item editor' })).toBeHidden();

  await page.getByRole('button', { name: 'All items' }).click();
  await page.getByText('series templates', { exact: true }).click();
  const templatesSection = page.locator('.all-sections details').filter({ has: page.getByText('series templates', { exact: true }) });
  await expect(templatesSection.getByText('Weekly due-only item', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Views' }).click();
  await page.getByRole('button', { name: '+ New view' }).click();
  await expect(page.getByLabel('DSL expression')).toHaveValue('state == "open"');
  await expect(page.getByLabel('DSL expression')).toHaveCSS('font-family', /monospace|Menlo|Monaco|Consolas/i);
  await page.getByLabel('Name').fill('Open items');
  await page.getByRole('button', { name: 'Save view' }).click();
  const openItemsView = page.locator('.view-section').filter({ hasText: 'Open items' });
  await expect(openItemsView.getByText('Weekly due-only item', { exact: true })).toHaveCount(1);
});
