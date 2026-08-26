import { expect, test, type Locator, type Page } from '@playwright/test';

async function openViewDetails(view: Locator) {
  const details = view.locator('details.view-query-details');
  if (!await details.evaluate((element) => (element as HTMLDetailsElement).open)) await details.getByText('View details', { exact: true }).click();
}

async function goToAllItems(page: Page) {
  const desktop = page.locator('.sidebar').getByRole('button', { name: /^All items/ });
  if ((page.viewportSize()?.width ?? 0) > 620) {
    await expect(desktop).toBeVisible();
    await desktop.click();
  } else {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.locator('.mobile-nav-menu').getByRole('button', { name: /^All items/ }).click();
  }
}

async function goHome(page: Page) {
  if ((page.viewportSize()?.width ?? 0) > 620) await page.locator('.sidebar').getByRole('button', { name: 'Home' }).click();
  else {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.locator('.mobile-nav-menu').getByRole('button', { name: 'Home' }).click();
  }
}

async function goToSettings(page: Page) {
  if ((page.viewportSize()?.width ?? 0) > 620) await page.locator('.sidebar').getByRole('button', { name: 'Settings' }).click();
  else {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.locator('.mobile-nav-menu').getByRole('button', { name: 'Settings' }).click();
  }
}

async function goToCalendar(page: Page) {
  if ((page.viewportSize()?.width ?? 0) > 620) await page.locator('.sidebar').getByRole('button', { name: 'Calendar', exact: true }).click();
  else {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.locator('.mobile-nav-menu').getByRole('button', { name: 'Calendar', exact: true }).click();
  }
}

async function lockWorkspace(page: Page) {
  const button = page.locator('.sidebar .sidebar-bottom button').filter({ hasText: 'Lock' });
  if (await button.isVisible()) await button.click();
  else await button.evaluate((element: HTMLButtonElement) => element.click());
}

async function openNewItem(page: Page) {
  await page.getByPlaceholder('Add new item').fill('New item');
  await page.getByPlaceholder('Add new item').press('Enter');
  await expect(page.getByRole('dialog', { name: 'Item editor' })).toBeVisible();
}

async function openEditorSection(page: Page, name: string) {
  const summary = page.locator('.editor-scroll > details > summary').filter({ hasText: name }).first();
  const details = summary.locator('..');
  if (!await details.evaluate((element) => (element as HTMLDetailsElement).open)) await summary.click();
  return details;
}

async function openViewEditorSection(page: Page, name: string) {
  const details = page.locator('.view-editor details.view-editor-section').filter({ has: page.getByText(name, { exact: true }) }).first();
  if (!await details.evaluate((element) => (element as HTMLDetailsElement).open)) await details.locator(':scope > summary').click();
  return details;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/Please remember your password\./)).toBeVisible();
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

test('shows the release version on registration, login and settings', async ({ page }) => {
  const releaseLabel = /^v1\.12\.0 · commit [0-9a-f]{7}$/;
  await expect(page.locator('.lock-version')).toHaveText(releaseLabel);

  await page.getByLabel('Workspace name').fill('Release version');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();

  await goToSettings(page);
  await expect(page.getByText('v1.12.0', { exact: true })).toBeVisible();

  await lockWorkspace(page);
  await expect(page.getByRole('heading', { name: 'Unlock your workspace' })).toBeVisible();
  await expect(page.locator('.lock-version')).toHaveText(releaseLabel);
});

