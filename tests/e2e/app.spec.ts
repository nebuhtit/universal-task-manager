import { expect, test, type Locator } from '@playwright/test';

async function openViewDetails(view: Locator) {
  const details = view.locator('details.view-query-details');
  if (!await details.evaluate((element) => (element as HTMLDetailsElement).open)) await details.getByText('View details', { exact: true }).click();
}

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

test('archives Calendar and Automations while marking All items as beta', async ({ page }) => {
  await page.getByLabel('Workspace name').fill('Beta labels');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  const desktopBadges = page.locator('.sidebar .nav-beta');
  const badges = await desktopBadges.first().isVisible() ? desktopBadges : page.locator('.bottom-nav .nav-beta');
  await expect(badges).toHaveText(['Beta']);
  await expect(page.getByRole('button', { name: 'Calendar', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Automations', exact: true })).toHaveCount(0);
});

test('create, lock, unlock and edit a universal item', async ({ page }) => {
  await page.getByLabel('Workspace name').fill('My system');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await expect(page.getByText('Everything is clear')).toBeVisible();

  await page.getByPlaceholder('Add new task').fill('Prepare material by Thursday');
  await page.getByPlaceholder('Add new task').press('Enter');
  await expect(page.getByText('Prepare material by Thursday')).toBeVisible();
  await expect(page.getByText('1 active item', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Views' })).toHaveCount(0);

  await page.getByText('Prepare material by Thursday', { exact: true }).click();
  const editorSections = page.locator('.editor-scroll > details > summary');
  await expect(editorSections.nth(0)).toHaveText('Dates & time');
  await expect(editorSections.nth(1)).toHaveText('Reminders');
  const scheduleSection = page.getByText('Dates & time', { exact: true });
  await expect(scheduleSection).toHaveCSS('font-size', '13px');
  await expect(scheduleSection).toHaveCSS('font-weight', '500');
  await expect(page.getByLabel('Event opens')).toBeVisible();
  await expect(page.getByLabel('Event ends')).toBeVisible();
  await expect(page.getByLabel('Deadline')).toBeVisible();
  await expect(page.getByLabel('Available to work from')).toBeHidden();
  await page.locator('details.optional-field > summary').click();
  await expect(page.getByLabel('Available to work from')).toBeVisible();
  await expect(page.getByText('A deadline is the latest completion time.', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Timezone', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: /^Timezone / }).click();
  await expect(page.getByLabel('Timezone', { exact: true })).not.toHaveValue('');
  const addReminder = page.getByRole('button', { name: '+ Add reminder' });
  await expect(addReminder).toHaveCSS('font-size', '13px');
  await expect(addReminder).toHaveCSS('font-weight', '400');
  await expect(addReminder).toHaveCSS('padding-top', '8px');
  await page.getByText('System metadata', { exact: true }).click();
  await expect(page.getByText('Created at', { exact: true })).toBeVisible();
  await expect(page.getByText('Last modified', { exact: true })).toBeVisible();
  await expect(page.getByText('Universal Task Manager v1.0.5', { exact: true })).toBeVisible();
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
  await expect(closeEditor).toHaveCSS('width', '28px');
  await expect(closeEditor).toHaveCSS('height', '28px');
  const presetTask = page.locator('.segmented').getByRole('button', { name: 'task' });
  await expect(presetTask).toHaveCSS('font-size', '12px');
  await expect(presetTask).toHaveCSS('min-height', '30px');
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCSS('background-color', 'rgb(243, 243, 243)');
  await closeEditor.click();

  await page.getByRole('button', { name: 'Lock' }).click();
  await expect(page.getByRole('heading', { name: 'Unlock your workspace' })).toBeVisible();
  await page.getByLabel('Password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('Prepare material by Thursday')).toBeVisible();
  await page.getByRole('button', { name: /^All items/ }).click();
  const openSection = page.locator('.all-sections details').filter({ has: page.getByText('Active', { exact: true }) }).first();
  const openLabel = openSection.locator('summary > span');
  await expect(openLabel).toHaveCSS('font-size', '13px');
  await expect(openLabel).toHaveCSS('font-weight', '500');
  await expect(openLabel).toHaveCSS('color', 'rgb(68, 68, 68)');
  await expect(openSection.locator('.item-title')).toHaveCSS('font-size', '15px');
  await expect(openSection.locator('.item-title')).toHaveCSS('color', 'rgb(13, 13, 13)');
  await page.getByRole('button', { name: 'Home' }).click();
  const nowSection = page.locator('.view-section').filter({ hasText: 'Now' });
  await expect(nowSection.getByText('Prepare material by Thursday', { exact: true })).toBeVisible();
  await nowSection.getByRole('heading', { name: 'Now' }).click();
  await expect(nowSection.getByText('Prepare material by Thursday', { exact: true })).toBeHidden();
  await nowSection.getByRole('heading', { name: 'Now' }).click();
  await expect(nowSection.getByText('Prepare material by Thursday', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText('v1.0.5', { exact: true })).toBeVisible();
  await expect(page.getByText('Released', { exact: true })).toBeVisible();
});

test('mobile shell stays usable at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByLabel('Workspace name').fill('Mobile');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await expect(page.locator('.bottom-nav')).toBeVisible();
  await expect(page.locator('.bottom-nav svg.line-icon')).toHaveCount(3);
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('button', { name: /Encrypted Transfer/ })).toBeVisible();
  await page.getByRole('button', { name: /^All items/ }).click();
  await page.getByRole('button', { name: '+ New item' }).click();
  await expect(page.getByRole('dialog', { name: 'Item editor' })).toBeVisible();
});

test.skip('calendar switches modes and creates a timed universal item', async ({ page }, testInfo) => {
  await page.getByLabel('Workspace name').fill('Calendar workspace');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
  await page.getByRole('button', { name: 'Calendar settings' }).click();
  await expect(page.getByLabel('Wake time')).toHaveValue('08:00');
  await expect(page.getByLabel('Sleep time')).toHaveValue('22:00');
  await page.getByLabel('Wake time').fill('07:00');
  await page.getByLabel('Sleep time').fill('23:00');
  await page.getByRole('button', { name: 'Close calendar settings' }).click();
  if (testInfo.project.name === 'desktop') await expect(page.getByRole('grid', { name: /August 2026/ })).toBeVisible();
  else await expect(page.locator('.calendar-modes').getByRole('button', { name: 'day', exact: true })).toHaveClass(/active/);
  await page.locator('.calendar-modes').getByRole('button', { name: 'day', exact: true }).click();
  await expect(page.locator('[data-time="08:00:00"]').filter({ hasText: '8:00' }).first()).toBeVisible();
  await expect(page.locator('[data-time="06:00:00"].calendar-sleep-slot')).toHaveCount(1);
  await expect(page.locator('[data-time="07:00:00"].calendar-sleep-slot')).toHaveCount(0);
  await expect(page.locator('[data-time="23:00:00"].calendar-sleep-slot')).toHaveCount(1);
  const timedGrid = page.getByRole('row', { name: 'Timed' }).getByRole('gridcell');
  await expect(timedGrid).toBeVisible();
  await timedGrid.click({ position: { x: 80, y: 80 } });
  await expect(page.getByRole('heading', { name: 'New calendar item' })).toBeVisible();
  await page.getByLabel('Title', { exact: true }).fill('Calendar-created task');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Calendar-created task', { exact: true })).toBeVisible();
  const calendarEvent = page.locator('.calendar-time-event').filter({ hasText: 'Calendar-created task' });
  await expect(calendarEvent).toHaveCount(1);
  await expect(calendarEvent).toHaveCSS('border-top-width', '1px');
  await page.getByRole('button', { name: 'Home' }).click();
  await page.getByRole('button', { name: '+ New view' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Items below priority 3');
  await page.getByLabel('DSL expression').fill('priority < 3');
  await page.getByRole('button', { name: 'Save view' }).click();
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await page.getByRole('combobox', { name: 'Saved view' }).selectOption({ label: 'Items below priority 3' });
  await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Saved view' })).toHaveValue(/.+/);
});

test('deleted items appear in Trash and can be restored', async ({ page }) => {
  const password = 'correct horse battery staple';
  await page.getByLabel('Workspace name').fill('Trash workspace');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await page.getByRole('button', { name: /^All items/ }).click();
  await page.getByRole('button', { name: '+ New item' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Recover this item');
  await page.getByRole('button', { name: 'Save item' }).click();
  await page.getByText('Recover this item', { exact: true }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();

  const trash = page.locator('.trash-section');
  await expect(trash.getByText('Recover this item', { exact: true })).toBeVisible();
  await expect(trash.locator('.trash-item').getByText(/^Deleted /)).toBeVisible();
  await trash.getByRole('button', { name: 'Restore Recover this item' }).click();
  await expect(trash.locator('summary b')).toHaveText('0');
  await expect(page.locator('.all-sections').getByText('Recover this item', { exact: true })).toBeVisible();

  await page.waitForTimeout(300);
  await page.reload();
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('button', { name: /^All items/ }).click();
  await expect(page.locator('.all-sections').getByText('Recover this item', { exact: true })).toBeVisible();
  await expect(page.locator('.trash-section summary b')).toHaveText('0');
});

test('edited view parameters change results and survive reload', async ({ page }) => {
  const password = 'correct horse battery staple';
  await page.getByLabel('Workspace name').fill('Persistent views');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await page.getByPlaceholder('Add new task').fill('Visible open item');
  await page.getByPlaceholder('Add new task').press('Enter');

  let view = page.locator('.view-section').filter({ hasText: 'Now' });
  const editView = view.getByRole('button', { name: 'Edit view' });
  await expect(view.getByText('Export', { exact: true })).toHaveCount(0);
  await expect(editView).toHaveCSS('font-size', '13px');
  await expect(editView).toHaveCSS('font-weight', '400');
  await expect(editView).toHaveCSS('padding-top', '8px');
  await editView.click();
  await expect(page.getByRole('button', { name: 'Definition', exact: true })).toBeHidden();
  await page.getByText('Export view', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Definition', exact: true })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('Done only');
  await page.getByRole('combobox', { name: 'Field', exact: true }).selectOption('state');
  await page.getByRole('combobox', { name: 'Operator' }).selectOption('==');
  await page.getByRole('combobox', { name: 'Value', exact: true }).selectOption('done');
  await page.getByRole('combobox', { name: 'Renderer' }).selectOption('table');
  await expect(page.getByText('This condition will replace the DSL expression when you save.')).toBeVisible();
  await page.getByRole('button', { name: 'Save view' }).click();

  view = page.locator('.view-section').filter({ hasText: 'Done only' });
  await openViewDetails(view);
  await expect(view.getByText('state == "done"', { exact: true })).toBeVisible();
  await expect(view.getByText('table', { exact: true })).toBeVisible();
  await expect(view.getByText('0 matching items', { exact: true })).toBeVisible();
  await expect(view.getByText('Visible open item', { exact: true })).toBeHidden();

  await page.waitForTimeout(300);
  await page.reload();
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Unlock' }).click();
  view = page.locator('.view-section').filter({ hasText: 'Done only' });
  await openViewDetails(view);
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

  await page.getByRole('button', { name: 'All items' }).click();
  await page.getByRole('button', { name: '+ New item' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Priority two item');
  await page.getByRole('combobox', { name: 'Priority' }).selectOption({ label: '2 — Medium' });
  await page.getByRole('button', { name: 'Save item' }).click();

  await page.getByRole('button', { name: 'Home' }).click();
  await page.getByRole('button', { name: '+ New view' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Priority OR');
  await page.getByRole('combobox', { name: 'Field', exact: true }).selectOption('priority');
  await page.getByRole('combobox', { name: 'Operator' }).selectOption('==');
  await page.getByRole('combobox', { name: 'Value', exact: true }).selectOption('3');
  await page.getByRole('button', { name: 'Apply condition' }).click();
  await page.getByRole('combobox', { name: 'Operator' }).selectOption('<');
  await page.getByRole('combobox', { name: 'Value', exact: true }).selectOption('3');
  await page.getByRole('button', { name: '+ Add OR condition' }).click();
  await expect(page.getByLabel('DSL expression')).toHaveValue('priority == 3 || priority < 3');
  await page.getByRole('button', { name: 'Save view' }).click();

  const view = page.locator('.view-section').filter({ hasText: 'Priority OR' });
  await openViewDetails(view);
  await expect(view.getByText('priority == 3 || priority < 3', { exact: true })).toBeVisible();
  await expect(view.getByText('1 matching items', { exact: true })).toBeVisible();
  await expect(view.getByText('Priority two item', { exact: true })).toBeVisible();

  await view.getByRole('button', { name: 'Edit view' }).click();
  const operator = page.getByRole('combobox', { name: 'Operator' });
  await operator.selectOption({ label: '>=' });
  await page.getByRole('combobox', { name: 'Value', exact: true }).selectOption('2');
  await page.getByRole('button', { name: 'Apply condition' }).click();
  await operator.selectOption({ label: '<=' });
  await page.getByRole('combobox', { name: 'Value', exact: true }).selectOption('2');
  await page.getByRole('button', { name: '+ Add AND condition' }).click();
  await expect(page.getByLabel('DSL expression')).toHaveValue('priority >= 2 && priority <= 2');
  await page.getByRole('button', { name: 'Save view' }).click();
  await expect(view.getByText('priority >= 2 && priority <= 2', { exact: true })).toBeVisible();
  await expect(view.getByText('1 matching items', { exact: true })).toBeVisible();
  await expect(view.getByText('Priority two item', { exact: true })).toBeVisible();
});

test('habit view includes a recurring habit without duplicating its occurrence', async ({ page }) => {
  await page.getByLabel('Workspace name').fill('Habit views');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await page.getByRole('button', { name: 'All items' }).click();
  await page.getByRole('button', { name: '+ New item' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Daily walk');
  await page.getByRole('button', { name: 'habit', exact: true }).click();
  await page.getByText('Recurrence & auto-renew', { exact: true }).click();
  await page.getByLabel('Make this a recurring series').check();
  await page.getByRole('button', { name: 'Save item' }).click();

  await page.getByRole('button', { name: 'Home' }).click();
  await page.getByRole('button', { name: '+ New view' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Habits');
  await page.getByRole('combobox', { name: 'Field', exact: true }).selectOption('preset');
  await page.getByRole('combobox', { name: 'Value', exact: true }).selectOption('habit');
  await page.getByRole('button', { name: 'Apply condition' }).click();
  await page.getByRole('button', { name: 'Save view' }).click();

  const habitView = page.locator('.view-section').filter({ hasText: 'Habits' });
  await openViewDetails(habitView);
  await expect(habitView.getByText('1 matching items', { exact: true })).toBeVisible();
  await expect(habitView.getByText('Daily walk', { exact: true })).toHaveCount(1);
  await habitView.getByRole('button', { name: 'Complete habit today' }).click();
  await expect(habitView.getByRole('button', { name: 'Undo habit completion today' })).toBeVisible();
  await habitView.getByText('Daily walk', { exact: true }).click();
  await page.getByText('Item JSON', { exact: true }).click();
  await expect(page.getByLabel('Item JSON')).toHaveValue(/"completedDates": \[\s+"\d{4}-\d{2}-\d{2}"/);
});

test('saved view applies multi-rule sort DSL and displayed field selection', async ({ page }) => {
  await page.getByLabel('Workspace name').fill('Sorted views');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();

  await page.getByRole('button', { name: 'All items' }).click();
  for (const [title, priority] of [['Low item', '1'], ['High item', '4']] as const) {
    await page.getByRole('button', { name: '+ New item' }).click();
    await page.getByLabel('Title', { exact: true }).fill(title);
    await page.getByRole('combobox', { name: 'Priority' }).selectOption(priority);
    await page.getByRole('button', { name: 'Save item' }).click();
  }

  await page.getByRole('button', { name: 'Home' }).click();
  const view = page.locator('.view-section').filter({ hasText: 'Now' });
  await view.getByRole('button', { name: 'Edit view' }).click();
  await page.getByRole('combobox', { name: 'Renderer' }).selectOption('table');
  const sortField = page.getByRole('combobox', { name: 'Sort field 1' });
  await expect(sortField.locator('option')).toHaveCount(51);
  await expect(sortField.locator('option', { hasText: 'Priority' })).toHaveCount(1);
  await sortField.selectOption('priority');
  await expect(page.getByLabel('Sort DSL')).toHaveValue('priority asc nulls last');
  await page.getByRole('button', { name: 'Hide all' }).click();
  const coreFields = page.locator('.field-groups details').filter({ has: page.getByText('Core', { exact: true }) });
  await coreFields.getByText('Core', { exact: true }).click();
  await coreFields.locator('label.check').filter({ hasText: /^Title/ }).getByRole('checkbox').check();
  await coreFields.locator('label.check').filter({ hasText: /^Priority/ }).getByRole('checkbox').check();
  await page.getByLabel('Sort DSL').fill('priority desc nulls last\nlower(title) asc nulls last');
  await page.getByRole('button', { name: 'Save view' }).click();

  await openViewDetails(view);
  await expect(view.locator('thead th')).toHaveText(['Complete', 'Title', 'Priority']);
  await expect(view.locator('thead')).not.toContainText('State');
  const rows = view.locator('tbody tr');
  await expect(rows.nth(0)).toContainText('High item');
  await expect(rows.nth(1)).toContainText('Low item');
  await expect(view.getByText(/Sort: priority desc nulls last/)).toBeVisible();

  await view.getByRole('button', { name: 'Edit view' }).click();
  await page.getByRole('button', { name: 'Delete view' }).click();
  await page.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(view).toHaveCount(0);
});

test('table and board renderers can complete and reopen items', async ({ page }) => {
  await page.getByLabel('Workspace name').fill('Renderer actions');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await page.getByRole('button', { name: 'All items' }).click();
  await page.getByRole('button', { name: '+ New item' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Renderer item');
  await page.locator('.segmented').getByRole('button', { name: 'event' }).click();
  const startInOneHour = await page.evaluate(() => {
    const date = new Date(Date.now() + 3_600_000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  await page.getByLabel('Event opens', { exact: true }).fill(startInOneHour);
  await page.getByRole('button', { name: 'Save item' }).click();
  await page.getByRole('button', { name: 'Home' }).click();

  const view = page.locator('.view-section').filter({ hasText: 'Now' });
  for (const renderer of ['table', 'board']) {
    await view.getByRole('button', { name: 'Edit view' }).click();
    await page.getByLabel('DSL expression').fill('true');
    await page.getByRole('combobox', { name: 'Renderer' }).selectOption(renderer);
    await page.getByRole('button', { name: 'Save view' }).click();
    await view.getByRole('button', { name: 'Complete Renderer item' }).click();
    await expect(view.getByRole('button', { name: 'Reopen Renderer item' })).toBeVisible();
    await view.getByRole('button', { name: 'Reopen Renderer item' }).click();
    await expect(view.getByRole('button', { name: 'Complete Renderer item' })).toBeVisible();
  }
});

test('notifications auto-hide, close individually, and remain in the bell center', async ({ page }) => {
  const password = 'correct horse battery staple';
  await page.getByLabel('Workspace name').fill('Notifications');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();

  await page.getByRole('button', { name: 'All items' }).click();
  await page.getByRole('button', { name: '+ New item' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Reminder item');
  await page.getByRole('button', { name: '+ Add reminder' }).click();
  await page.getByRole('button', { name: '+ Add reminder' }).click();
  const past = await page.evaluate(() => {
    const date = new Date(Date.now() - 3_600_000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const reminderInputs = page.locator('.inline-row input[type="datetime-local"]');
  await reminderInputs.nth(0).fill(past);
  await reminderInputs.nth(1).fill(past);
  await page.locator('.inline-row select').nth(1).selectOption('critical');
  await page.getByRole('button', { name: 'Save item' }).click();
  await page.getByRole('button', { name: 'Lock' }).click();
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Unlock' }).click();

  const popups = page.locator('.notice-popups .notice-card');
  await expect(popups).toHaveCount(1);
  await expect(popups.getByText('Reminders · 2 · critical', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close notification' }).click();
  await expect(popups).toHaveCount(0);
  await page.waitForTimeout(3_200);
  await expect(page.locator('.notice-popups')).toBeHidden();

  await page.getByRole('button', { name: 'Notifications' }).click();
  const center = page.getByRole('complementary', { name: 'Notification center' });
  await expect(center).toBeVisible();
  await expect(center.locator('.notice-card')).toHaveCount(1);
  await expect(center.getByText('Reminders · 2 · critical', { exact: true })).toBeVisible();
  await center.getByRole('button', { name: 'Delete notification' }).click();
  await expect(center.locator('.notice-card')).toHaveCount(0);
  await center.getByRole('button', { name: 'Close notification center' }).click();
  await expect(center).toBeHidden();
  await page.getByRole('button', { name: 'Lock' }).click();
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.locator('.notice-card')).toHaveCount(0);
});

test('identical reminders are stored and displayed only once', async ({ page }) => {
  const password = 'correct horse battery staple';
  await page.getByLabel('Workspace name').fill('Reminder deduplication');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();

  await page.getByRole('button', { name: 'All items' }).click();
  await page.getByRole('button', { name: '+ New item' }).click();
  await page.getByLabel('Title', { exact: true }).fill('One urgent reminder');
  await page.getByRole('button', { name: '+ Add reminder' }).click();
  await page.getByRole('button', { name: '+ Add reminder' }).click();
  const past = await page.evaluate(() => {
    const date = new Date(Date.now() - 3_600_000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const rows = page.locator('.inline-row').filter({ has: page.locator('input[type="datetime-local"]') });
  await rows.nth(0).locator('input').fill(past);
  await rows.nth(1).locator('input').fill(past);
  await rows.nth(0).locator('select').selectOption('urgent');
  await rows.nth(1).locator('select').selectOption('urgent');
  await page.getByRole('button', { name: 'Save item' }).click();
  await page.getByRole('button', { name: 'Lock' }).click();
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Unlock' }).click();

  await expect(page.locator('.notice-popups .notice-card')).toHaveCount(1);
  await expect(page.locator('.notice-button b')).toHaveText('1');
  await page.getByRole('button', { name: 'Notifications' }).click();
  await expect(page.getByRole('complementary', { name: 'Notification center' }).locator('.notice-card')).toHaveCount(1);
});

test('closed items do not emit overdue reminders', async ({ page }) => {
  const password = 'correct horse battery staple';
  await page.getByLabel('Workspace name').fill('Active reminders');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await page.getByRole('button', { name: 'All items' }).click();
  await page.getByRole('button', { name: '+ New item' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Window reminder');
  await page.getByRole('button', { name: '+ Add reminder' }).click();
  const past = await page.evaluate(() => {
    const date = new Date(Date.now() - 3_600_000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  await page.getByLabel('Reminder 1 time').fill(past);
  await page.getByRole('button', { name: 'Save item' }).click();
  await page.getByRole('button', { name: 'Complete item' }).click();
  await page.getByRole('button', { name: 'Lock' }).click();
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.locator('.notice-card')).toHaveCount(0);
});

test('recurring item accepts Deadline as its schedule anchor and explains missing dates', async ({ page }) => {
  await page.getByLabel('Workspace name').fill('Recurring items');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();

  await page.getByRole('button', { name: 'All items' }).click();
  await page.getByRole('button', { name: '+ New item' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Weekly due-only item');
  await expect(page.getByLabel('Event opens', { exact: true })).not.toHaveValue('');
  await page.getByLabel('Event opens', { exact: true }).fill('');
  await page.getByText('Recurrence & auto-renew', { exact: true }).click();
  await page.getByLabel('Make this a recurring series').check();
  await page.getByLabel('Repeat frequency').selectOption('WEEKLY');
  await page.getByLabel('Repeat interval').fill('2');
  await page.getByRole('button', { name: 'Repeat on TH' }).click();
  await page.getByText('Advanced recurrence behavior', { exact: true }).click();
  await page.getByLabel('Activation amount').fill('3');
  await page.getByLabel('Activation unit').selectOption('days');
  await expect(page.getByLabel(/Repeat rule/)).toHaveValue('FREQ=WEEKLY;INTERVAL=2;BYDAY=TH');
  await expect(page.getByLabel(/Activation duration/)).toHaveValue('P3D');
  await page.getByRole('button', { name: 'Save item' }).click();
  await expect(page.getByRole('alert')).toHaveText('A recurring item needs a Scheduled start or Deadline.');

  const dueInOneHour = await page.evaluate(() => {
    const date = new Date(Date.now() + 3_600_000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  await page.getByLabel('Deadline', { exact: true }).fill(dueInOneHour);
  await expect(page.getByLabel('Deadline', { exact: true })).toHaveValue(dueInOneHour);
  await page.getByRole('button', { name: 'Save item' }).click();
  await expect(page.getByRole('dialog', { name: 'Item editor' })).toBeHidden();

  await page.getByRole('button', { name: 'All items' }).click();
  const templatesSection = page.locator('.all-sections details').filter({ has: page.getByText('Recurring items', { exact: true }) });
  await expect(templatesSection).toHaveAttribute('open', '');
  await expect(templatesSection.getByText('These are the repeating source items. Each scheduled cycle appears separately in the status sections above.')).toBeVisible();
  await expect(templatesSection.getByText('Weekly due-only item', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Home' }).click();
  await page.getByRole('button', { name: '+ New view' }).click();
  await expect(page.getByLabel('DSL expression')).toHaveValue('(state == "open" || state == "done") && role != "series_template"');
  await expect(page.getByLabel('DSL expression')).toHaveCSS('font-family', /monospace|Menlo|Monaco|Consolas/i);
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Open items');
  await page.getByRole('button', { name: 'Save view' }).click();
  const openItemsView = page.locator('.view-section').filter({ hasText: 'Open items' });
  await expect(openItemsView.getByText('Weekly due-only item', { exact: true })).toHaveCount(1);
});

test('active window reuses recurrence fields without duplicating controls', async ({ page }) => {
  await page.getByLabel('Workspace name').fill('Active window');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await page.getByRole('button', { name: 'All items' }).click();
  await page.getByRole('button', { name: '+ New item' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Prepare lessons');
  const dates = await page.evaluate(() => {
    const opens = new Date(Date.now() + 60 * 60 * 1_000);
    const closes = new Date(opens.getTime() + 3 * 24 * 60 * 60 * 1_000);
    const local = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    return { opens: local(opens), closes: local(closes) };
  });
  await page.getByLabel('Event opens').fill(dates.opens);
  await page.getByLabel('Deadline').fill(dates.closes);
  await page.getByText('Recurrence & auto-renew', { exact: true }).click();
  await page.getByLabel('Make this a recurring series').check();
  await page.getByLabel('Only show during the active range').check();
  await expect(page.getByText('Event opens', { exact: true })).toBeVisible();
  await expect(page.getByText('Active range ends', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Activation amount')).toBeHidden();
  await page.getByText('Advanced recurrence behavior', { exact: true }).click();
  await expect(page.getByLabel('Activation amount')).toHaveValue('0');
  await expect(page.getByRole('combobox', { name: 'Auto-close' })).toHaveValue('due');
  await page.getByRole('button', { name: 'Save item' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
