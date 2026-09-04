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

async function goToPara(page: Page) {
  if ((page.viewportSize()?.width ?? 0) > 620) await page.locator('.sidebar').getByRole('button', { name: 'PARA' }).click();
  else {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.locator('.mobile-nav-menu').getByRole('button', { name: 'PARA' }).click();
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
  const summary = page.locator('.editor-scroll summary').filter({ hasText: name }).first();
  const details = summary.locator('..');
  await summary.evaluate((element) => {
    let ancestor = element.parentElement?.parentElement?.closest('details');
    while (ancestor) {
      ancestor.open = true;
      ancestor = ancestor.parentElement?.closest('details');
    }
  });
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

test('keeps recovery, decryption, installation and diagnostics inside one collapsed Help row', async ({ page }) => {
  const help = page.locator('details.install-guide');
  await expect(help).toHaveCount(1);
  await expect(help).not.toHaveAttribute('open', '');
  await expect(help.locator(':scope > summary')).toHaveText('Help');
  await help.locator(':scope > summary').click();
  await expect(page.getByRole('heading', { name: 'Decrypt any UTM backup' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Install on your phone' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Troubleshooting log/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose encrypted file' })).toBeVisible();
});

test('shows the release version on registration, login and settings', async ({ page }) => {
  const releaseLabel = /^v1\.99\.2 · (?:local changes · )?commit [0-9a-f]{7}$/;
  await expect(page.locator('.lock-version')).toHaveText(releaseLabel);

  await page.getByLabel('Workspace name').fill('Release version');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();

  await goToSettings(page);
  await expect(page.locator('.settings-release-info')).toHaveText(/^Universal Task Manager · v1\.99\.2 · build [0-9a-f]{7}(?: · local changes)?$/);

  await lockWorkspace(page);
  await expect(page.getByRole('heading', { name: 'Unlock your workspace' })).toBeVisible();
  await expect(page.locator('.lock-version')).toHaveText(releaseLabel);
});

test('changes the password and toggles the password prompt only after current-password verification', async ({ page }) => {
  test.setTimeout(60_000);
  const oldPassword = 'correct horse battery staple';
  const newPassword = 'new correct horse battery staple';
  await page.getByLabel('Workspace name').fill('Password controls');
  await page.getByLabel('Password', { exact: true }).fill(oldPassword);
  await page.getByLabel('Confirm password').fill(oldPassword);
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();

  await goToSettings(page);
  const protection = page.locator('details.settings-disclosure').filter({ hasText: 'Password protection' }).first();
  await protection.locator(':scope > summary').click();
  await protection.getByLabel('Current password').fill(oldPassword);
  await protection.getByLabel('New password', { exact: true }).fill(newPassword);
  await protection.getByLabel('Confirm new password', { exact: true }).fill(newPassword);
  await protection.getByRole('button', { name: 'Change password' }).click();
  await expect(protection.getByText(/Password changed/)).toBeVisible();

  await lockWorkspace(page);
  await page.getByLabel('Password').fill(oldPassword);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel('Password').fill(newPassword);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();

  await goToSettings(page);
  const openedProtection = page.locator('details.settings-disclosure').filter({ hasText: 'Password protection' }).first();
  await openedProtection.locator(':scope > summary').click();
  await openedProtection.getByLabel('Current password').fill('wrong current password');
  await openedProtection.getByRole('button', { name: 'Disable password on this device' }).click();
  await expect(openedProtection.getByRole('alert')).toHaveText('Current password is incorrect');
  await expect(openedProtection.getByText('Required', { exact: true })).toBeVisible();
  await openedProtection.getByLabel('Current password').fill(newPassword);
  await openedProtection.getByRole('button', { name: 'Disable password on this device' }).click();
  await expect(openedProtection.getByText('Disabled on this device', { exact: true })).toBeVisible();
  await page.reload();
  if ((page.viewportSize()?.width ?? 0) > 620) await expect(page.locator('.sidebar').getByRole('button', { name: 'Settings' })).toBeVisible();
  else await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();

  await goToSettings(page);
  const disabledProtection = page.locator('details.settings-disclosure').filter({ hasText: 'Password protection' }).first();
  await disabledProtection.locator(':scope > summary').click();
  await disabledProtection.getByLabel('Current password').fill(newPassword);
  await disabledProtection.getByRole('button', { name: 'Require password on startup' }).click();
  await expect(disabledProtection.getByText('Required', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Unlock your workspace' })).toBeVisible();
});

test('shows the rebuilt Calendar without reviving Automations or beta labels', async ({ page }) => {
  await page.getByLabel('Workspace name').fill('Beta labels');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await expect(page.locator('.sidebar .nav-beta')).toHaveCount(0);
  if ((page.viewportSize()?.width ?? 0) > 620) await expect(page.locator('.sidebar').getByRole('button', { name: 'Calendar', exact: true })).toBeVisible();
  else {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.locator('.mobile-nav-menu').getByRole('button', { name: 'Calendar', exact: true })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Automations', exact: true })).toHaveCount(0);
});

test('creates and manually orders reusable tags from PARA', async ({ page }) => {
  await page.getByLabel('Workspace name').fill('Tag settings');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await goToPara(page);
  await page.getByRole('textbox', { name: 'New tag', exact: true }).fill('#urgent');
  await page.getByRole('button', { name: 'Add Tag' }).click();
  await expect(page.locator('.organization-tag-catalog .organization-tag-entry').filter({ hasText: 'urgent' })).toBeVisible();
  await page.getByRole('textbox', { name: 'New tag', exact: true }).fill('#someday');
  await page.getByRole('button', { name: 'Add Tag' }).click();
  await expect(page.locator('.organization-tag-catalog .organization-tag-entry').filter({ hasText: 'someday' })).toBeVisible();
  const tagCatalog = page.locator('.organization-tag-catalog');
  await expect(tagCatalog.getByRole('button', { name: 'Reorder No Tags' })).toBeVisible();
  await expect(tagCatalog.getByRole('button', { name: 'Reorder Tag urgent' })).toBeVisible();
  await expect(page.getByText('Priority 0', { exact: true })).toHaveCount(0);

  await tagCatalog.getByRole('button', { name: 'urgent', exact: true }).click();
  await expect(page.locator('.organization-detail-header').getByRole('heading', { name: 'urgent', exact: true })).toBeVisible();
  await expect(page.getByLabel('Rename Tag urgent')).toBeVisible();
  const color = page.getByLabel('Color for Tag urgent');
  await expect(color).toBeVisible();
  await color.fill('#8b5cf6');
  await page.getByRole('button', { name: 'Pin #urgent to Home' }).click();
  await page.getByLabel('Rename Tag urgent').click();
  const renamedTag = page.getByLabel('New name for Tag urgent');
  await renamedTag.fill('#focus');
  await page.locator('.organization-detail-header').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.organization-detail-header').getByRole('heading', { name: 'focus', exact: true })).toBeVisible();
  await expect(page.getByLabel('Color for Tag focus')).toHaveValue('#8b5cf6');
  await expect(page.getByRole('button', { name: 'Unpin #focus from Home' })).toHaveAttribute('aria-pressed', 'true');

  const quickAdd = page.getByLabel('Quick add item to #focus');
  await quickAdd.fill('Tagged task');
  await quickAdd.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Item editor' })).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toBeFocused();
  await page.getByLabel('Title', { exact: true }).press('Enter');
  await expect(page.locator('.organization-detail-page .item-title').filter({ hasText: 'Tagged task' })).toBeVisible();

  await goHome(page);
  await expect(page.locator('.views-stack').getByRole('heading', { name: '#focus', exact: true })).toBeVisible();
});

test('never translates Area or Tag names that match interface dictionary keys', async ({ page }) => {
  await page.getByLabel('Workspace name').fill('Localization boundaries');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();

  await goToPara(page);
  await page.getByLabel('New Area').fill('Home');
  await page.getByRole('button', { name: 'Add Area' }).click();
  await page.getByRole('textbox', { name: 'New tag', exact: true }).fill('Calendar');
  await page.getByRole('button', { name: 'Add Tag' }).click();

  await goToSettings(page);
  const application = page.locator('details.settings-disclosure').filter({ hasText: 'Data, notifications and application' }).first();
  await application.locator(':scope > summary').click();
  await application.getByLabel('Language').selectOption('ru');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();

  if ((page.viewportSize()?.width ?? 0) > 620) await page.locator('.sidebar').getByRole('button', { name: 'PARA' }).click();
  else {
    await page.locator('.mobile-menu-button').click();
    await page.locator('.mobile-nav-menu').getByRole('button', { name: 'PARA' }).click();
  }
  await expect(page.locator('.organization-area-name').filter({ hasText: 'Home' })).toBeVisible();
  await expect(page.locator('.organization-tag-entry').filter({ hasText: 'Calendar' })).toBeVisible();
  await expect(page.locator('.organization-area-name').filter({ hasText: 'Главная' })).toHaveCount(0);
  await expect(page.locator('.organization-tag-entry').filter({ hasText: 'Календарь' })).toHaveCount(0);
});

test('deletes an organization entity only after an impact warning and exact-name confirmation', async ({ page }) => {
  await page.getByLabel('Workspace name').fill('Organization deletion');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await goToPara(page);
  await page.getByLabel('New Area').fill('Work');
  await page.getByRole('button', { name: 'Add Area' }).click();
  await page.locator('.organization-area-groups').getByRole('button', { name: 'Work', exact: true }).click();
  await page.getByRole('button', { name: 'Delete Area' }).click();

  const dialog = page.getByRole('dialog', { name: /Delete Area/ });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription('This operation can change many workspace records.');
  await expect(dialog.getByText(/scoped saved views/)).toBeVisible();
  const confirmDelete = dialog.getByRole('button', { name: 'Delete permanently' });
  await expect(confirmDelete).toBeDisabled();
  await dialog.getByLabel('Deletion confirmation').fill('work');
  await expect(confirmDelete).toBeDisabled();
  await dialog.getByLabel('Deletion confirmation').fill('Work');
  await confirmDelete.click();

  await expect(dialog).toBeHidden();
  await expect(page.locator('.organization-area-groups').getByRole('button', { name: 'Work', exact: true })).toHaveCount(0);
});

test('quick-captures from PARA and toggles the Project view on Home', async ({ page }) => {
  await page.getByLabel('Workspace name').fill('PARA detail pages');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await goToPara(page);
  await page.getByLabel('New Area').fill('Work');
  await page.getByRole('button', { name: 'Add Area' }).click();
  const workGroup = page.locator('.organization-area-group').filter({ hasText: 'Work' });
  await workGroup.evaluate((element: HTMLDetailsElement) => { element.open = true; });
  await workGroup.getByLabel('New Project in Work').fill('Launch');
  await workGroup.getByRole('button', { name: 'Add Project' }).click();
  await expect(page.locator('.organization-page-export').getByRole('button', { name: 'Export PARA' })).toBeVisible();

  await page.locator('.organization-area-groups').getByRole('button', { name: 'Work', exact: true }).click();
  await expect(page.locator('.organization-detail-header').getByRole('heading', { name: 'Work' })).toBeVisible();
  await expect(page.getByLabel('Rename Area Work')).toBeVisible();
  await expect(page.getByLabel('Color for Area Work')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No Project' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^\+ Add item/ })).toHaveCount(0);
  await expect(page.locator('.organization-page-export').getByRole('button', { name: 'Export PARA' })).toHaveCount(0);
  await expect(page.locator('.page-title').getByRole('button', { name: 'Export PARA' })).toHaveCount(0);

  await page.locator('.organization-scoped-project-controls').getByRole('button', { name: 'Launch', exact: true }).click();
  await expect(page.locator('.organization-detail-header').getByRole('heading', { name: 'Launch' })).toBeVisible();
  await expect(page.getByLabel('Rename Project Launch')).toBeVisible();
  await expect(page.getByLabel('Color for Project Launch')).toBeVisible();
  await expect(page.getByText('Export…', { exact: true })).toHaveCount(0);
  const quickAdd = page.getByLabel('Quick add item to launch');
  await quickAdd.fill('Launch checklist');
  await quickAdd.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Item editor' })).toBeVisible();
  const title = page.getByLabel('Title', { exact: true });
  await expect(title).toHaveValue('Launch checklist');
  await expect(title).toBeFocused();
  await title.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Item editor' })).toHaveCount(0);
  await expect(page.locator('.organization-detail-page .item-title').filter({ hasText: 'Launch checklist' })).toBeVisible();

  await quickAdd.fill('Keep editing');
  await quickAdd.press('Enter');
  await page.locator('.editor-scroll > details > summary').filter({ hasText: 'Description' }).click();
  const description = page.locator('.description-section textarea');
  await description.fill('Line one');
  await description.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Item editor' })).toBeVisible();
  await expect(description).toHaveValue('Line one\n');
  await page.getByRole('button', { name: 'Save item' }).click();

  const pin = page.getByRole('button', { name: 'Pin Launch to Home' });
  await expect(pin).toHaveAttribute('aria-pressed', 'false');
  await pin.click();
  await expect(page.getByRole('button', { name: 'Unpin Launch from Home' })).toHaveAttribute('aria-pressed', 'true');

  await goHome(page);
  await expect(page.locator('.views-stack').getByRole('heading', { name: 'Launch', exact: true })).toBeVisible();

  await goToPara(page);
  await page.locator('.organization-area-groups').getByRole('button', { name: 'Work', exact: true }).click();
  await page.locator('.organization-scoped-project-controls').getByRole('button', { name: 'Launch', exact: true }).click();
  await page.getByRole('button', { name: 'Unpin Launch from Home' }).click();
  await goHome(page);
  await expect(page.locator('.views-stack').getByRole('heading', { name: 'Launch', exact: true })).toHaveCount(0);
});

test('shows compact completion and remaining duration summaries on saved views and All items', async ({ page }) => {
  await page.getByLabel('Workspace name').fill('View metrics');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();

  for (const title of ['Open work', 'Finished work']) {
    const capture = page.getByPlaceholder('Add new item');
    await capture.fill(title);
    await capture.press('Enter');
    const editorTitle = page.getByLabel('Title', { exact: true });
    await expect(editorTitle).toBeFocused();
    await openEditorSection(page, 'Dates & time');
    await page.getByLabel('Duration preset').selectOption(title === 'Open work' ? '1h' : '10');
    await page.getByRole('button', { name: 'Save item' }).click();
    await expect(page.getByRole('dialog', { name: 'Item editor' })).toHaveCount(0);
  }

  const allView = page.locator('.view-section').filter({ has: page.getByRole('heading', { name: 'All items', exact: true }) });
  await allView.locator('.item-card').filter({ hasText: 'Finished work' }).getByRole('button', { name: 'Complete item' }).click();
  const savedSummary = allView.locator('.view-metrics-summary');
  await expect(savedSummary).toHaveText('14% · 1h');
  await expect(allView.getByRole('button', { name: /^Collapse All items/ })).toHaveAttribute('aria-label', /14 percent completed.*1 hour remaining/);
  await allView.getByRole('button', { name: /^Collapse All items/ }).click();
  await expect(savedSummary).toBeVisible();
  await expect(allView.locator('.item-card')).toBeHidden();

  await goToAllItems(page);
  await expect(page.locator('.all-items-toolbar .view-metrics-summary')).toHaveText('14% · 1h');
  await expect(page.locator('.all-items-toolbar .view-metrics-summary')).toHaveAttribute('aria-label', /14 percent completed.*1 hour remaining/);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
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
  await expect(editorSections.filter({ hasText: 'Organization' })).toHaveCount(1);
  await expect(editorSections.filter({ hasText: 'More' })).toHaveCount(1);
  await expect(editorSections.filter({ hasText: 'Contexts' })).toHaveCount(0);
  const scheduleSection = page.getByText('Dates & time', { exact: true });
  await expect(scheduleSection).toHaveCSS('font-size', '13px');
  await expect(scheduleSection).toHaveCSS('font-weight', '550');
  await openEditorSection(page, 'Dates & time');
  await expect(page.getByLabel('Event opens', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Event opens', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Event ends', { exact: true })).toHaveCount(0);
  await expect(page.locator('input[aria-label="Due / Active range ends"]')).toBeVisible();
  await expect(page.locator('input[aria-label="Due / Active range ends"]')).toHaveValue('');
  await expect(page.getByLabel('Available to work from', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Timezone', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Latest acceptable completion time.', { exact: false })).toBeHidden();
  await openEditorSection(page, 'Reminders');
  const addReminder = page.getByRole('button', { name: '+ Add reminder' });
  await expect(addReminder).toHaveCSS('font-size', '13px');
  await expect(addReminder).toHaveCSS('font-weight', '400');
  await expect(addReminder).toHaveCSS('padding-top', '8px');
  await openEditorSection(page, 'System metadata');
  await expect(page.getByText('Created at', { exact: true })).toBeVisible();
  await expect(page.getByText('Last modified', { exact: true })).toBeVisible();
  await expect(page.getByText(/Universal Task Manager v\d+\.\d+\.\d+/, { exact: true })).toBeVisible();
  await expect(page.getByText('dev.universal-task-manager', { exact: true })).toBeVisible();
  const organizationSection = await openEditorSection(page, 'Organization');
  await expect(organizationSection.getByLabel('Add Area')).toBeVisible();
  await expect(organizationSection.getByLabel('Add Project')).toBeVisible();
  await expect(organizationSection.getByLabel('Add Tag')).toBeVisible();
  await organizationSection.getByLabel('Priority').selectOption({ label: '3 — High' });
  await page.getByRole('button', { name: 'Save item' }).click();
  await page.getByText('Prepare material by Thursday', { exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: 'Item editor' })).toBeVisible();
  const closeEditor = page.getByRole('button', { name: 'Close item editor' });
  await expect(closeEditor).toHaveText('×');
  await expect(closeEditor).toHaveCSS('width', '44px');
  await expect(closeEditor).toHaveCSS('height', '44px');
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCSS('background-color', 'rgb(255, 255, 255)');
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
  await expect(page.locator('.settings-release-info')).toContainText(/^Universal Task Manager · v\d+\.\d+\.\d+ · build /);
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
  await page.getByText('Data, notifications and application', { exact: true }).click();
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

  const sections = page.locator('.settings-page-shell details.settings-disclosure');
  await expect(sections).toHaveCount(11);
  expect(await sections.evaluateAll((elements) => elements.every((element) => !(element as HTMLDetailsElement).open))).toBe(true);
  await sections.evaluateAll((elements) => elements.forEach((element) => { (element as HTMLDetailsElement).open = true; }));
  const cards = page.locator('.settings-page-shell .settings-card');
  await expect(cards).toHaveCount(11);
  const boxes = await cards.evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right };
  }));
  expect(new Set(boxes.map((box) => Math.round(box.left))).size).toBe(1);
  expect(new Set(boxes.map((box) => Math.round(box.right))).size).toBe(1);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('calendar switches periods and edits the fixed day view', async ({ page }) => {
  await page.getByLabel('Workspace name').fill('Calendar workspace');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await goToCalendar(page);
  await expect(page.locator('.calendar-title h1')).toBeVisible();
  await expect(page.locator('.calendar-day-panel.is-week .calendar-day-choice')).toHaveCount(7);
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await expect.poll(() => page.locator('.calendar-day-panel.is-month .calendar-day-choice').count()).toBeGreaterThanOrEqual(28);
  expect(await page.locator('.calendar-day-panel.is-month .calendar-day-choice').count()).toBeLessThanOrEqual(31);
  await page.getByRole('button', { name: 'Week', exact: true }).click();
  await expect(page.locator('.calendar-view-picker')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit calendar day view' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit calendar day view' });
  await expect(editor).toBeVisible();
  await editor.getByText('Selected day', { exact: true }).click();
  for (const label of [
    'Event opens in day',
    'Event opens → Event ends overlaps day',
    'Event opens → Due overlaps day',
    'Due in day',
  ]) await expect(editor.getByRole('checkbox', { name: label })).toBeChecked();
  await expect(editor.getByText('Include overdue', { exact: true })).toHaveCount(0);
  await expect(editor.getByText('Filter items', { exact: true })).toBeVisible();
  await expect(editor.getByText('Show in results', { exact: true })).toBeVisible();
  await expect(editor.getByText('Sorting', { exact: true })).toBeVisible();
  const filterSection = editor.locator('details.view-editor-section').filter({ hasText: 'Filter items' }).first();
  await filterSection.locator(':scope > summary').click();
  await filterSection.getByRole('button', { name: '+ Add AND rule' }).click();
  const filterRow = filterSection.locator('.visual-condition-row').last();
  await filterRow.getByRole('combobox', { name: 'Property' }).selectOption('activeRange');
  await expect(filterRow.getByRole('combobox', { name: 'Operator' })).toHaveValue('==');
  await expect(filterRow.getByRole('combobox', { name: 'Operator' }).locator('option', { hasText: 'is set' })).toHaveCount(0);
  await expect(filterSection.getByLabel('Calendar day advanced filter code')).toHaveValue(/activeRange == true/);
  await editor.getByRole('button', { name: 'Save view' }).click();
  await expect(editor).toBeHidden();
  const calendarEditTrigger = page.getByRole('button', { name: 'Edit calendar day view' });
  if ((page.viewportSize()?.width ?? 0) > 620) await expect(calendarEditTrigger).toBeFocused();
  else await expect(calendarEditTrigger).not.toBeFocused();

  await goToSettings(page);
  const calendarSettings = page.locator('details.settings-disclosure').filter({ hasText: 'Calendar and Google Calendar' });
  await expect(calendarSettings).not.toHaveAttribute('open', '');
  await calendarSettings.getByText('Calendar and Google Calendar', { exact: true }).click();
  await expect(page.getByLabel('Timezone')).not.toHaveValue('');
  await expect(page.getByText('Google Calendar', { exact: true })).toBeVisible();
  const googleConnect = page.getByRole('button', { name: 'Connect Google Calendar' });
  const missingClientId = page.getByText(/needs a Google OAuth client ID/);
  if (await googleConnect.isDisabled()) await expect(missingClientId).toBeVisible();
  else await expect(missingClientId).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
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

test('planning collection counters match All items status counters', async ({ page }) => {
  await page.getByLabel('Workspace name').fill('Aligned counters');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await goToAllItems(page);

  const statusCount = page.locator('.all-sections details summary b').first();
  const planning = page.locator('.all-item-collections');
  const planningCount = planning.locator(':scope > summary b');
  await planning.locator(':scope > summary').click();
  const collectionCount = planning.locator('details summary b').first();
  const visualStyle = async (locator: Locator) => locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return { background: style.backgroundColor, radius: style.borderRadius, fontSize: style.fontSize, centerX: Math.round(bounds.left + bounds.width / 2) };
  });

  const statusStyle = await visualStyle(statusCount);
  const planningStyle = await visualStyle(planningCount);
  const collectionStyle = await visualStyle(collectionCount);
  expect(planningStyle).toEqual(statusStyle);
  expect(collectionStyle).toEqual(statusStyle);
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
  await expect(page.getByRole('dialog', { name: 'Item editor' })).toBeHidden();

  let view = page.locator('.view-section').filter({ hasText: 'All items' });
  const editView = view.getByRole('button', { name: /^Edit /  });
  await expect(view.getByText('Export', { exact: true })).toHaveCount(0);
  await editView.click();
  if ((page.viewportSize()?.width ?? 0) <= 700) {
    const editor = page.locator('.ui-dialog-popup.view-editor');
    expect(['clip', 'hidden']).toContain(await editor.evaluate((element) => getComputedStyle(element).overflowX));
    await expect(editor.locator('.ui-dialog-content')).toHaveCSS('touch-action', 'pan-y');
    const bounds = await editor.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  }
  await openViewEditorSection(page, 'Visual setup');
  await expect(page.locator('.visual-query-builder').getByText('1. Filter items', { exact: true })).toBeVisible();
  await expect(page.locator('.visual-query-builder').getByText('Show in results', { exact: true })).toHaveCount(0);
  await expect(page.locator('.view-editor details.view-editor-section > summary').filter({ hasText: 'Show in results' })).toHaveCount(1);
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

test('reminder period filters stay editable in the View editor', async ({ page }) => {
  await page.getByLabel('Workspace name').fill('Reminder filters');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  const view = page.locator('.view-section').filter({ hasText: 'All items' });
  await view.getByRole('button', { name: /^Edit / }).click();
  await openViewEditorSection(page, 'Visual setup');
  while (await page.locator('.visual-condition-row').count() > 1) await page.getByRole('button', { name: /Remove filter rule/ }).last().click();
  const row = page.locator('.visual-condition-row').first();
  await row.getByRole('combobox', { name: 'Property' }).selectOption('reminderPeriod');
  await row.getByLabel('Reminder position relative to period').selectOption('after');
  await row.getByLabel('Reminder comparison period').selectOption('next_days');
  await row.getByLabel('Number of days').fill('14');
  await page.getByRole('button', { name: 'Save view' }).click();

  await view.getByRole('button', { name: /^Edit / }).click();
  await openViewEditorSection(page, 'Visual setup');
  const restored = page.locator('.visual-condition-row').first();
  await expect(restored.getByRole('combobox', { name: 'Property' })).toHaveValue('reminderPeriod');
  await expect(restored.getByLabel('Reminder position relative to period')).toHaveValue('after');
  await expect(restored.getByLabel('Reminder comparison period')).toHaveValue('next_days');
  await expect(restored.getByLabel('Number of days')).toHaveValue('14');
});

test('item scripts can be selected in a view and update every second', async ({ page }) => {
  const password = 'correct horse battery staple';
  await page.getByLabel('Workspace name').fill('Live scripts');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();

  await page.getByPlaceholder('Add new item').fill('Live countdown');
  await page.getByPlaceholder('Add new item').press('Enter');
  const dates = await openEditorSection(page, 'Dates & time');
  const future = new Date(Date.now() + 2 * 60_000);
  const localFuture = new Date(future.getTime() - future.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await dates.getByLabel('Event opens', { exact: true }).fill(localFuture);
  const scripts = await openEditorSection(page, 'Scripts');
  await scripts.getByRole('button', { name: '+ Add computed field' }).click();
  await scripts.getByLabel('Countdown format').selectOption('seconds');
  await page.getByRole('button', { name: 'Save item' }).click();

  const allItems = page.locator('.view-section').filter({ hasText: 'All items' });
  await allItems.getByRole('button', { name: /^Edit / }).click();
  const viewScripts = await openViewEditorSection(page, 'Scripts');
  await viewScripts.getByRole('button', { name: '+ Add computed field' }).click();
  await viewScripts.getByLabel('Name').fill('View countdown');
  await viewScripts.getByLabel('Countdown format').selectOption('seconds');
  const displayed = await openViewEditorSection(page, 'Show in results');
  const scriptGroup = displayed.locator('details').filter({ hasText: 'Scripts' }).first();
  if (!await scriptGroup.evaluate((element) => (element as HTMLDetailsElement).open)) await scriptGroup.locator(':scope > summary').click();
  await expect(scriptGroup.getByRole('checkbox', { name: /Script results/ })).toBeVisible();
  await expect(scriptGroup.getByRole('checkbox', { name: /New calculation/ })).toBeVisible();
  await scriptGroup.getByRole('checkbox', { name: /Script results/ }).check();
  const viewScriptGroup = displayed.locator('details').filter({ hasText: 'View scripts' }).first();
  if (!await viewScriptGroup.evaluate((element) => (element as HTMLDetailsElement).open)) await viewScriptGroup.locator(':scope > summary').click();
  await viewScriptGroup.getByRole('checkbox', { name: /View countdown/ }).check();
  await page.getByRole('button', { name: 'Save view' }).click();

  const result = page.locator('.view-section').filter({ hasText: 'All items' }).locator('[data-field="scripts"]');
  await expect(result).toContainText('New calculation:');
  const first = await result.textContent();
  await expect.poll(async () => result.textContent(), { timeout: 4_000 }).not.toBe(first);
  const viewResult = page.locator('.view-section').filter({ hasText: 'All items' }).locator('[data-field="view_script.view_countdown"]');
  await expect(viewResult).not.toBeEmpty();
  const firstViewResult = await viewResult.textContent();
  await expect.poll(async () => viewResult.textContent(), { timeout: 4_000 }).not.toBe(firstViewResult);

  await page.reload();
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.locator('.view-section').filter({ hasText: 'All items' }).locator('[data-field="scripts"]')).toContainText('New calculation:');
  await expect(page.locator('.view-section').filter({ hasText: 'All items' }).locator('[data-field="view_script.view_countdown"]')).not.toBeEmpty();
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
  const organizationSection = await openEditorSection(page, 'Organization');
  await organizationSection.getByLabel('Priority').selectOption({ label: '2 — Medium' });
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
  await openEditorSection(page, 'Dates & time');
  await page.getByLabel('Event opens', { exact: true }).fill('2026-08-27T08:00');
  await page.getByLabel('Event ends', { exact: true }).fill('2026-08-27T08:30');
  await openEditorSection(page, 'Progress & habit');
  await page.getByLabel('Track as a habit').check();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.habit-stopwatch strong')).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
  await page.waitForTimeout(1100);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.locator('.habit-timer-history li')).toHaveCount(1);
  await openEditorSection(page, 'Recurrence & auto-renew');
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
  await openEditorSection(page, 'Item JSON');
  await expect(page.getByLabel('Item JSON')).toHaveValue(/"completedDates": \[\s+"\d{4}-\d{2}-\d{2}"/);
  await expect(page.getByLabel('Item JSON')).toHaveValue(/"timerSessions": \[/);
});

test('saved view applies multi-rule sort DSL and displayed field selection', async ({ page }, testInfo) => {
  await page.getByLabel('Workspace name').fill('Sorted views');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();

  await goToAllItems(page);
  for (const [title, priority] of [['Low item', '1'], ['High item', '4']] as const) {
    await openNewItem(page);
    await page.getByLabel('Title', { exact: true }).fill(title);
    const organizationSection = await openEditorSection(page, 'Organization');
    await organizationSection.getByLabel('Priority').selectOption(priority);
    const datesSection = await openEditorSection(page, 'Dates & time');
    await datesSection.getByLabel('Event opens', { exact: true }).fill('2026-08-26T10:00');
    await datesSection.getByLabel('Event ends', { exact: true }).fill('2026-08-26T10:10');
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
  await expect(page.getByLabel('SQL-like sorting')).toHaveValue('priority desc nulls last\nattentionOrder asc nulls last\ndurationOrder desc nulls last\ncreatedAt desc nulls last');
  await openViewEditorSection(page, 'Visual setup');
  await openViewEditorSection(page, 'Show in results');
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
  await expect(view.locator('.view-results-scroll')).toHaveCSS('touch-action', 'pan-x pan-y');
  const viewBounds = await view.boundingBox();
  const editBounds = await view.getByRole('button', { name: /^Edit /  }).boundingBox();
  expect(viewBounds).not.toBeNull();
  expect(editBounds).not.toBeNull();
  if (testInfo.project.name === 'mobile') {
    expect(viewBounds!.x).toBeLessThanOrEqual(8);
    await expect(page.locator('body')).toHaveCSS('overflow-x', 'clip');
    await expect(page.locator('.page-home')).toHaveCSS('overscroll-behavior-x', 'none');
  }
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

test('completion keeps an open-only view stable through the Undo window', async ({ page }) => {
  await page.getByLabel('Workspace name').fill('Stable completion');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await page.getByPlaceholder('Add new item').fill('Stable row');
  await page.getByPlaceholder('Add new item').press('Enter');
  await page.getByRole('button', { name: 'Close item editor' }).click();

  await page.getByRole('button', { name: 'New view' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Open stable');
  await page.getByRole('combobox', { name: 'Renderer' }).selectOption('list');
  await openViewEditorSection(page, 'Advanced filter code');
  await page.getByLabel('Advanced filter code').fill('state == "open"');
  await page.getByRole('button', { name: 'Save view' }).click();

  const view = page.locator('.view-section').filter({ has: page.getByRole('heading', { name: 'Open stable', exact: true }) });
  const row = view.locator('[data-view-item-id]').filter({ hasText: 'Stable row' });
  await expect(row).toBeVisible();
  const before = await view.boundingBox();
  const complete = row.locator('.state-toggle');
  const immediate = await complete.evaluate((button) => {
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', button: 0 }));
    const shell = button.closest<HTMLElement>('[data-view-item-id]');
    const wrapper = shell?.querySelector<HTMLElement>('.reorderable-view-item');
    const card = shell?.querySelector<HTMLElement>('.item-card');
    const toggle = shell?.querySelector<HTMLElement>('.state-toggle');
    const title = shell?.querySelector<HTMLElement>('.item-title');
    return {
      label: toggle?.getAttribute('aria-label') ?? '',
      mark: toggle?.textContent ?? '',
      titleDecoration: title ? getComputedStyle(title).textDecorationLine : '',
      wrapper: wrapper ? getComputedStyle(wrapper).backgroundColor : '',
      card: card ? getComputedStyle(card).backgroundColor : '',
      toggle: toggle ? getComputedStyle(toggle).backgroundColor : '',
    };
  });
  expect(immediate.label).toBe('Complete item');
  expect(immediate.mark).toBe('✓');
  expect(immediate.titleDecoration).toBe('line-through');
  expect(immediate.wrapper).not.toBe('rgba(0, 0, 0, 0)');
  expect(immediate.card).toBe('rgba(0, 0, 0, 0)');
  expect(immediate.toggle).not.toBe('rgba(0, 0, 0, 0)');
  const undo = page.locator('.undo-toast');
  await expect(undo).toBeVisible();
  await expect(undo.locator('strong')).toHaveText('4');
  await expect(complete).toHaveAttribute('aria-label', 'Reopen item');
  await expect(complete).toHaveCSS('background-color', immediate.toggle);
  await complete.dispatchEvent('pointerup', { pointerType: 'touch', button: 0 });
  await complete.evaluate((button: HTMLButtonElement) => button.click());
  await expect(row.getByRole('button', { name: 'Reopen item' })).toBeVisible();
  const held = await view.boundingBox();
  expect(before).not.toBeNull(); expect(held).not.toBeNull();
  expect(Math.abs(held!.height - before!.height)).toBeLessThanOrEqual(2);
  await expect(page.getByText('Item completed', { exact: true })).toBeVisible();
  const undoBackground = await undo.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(undoBackground).toMatch(/rgba\(|\/\s*0\./);
  expect(undoBackground).not.toBe('rgb(0, 0, 0)');
  const undoBox = await undo.boundingBox();
  const captureBox = await page.locator('.capture-dock').boundingBox();
  expect(undoBox).not.toBeNull(); expect(captureBox).not.toBeNull();
  expect(undoBox!.width).toBeLessThanOrEqual(322);
  expect(undoBox!.y + undoBox!.height).toBeLessThan(captureBox!.y);

  await page.waitForTimeout(4_300);
  await expect(view.getByText('Stable row', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Item completed', { exact: true })).toHaveCount(0);
});

test('rapid touch reopen and repeat completion update in the first frame', async ({ page }) => {
  await page.getByLabel('Workspace name').fill('Rapid completion');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await page.getByPlaceholder('Add new item').fill('Rapid row');
  await page.getByPlaceholder('Add new item').press('Enter');
  await page.getByRole('button', { name: 'Close item editor' }).click();
  const row = page.locator('.view-section').filter({ has: page.getByRole('heading', { name: 'All items', exact: true }) }).locator('[data-view-item-id]').filter({ hasText: 'Rapid row' });
  const toggle = row.locator('.state-toggle');
  const touch = async (expectedMark: string, expectedDecoration: string) => {
    await toggle.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 });
    await expect(toggle).toHaveText(expectedMark, { timeout: 250 });
    await expect(row.locator('.item-title')).toHaveCSS('text-decoration-line', expectedDecoration, { timeout: 250 });
    await toggle.dispatchEvent('pointerup', { pointerType: 'touch', button: 0 });
    await toggle.evaluate((button: HTMLButtonElement) => button.click());
  };
  await touch('✓', 'line-through');
  await expect(toggle).toHaveAttribute('aria-label', 'Reopen item');
  await touch('', 'none');
  await expect(toggle).toHaveAttribute('aria-label', 'Complete item');
  await touch('✓', 'line-through');
  await expect(toggle).toHaveAttribute('aria-label', 'Reopen item');
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

test('recurring item accepts Deadline as its schedule anchor and handles missing dates', async ({ page }) => {
  await page.getByLabel('Workspace name').fill('Recurring items');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();

  await goToAllItems(page);
  await openNewItem(page);
  await page.getByLabel('Title', { exact: true }).fill('Weekly due-only item');
  await openEditorSection(page, 'Dates & time');
  await expect(page.getByLabel('Event opens', { exact: true })).toHaveValue('');
  const dueSetup = await page.evaluate(() => {
    const date = new Date(Date.now() + 3_600_000);
    const value = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    return { value, weekday: ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][date.getDay()]! };
  });
  await openEditorSection(page, 'Recurrence & auto-renew');
  await page.getByLabel('Make this a recurring series').check();
  await page.getByLabel('Repeat after completion').check();
  await page.getByLabel('Repeat frequency').selectOption('WEEKLY');
  await page.getByLabel('Repeat interval').fill('2');
  await page.getByRole('button', { name: `Repeat on ${dueSetup.weekday}` }).click();
  await page.getByText('Advanced recurrence behavior', { exact: true }).click();
  await page.getByLabel('Activation amount').fill('3');
  await page.getByLabel('Activation unit').selectOption('days');
  await expect(page.getByLabel(/Repeat rule/)).toHaveValue(`FREQ=WEEKLY;INTERVAL=2;BYDAY=${dueSetup.weekday}`);
  await expect(page.getByLabel(/Activation duration/)).toHaveValue('P3D');
  await page.getByRole('button', { name: 'Save item' }).click();
  await expect(page.getByRole('alert')).toHaveText('A recurring item needs a Scheduled start or Deadline.');

  await page.locator('input[aria-label="Due / Active range ends"]').fill(dueSetup.value);
  await expect(page.locator('input[aria-label="Due / Active range ends"]')).toHaveValue(dueSetup.value);
  await page.getByRole('button', { name: 'Save item' }).click();
  await expect(page.getByRole('dialog', { name: 'Item editor' })).toBeHidden();

  await goToAllItems(page);
  const templatesSection = page.locator('.all-sections > details.recurring-items').filter({ has: page.getByText('Recurring items', { exact: true }) }).first();
  if (!await templatesSection.evaluate((element) => (element as HTMLDetailsElement).open)) await templatesSection.locator(':scope > summary').click();
  await expect(templatesSection.getByText('These are the recurrence source settings. Auto-renew keeps one live item and records finished cycles inside its Cycle history.')).toBeHidden();
  await expect(templatesSection.locator(':scope > summary b')).toHaveText('1');

  await goHome(page);
  await page.getByRole('button', { name: 'New view' }).click();
  await openViewEditorSection(page, 'Advanced filter code');
  await expect(page.getByLabel('Advanced filter code')).toHaveValue('((state == "open" || state == "done") && isTemplate != true)');
  await expect(page.getByLabel('Advanced filter code')).toHaveCSS('font-family', /monospace|Menlo|Monaco|Consolas/i);
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Open items');
  await page.getByRole('button', { name: 'Save view' }).click();
  const openItemsView = page.locator('.view-section').filter({ hasText: 'Open items' });
  await expect(openItemsView.getByText('Weekly due-only item', { exact: true })).toHaveCount(1);

  const recurringRow = openItemsView.getByRole('row').filter({ hasText: 'Weekly due-only item' });
  await recurringRow.getByRole('button', { name: /^Complete/ }).click();
  await page.waitForTimeout(100);
  await openItemsView.getByRole('row').filter({ hasText: 'Weekly due-only item' }).click();
  const history = await openEditorSection(page, 'Completion history');
  const completionTime = history.locator('input[type="datetime-local"][aria-label^="Completion time for"]');
  await expect(completionTime).toBeVisible();
  const correctedCompletion = await page.evaluate(() => {
    const date = new Date(Date.now() - 30 * 60 * 1_000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  await completionTime.fill(correctedCompletion);
  await history.getByRole('button', { name: 'Save time' }).click();
  await expect(page.getByText('Completion time saved. Next cycle updated.', { exact: true })).toBeVisible();
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
  await openEditorSection(page, 'Recurrence & auto-renew');
  await page.getByLabel('Make this a recurring series').check();
  const completionCopy = page.locator('.completion-anchor-toggle > span');
  const completionSpacing = await completionCopy.evaluate((element) => {
    const title = element.querySelector('strong')!.getBoundingClientRect();
    const description = element.querySelector('small')!.getBoundingClientRect();
    return { titleBottom: title.bottom, descriptionTop: description.top };
  });
  expect(completionSpacing.descriptionTop - completionSpacing.titleBottom).toBeGreaterThanOrEqual(3);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  const activeWindowColors = await page.locator('.active-window-toggle').evaluate((element) => ({
    surface: getComputedStyle(element).backgroundColor,
    title: getComputedStyle(element.querySelector('strong')!).color,
    description: getComputedStyle(element.querySelector('small')!).color,
  }));
  expect(activeWindowColors).toEqual({ surface: 'rgb(8, 8, 8)', title: 'rgb(241, 241, 241)', description: 'rgb(167, 167, 167)' });
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