test('archives Calendar and Automations while marking All items as beta', async ({ page }) => {
  await page.getByLabel('Workspace name').fill('Beta labels');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await expect(page.locator('.sidebar .nav-beta')).toHaveText(['Beta']);
  await expect(page.getByRole('button', { name: 'Calendar', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Automations', exact: true })).toHaveCount(0);
});

test('create, lock, unlock and edit a universal item', async ({ page }) => {
  await page.getByLabel('Workspace name').fill('My system');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await expect(page.getByPlaceholder('Add new item')).toBeVisible();

  await page.getByPlaceholder('Add new item').fill('Prepare material by Thursday');
  await page.getByPlaceholder('Add new item').press('Enter');
  await expect(page.getByRole('heading', { name: 'Views' })).toHaveCount(0);

  // Quick capture opens the just-created item immediately, so the user can
  // refine it without finding it again in the view.
  await expect(page.getByRole('dialog', { name: 'Item editor' })).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Prepare material by Thursday');
  const editorSections = page.locator('.editor-scroll > details > summary');
  await expect(editorSections.filter({ hasText: 'Description' })).toHaveCount(1);
  await expect(editorSections.filter({ hasText: 'Dates & time' })).toHaveCount(1);
  const scheduleSection = page.getByText('Dates & time', { exact: true });
  await expect(scheduleSection).toHaveCSS('font-size', '13px');
  await expect(scheduleSection).toHaveCSS('font-weight', '550');
  await openEditorSection(page, 'Dates & time');
  await expect(page.getByLabel('Event opens', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Event ends', { exact: true })).toBeVisible();
  await expect(page.locator('input[aria-label="Due / Active range ends"]')).toBeVisible();
  await expect(page.getByLabel('Available to work from', { exact: true })).toBeHidden();
  await page.locator('details.optional-field > summary').click();
  await expect(page.getByLabel('Available to work from', { exact: true })).toBeVisible();
  await expect(page.getByText('A deadline is the latest completion time.', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Timezone', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: /^Timezone / }).click();
  await expect(page.getByLabel('Timezone', { exact: true })).not.toHaveValue('');
  await openEditorSection(page, 'Reminders');
  const addReminder = page.getByRole('button', { name: '+ Add reminder' });
  await expect(addReminder).toHaveCSS('font-size', '13px');
  await expect(addReminder).toHaveCSS('font-weight', '400');
  await expect(addReminder).toHaveCSS('padding-top', '8px');
  await page.getByText('System metadata', { exact: true }).click();
  await expect(page.getByText('Created at', { exact: true })).toBeVisible();
  await expect(page.getByText('Last modified', { exact: true })).toBeVisible();
  await expect(page.getByText(/Universal Task Manager v\d+\.\d+\.\d+/, { exact: true })).toBeVisible();
  await expect(page.getByText('dev.universal-task-manager', { exact: true })).toBeVisible();
  const prioritySection = await openEditorSection(page, 'Priority');
  await prioritySection.locator('select').selectOption({ label: '3 — High' });
  await page.getByRole('button', { name: 'Save item' }).click();
  await page.getByText('Prepare material by Thursday', { exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: 'Item editor' })).toBeVisible();
  const closeEditor = page.getByRole('button', { name: 'Close item editor' });
  await expect(closeEditor.locator('svg.close-icon')).toBeVisible();
  await expect(closeEditor).toHaveCSS('display', 'grid');
  await expect(closeEditor).toHaveCSS('align-items', 'center');
  await expect(closeEditor).toHaveCSS('justify-items', 'center');
  await expect(closeEditor).toHaveCSS('width', '28px');
  await expect(closeEditor).toHaveCSS('height', '28px');
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCSS('background-color', 'rgb(243, 243, 243)');
  await closeEditor.click();

  await lockWorkspace(page);
  await expect(page.getByRole('heading', { name: 'Unlock your workspace' })).toBeVisible();
  await page.getByLabel('Password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('Prepare material by Thursday', { exact: true }).first()).toBeVisible();
  await goToAllItems(page);
  await expect(page.locator('.all-sections > details').first().locator('summary')).toContainText('Active1');
  await goHome(page);
  const nowSection = page.locator('.view-section').filter({ hasText: 'All items' });
  await expect(nowSection.getByText('Prepare material by Thursday', { exact: true })).toBeVisible();
  await nowSection.getByRole('button', { name: 'Collapse All items' }).click();
  await expect(nowSection.getByText('Prepare material by Thursday', { exact: true })).toBeHidden();
  await expect(page.locator('.collapsed-views-stack').locator('.view-section').filter({ hasText: 'All items' })).toBeVisible();
  await expect.poll(async () => {
    const stack = await page.locator('.views-stack').boundingBox();
    const collapsed = await page.locator('.collapsed-views-stack').boundingBox();
    return stack && collapsed ? Math.abs(stack.y + stack.height - collapsed.y - collapsed.height) : Number.POSITIVE_INFINITY;
  }).toBeLessThan(2);
  await nowSection.getByRole('button', { name: 'Expand All items' }).click();
  await expect(nowSection.getByText('Prepare material by Thursday', { exact: true })).toBeVisible();
  await expect(page.locator('.expanded-views-stack').locator('.view-section').filter({ hasText: 'All items' })).toBeVisible();

  await goToSettings(page);
  await expect(page.getByText(/^v\d+\.\d+\.\d+$/, { exact: true })).toBeVisible();
  await expect(page.getByText('Released', { exact: true })).toBeVisible();
});

test('mobile shell stays usable at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByLabel('Workspace name').fill('Mobile');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.locator('.mobile-nav-menu').getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('button', { name: /Encrypted Transfer/ })).toBeVisible();
  await goToAllItems(page);
  await openNewItem(page);
  await expect(page.getByRole('dialog', { name: 'Item editor' })).toBeVisible();
});

test('settings sections stay on one content rail without horizontal overflow', async ({ page }) => {
  await page.getByLabel('Workspace name').fill('Settings layout');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await goToSettings(page);

  const cards = page.locator('.settings-page-shell .settings-card');
  await expect(cards).toHaveCount(6);
  const boxes = await cards.evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right };
  }));
  expect(new Set(boxes.map((box) => Math.round(box.left))).size).toBe(1);
  expect(new Set(boxes.map((box) => Math.round(box.right))).size).toBe(1);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test.skip('calendar switches modes and creates a timed universal item', async ({ page }, testInfo) => {
  await page.getByLabel('Workspace name').fill('Calendar workspace');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await goToCalendar(page);
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
  await goHome(page);
  await page.getByRole('button', { name: 'New view' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Items below priority 3');
  await openViewEditorSection(page, 'Advanced filter code');
  await page.getByLabel('Advanced filter code').fill('priority < 3');
  await page.getByRole('button', { name: 'Save view' }).click();
  await goToCalendar(page);
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
  await goToAllItems(page);
  await openNewItem(page);
  await page.getByLabel('Title', { exact: true }).fill('Recover this item');
  await page.getByRole('button', { name: 'Save item' }).click();
  await page.locator('.all-sections .item-main').first().click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();

  const trash = page.locator('.trash-section');
  await expect(trash.getByText('Recover this item', { exact: true })).toBeVisible();
  await expect(trash.locator('.trash-item').getByText(/^Deleted /)).toBeVisible();
  await trash.getByRole('button', { name: 'Restore Recover this item' }).click();
  await expect(trash.locator('summary b')).toHaveText('0');
  await expect(page.locator('.all-sections > details').first().locator('summary')).toContainText('Active1');

  await page.waitForTimeout(300);
  await page.reload();
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await goToAllItems(page);
  await expect(page.locator('.all-sections > details').first().locator('summary')).toContainText('Active1');
  await expect(page.locator('.trash-section summary b')).toHaveText('0');
});

test('edited view parameters change results and survive reload', async ({ page }) => {
  const password = 'correct horse battery staple';
  await page.getByLabel('Workspace name').fill('Persistent views');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await page.getByPlaceholder('Add new item').fill('Visible open item');
  await page.getByPlaceholder('Add new item').press('Enter');
  await page.getByRole('button', { name: 'Close item editor' }).click();

  let view = page.locator('.view-section').filter({ hasText: 'All items' });
  const editView = view.getByRole('button', { name: /^Edit /  });
  await expect(view.getByText('Export', { exact: true })).toHaveCount(0);
  await editView.click();
  await openViewEditorSection(page, 'Visual setup');
  await expect(page.locator('.visual-query-builder').getByRole('heading', { name: '2. Show in results' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Definition JSON', exact: true })).toBeHidden();
  await page.getByText('Export view', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Definition JSON', exact: true })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('Done only');
  while (await page.locator('.visual-condition-row').count() > 1) await page.getByRole('button', { name: /Remove filter rule/ }).last().click();
  const rule = page.locator('.visual-condition-row').first();
  await rule.getByRole('combobox', { name: 'Property' }).selectOption('state');
  await rule.getByRole('combobox', { name: 'Operator' }).selectOption('==');
  await rule.getByRole('combobox', { name: 'Value' }).selectOption('done');
  await page.getByRole('combobox', { name: 'Renderer' }).selectOption('table');
  await openViewEditorSection(page, 'Advanced filter code');
  await expect(page.getByLabel('Advanced filter code')).toHaveValue('state == "done"');
  await page.getByRole('button', { name: 'Save view' }).click();

  view = page.locator('.view-section').filter({ hasText: 'Done only' });
  await expect(view.getByRole('heading', { name: 'Done only' })).toBeVisible();
  await expect(view.getByText('Visible open item', { exact: true })).toBeHidden();

  await page.waitForTimeout(300);
  await page.reload();
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Unlock' }).click();
  view = page.locator('.view-section').filter({ hasText: 'Done only' });
  await expect(view.getByRole('heading', { name: 'Done only' })).toBeVisible();
  await expect(view.getByText('Visible open item', { exact: true })).toBeHidden();
});

test('visual view builder supports OR and inclusive comparison operators', async ({ page }) => {
  const password = 'correct horse battery staple';
  await page.getByLabel('Workspace name').fill('OR views');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();

  await goToAllItems(page);
  await openNewItem(page);
  await page.getByLabel('Title', { exact: true }).fill('Priority two item');
  const prioritySection = await openEditorSection(page, 'Priority');
  await prioritySection.locator('select').selectOption({ label: '2 — Medium' });
  await page.getByRole('button', { name: 'Save item' }).click();

  await goHome(page);
  await page.getByRole('button', { name: 'New view' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Priority OR');
  await openViewEditorSection(page, 'Visual setup');
  while (await page.locator('.visual-condition-row').count() > 1) {
    await page.getByRole('button', { name: /Remove filter rule/ }).last().click();
  }
  let rows = page.locator('.visual-condition-row');
  await rows.first().getByRole('combobox', { name: 'Property' }).selectOption('priority');
  await rows.first().getByRole('combobox', { name: 'Operator' }).selectOption('==');
  await rows.first().getByRole('combobox', { name: 'Value' }).selectOption('3');
  await page.getByRole('button', { name: '+ Add OR rule' }).click();
  rows = page.locator('.visual-condition-row');
  await rows.nth(1).getByRole('combobox', { name: 'Property' }).selectOption('priority');
  await rows.nth(1).getByRole('combobox', { name: 'Operator' }).selectOption('<');
  await rows.nth(1).getByRole('combobox', { name: 'Value' }).selectOption('3');
  await openViewEditorSection(page, 'Advanced filter code');
  await expect(page.getByLabel('Advanced filter code')).toHaveValue('(priority == 3 || priority < 3)');
  await page.getByRole('button', { name: 'Save view' }).click();

  const view = page.locator('.view-section').filter({ hasText: 'Priority OR' });
  await expect(view.getByText('Priority two item', { exact: true })).toBeVisible();

  await view.getByRole('button', { name: /^Edit /  }).click();
  await openViewEditorSection(page, 'Visual setup');
  rows = page.locator('.visual-condition-row');
  await rows.first().getByRole('combobox', { name: 'Operator' }).selectOption({ label: '>=' });
  await rows.first().getByRole('combobox', { name: 'Value' }).selectOption('2');
  await rows.nth(1).getByRole('combobox', { name: 'Join' }).selectOption('and');
  await rows.nth(1).getByRole('combobox', { name: 'Operator' }).selectOption({ label: '<=' });
  await rows.nth(1).getByRole('combobox', { name: 'Value' }).selectOption('2');
  await openViewEditorSection(page, 'Advanced filter code');
  await expect(page.getByLabel('Advanced filter code')).toHaveValue('(priority >= 2 && priority <= 2)');
  await page.getByRole('button', { name: 'Save view' }).click();
  await expect(view.getByText('Priority two item', { exact: true })).toBeVisible();
});

test('habit view includes a recurring habit without duplicating its occurrence', async ({ page }) => {
  await page.getByLabel('Workspace name').fill('Habit views');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await goToAllItems(page);
  await openNewItem(page);
  await page.getByLabel('Title', { exact: true }).fill('Daily walk');
  await page.locator('summary').filter({ hasText: 'Progress & habit' }).click();
  await page.getByLabel('Track as a habit').check();
  await page.locator('summary').filter({ hasText: 'Recurrence & auto-renew' }).click();
  await page.getByLabel('Make this a recurring series').check();
  await page.getByRole('button', { name: 'Save item' }).click();

  await goHome(page);
  await page.getByRole('button', { name: 'New view' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Habits');
  await openViewEditorSection(page, 'Visual setup');
  while (await page.locator('.visual-condition-row').count() > 1) {
    await page.getByRole('button', { name: /Remove filter rule/ }).last().click();
  }
  const rows = page.locator('.visual-condition-row');
  await rows.first().getByRole('combobox', { name: 'Property' }).selectOption('isHabit');
  await rows.first().getByRole('combobox', { name: 'Value' }).selectOption('true');
  await page.getByRole('button', { name: 'Save view' }).click();

  const habitView = page.locator('.view-section').filter({ hasText: 'Habits' });
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

  await goToAllItems(page);
  for (const [title, priority] of [['Low item', '1'], ['High item', '4']] as const) {
    await openNewItem(page);
    await page.getByLabel('Title', { exact: true }).fill(title);
    const prioritySection = await openEditorSection(page, 'Priority');
    await prioritySection.locator('select').selectOption(priority);
    await page.getByRole('button', { name: 'Save item' }).click();
  }

  await goHome(page);
  const view = page.locator('.view-section').filter({ hasText: 'All items' });
  await view.getByRole('button', { name: /^Edit /  }).click();
  await page.getByRole('combobox', { name: 'Renderer' }).selectOption('table');
  await openViewEditorSection(page, 'Sorting');
  const sortField = page.getByRole('combobox', { name: 'Sort field 1' });
  await expect(sortField.locator('option[value="priority"]')).toHaveCount(1);
  await sortField.selectOption('priority');
  await expect(page.getByLabel('SQL-like sorting')).toHaveValue('priority asc nulls last');
  await openViewEditorSection(page, 'Visual setup');
  await page.getByRole('button', { name: 'Hide all' }).click();
  const coreFields = page.locator('.field-groups details').filter({ has: page.getByText('Core', { exact: true }) });
  await coreFields.getByText('Core', { exact: true }).click();
  await coreFields.getByRole('checkbox', { name: /^Title/ }).check();
  await coreFields.getByRole('checkbox', { name: /^Priority/ }).check();
  const scheduleFields = page.locator('.field-groups details').filter({ has: page.getByText('Schedule', { exact: true }) });
  await scheduleFields.getByText('Schedule', { exact: true }).click();
  await scheduleFields.getByRole('checkbox', { name: /^Estimated duration/ }).check();
  await page.getByLabel('SQL-like sorting').fill('priority desc nulls last\nlower(title) asc nulls last');
  await page.getByRole('button', { name: 'Save view' }).click();

  await expect(view.locator('thead th')).toHaveText(['Manual order', 'Complete', 'Title', 'Priority', 'Estimated duration']);
  await expect(view.locator('thead th').filter({ hasText: 'State' })).toHaveCount(0);
  const rows = view.locator('tbody tr');
  await expect(rows.nth(0)).toContainText('High item');
  await expect(rows.nth(1)).toContainText('Low item');
  await expect(rows.nth(0).locator('td').last()).toHaveText('10 min');
  await expect(rows.nth(1).locator('td').last()).toHaveText('10 min');
  await expect(view.locator('.view-results-scroll')).toHaveCSS('overflow-x', 'auto');
  const viewBounds = await view.boundingBox();
  const editBounds = await view.getByRole('button', { name: /^Edit /  }).boundingBox();
  expect(viewBounds).not.toBeNull();
  expect(editBounds).not.toBeNull();
  expect(editBounds!.x + editBounds!.width).toBeLessThanOrEqual(viewBounds!.x + viewBounds!.width + 1);

  await view.getByRole('button', { name: /^Edit /  }).click();
  await page.getByRole('button', { name: 'Delete view' }).click();
  await page.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(view).toHaveCount(0);
});

test('table and board renderers can complete and reopen items', async ({ page }) => {
  await page.getByLabel('Workspace name').fill('Renderer actions');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await goToAllItems(page);
  await openNewItem(page);
  await page.getByLabel('Title', { exact: true }).fill('Renderer item');
  const schedule = await page.evaluate(() => {
    const date = new Date(Date.now() + 3_600_000);
    const local = (value: Date) => new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    return { start: local(date), end: local(new Date(date.getTime() + 10 * 60_000)) };
  });
  await openEditorSection(page, 'Dates & time');
  await page.getByLabel('Event opens', { exact: true }).fill(schedule.start);
  await page.getByLabel('Event ends', { exact: true }).fill(schedule.end);
  await page.getByRole('button', { name: 'Save item' }).click();
  await goHome(page);

  const view = page.locator('.view-section').filter({ hasText: 'All items' });
  for (const renderer of ['table', 'board']) {
    await view.getByRole('button', { name: /^Edit /  }).click();
    await openViewEditorSection(page, 'Advanced filter code');
    await page.getByLabel('Advanced filter code').fill('true');
    await page.getByRole('combobox', { name: 'Renderer' }).selectOption(renderer);
    await page.getByRole('button', { name: 'Save view' }).click();
    if (renderer === 'table') {
      await expect(view.locator('thead th:not(.state-column) .property-icon').first()).toBeVisible();
      await expect(view.locator('thead th[title]').first()).toHaveAttribute('title', /Title|State|Event|Due|Priority|Tags/);
    }
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

  await goToAllItems(page);
  await openNewItem(page);
  await page.getByLabel('Title', { exact: true }).fill('Reminder item');
  await openEditorSection(page, 'Reminders');
  await page.getByRole('button', { name: '+ Add reminder' }).click();
  await page.getByRole('button', { name: '+ Add reminder' }).click();
  const past = await page.evaluate(() => {
    const date = new Date(Date.now() - 3_600_000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const reminderInputs = page.locator('.reminder-row input[type="datetime-local"]');
  await reminderInputs.nth(0).fill(past);
  await reminderInputs.nth(1).fill(past);
  await page.getByLabel('Reminder 2 urgency').selectOption('critical');
  await page.getByRole('button', { name: 'Save item' }).click();
  await lockWorkspace(page);
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
  await lockWorkspace(page);
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

  await goToAllItems(page);
  await openNewItem(page);
  await page.getByLabel('Title', { exact: true }).fill('One urgent reminder');
  await openEditorSection(page, 'Reminders');
  await page.getByRole('button', { name: '+ Add reminder' }).click();
  await page.getByRole('button', { name: '+ Add reminder' }).click();
  const past = await page.evaluate(() => {
    const date = new Date(Date.now() - 3_600_000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const rows = page.locator('.reminder-row');
  await page.getByLabel('Reminder 1 time').fill(past);
  await page.getByLabel('Reminder 2 time').fill(past);
  await page.getByLabel('Reminder 1 urgency').selectOption('urgent');
  await page.getByLabel('Reminder 2 urgency').selectOption('urgent');
  await page.getByRole('button', { name: 'Save item' }).click();
  await lockWorkspace(page);
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
  await goToAllItems(page);
  await openNewItem(page);
  await page.getByLabel('Title', { exact: true }).fill('Window reminder');
  await openEditorSection(page, 'Reminders');
  await page.getByRole('button', { name: '+ Add reminder' }).click();
  const past = await page.evaluate(() => {
    const date = new Date(Date.now() - 3_600_000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  await page.getByLabel('Reminder 1 time').fill(past);
  await page.getByRole('button', { name: 'Save item' }).click();
  await page.getByRole('button', { name: 'Complete item' }).click();
  await lockWorkspace(page);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.locator('.notice-card')).toHaveCount(0);
});

test('recurring item accepts Deadline as its schedule anchor and explains missing dates', async ({ page }) => {
  await page.getByLabel('Workspace name').fill('Recurring items');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();

  await goToAllItems(page);
  await openNewItem(page);
  await page.getByLabel('Title', { exact: true }).fill('Weekly due-only item');
  await openEditorSection(page, 'Dates & time');
  await expect(page.getByLabel('Event opens', { exact: true })).not.toHaveValue('');
  await page.getByLabel('Event opens', { exact: true }).fill('');
  await page.locator('summary').filter({ hasText: 'Recurrence & auto-renew' }).click();
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
  await page.locator('input[aria-label="Due / Active range ends"]').fill(dueInOneHour);
  await expect(page.locator('input[aria-label="Due / Active range ends"]')).toHaveValue(dueInOneHour);
  await page.getByRole('button', { name: 'Save item' }).click();
  await expect(page.getByRole('dialog', { name: 'Item editor' })).toBeHidden();

  await goToAllItems(page);
  const templatesSection = page.locator('.all-sections > details.recurring-items').filter({ has: page.getByText('Recurring items', { exact: true }) }).first();
  if (!await templatesSection.evaluate((element) => (element as HTMLDetailsElement).open)) await templatesSection.locator(':scope > summary').click();
  await expect(templatesSection.getByText('These are the recurrence source settings. Auto-renew keeps one live item and records finished cycles inside its Cycle history.')).toBeVisible();
  await expect(templatesSection.locator(':scope > summary b')).toHaveText('1');

  await goHome(page);
  await page.getByRole('button', { name: 'New view' }).click();
  await openViewEditorSection(page, 'Advanced filter code');
  await expect(page.getByLabel('Advanced filter code')).toHaveValue('(state == "open" || state == "done") && role != "series_template" && isTemplate != true');
  await expect(page.getByLabel('Advanced filter code')).toHaveCSS('font-family', /monospace|Menlo|Monaco|Consolas/i);
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
  await goToAllItems(page);
  await openNewItem(page);
  await page.getByLabel('Title', { exact: true }).fill('Prepare lessons');
  const dates = await page.evaluate(() => {
    const opens = new Date(Date.now() + 60 * 60 * 1_000);
    const ends = new Date(opens.getTime() + 10 * 60 * 1_000);
    const closes = new Date(opens.getTime() + 3 * 24 * 60 * 60 * 1_000);
    const local = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    return { opens: local(opens), ends: local(ends), closes: local(closes) };
  });
  await openEditorSection(page, 'Dates & time');
  await page.getByLabel('Event opens', { exact: true }).fill(dates.opens);
  await page.getByLabel('Event ends', { exact: true }).fill(dates.ends);
  await page.locator('input[aria-label="Due / Active range ends"]').fill(dates.closes);
  await page.locator('summary').filter({ hasText: 'Recurrence & auto-renew' }).click();
  await page.getByLabel('Make this a recurring series').check();
  await page.getByLabel('Only show during the active range').check();
  await expect(page.locator('.active-window-summary').getByText('Event opens', { exact: true })).toBeVisible();
  await expect(page.locator('.active-window-summary').getByText('Active range ends', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Activation amount')).toBeHidden();
  await page.getByText('Advanced recurrence behavior', { exact: true }).click();
  await expect(page.getByLabel('Activation amount')).toHaveValue('0');
  await expect(page.getByRole('combobox', { name: 'Auto-close' })).toHaveValue('due');
  await page.getByRole('button', { name: 'Save item' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
