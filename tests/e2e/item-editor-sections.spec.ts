import { expect, test, type Page } from '@playwright/test';

async function createWorkspace(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('Item editor sections');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
}

async function openSection(page: Page, title: string) {
  const summary = page.locator('.editor-scroll > details > summary').filter({ hasText: title }).first();
  const section = summary.locator('..');
  if (!await section.evaluate((element) => (element as HTMLDetailsElement).open)) await section.locator(':scope > summary').click();
  return section;
}

async function goTo(page: Page, name: 'Home' | 'Settings' | 'PARA') {
  if ((page.viewportSize()?.width ?? 0) > 620) await page.locator('.sidebar').getByRole('button', { name }).click();
  else {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.locator('.mobile-nav-menu').getByRole('button', { name }).click();
  }
}

async function openArea(page: Page, name: string) {
  const group = page.locator('.organization-area-group').filter({ has: page.getByRole('heading', { name, exact: true }) });
  if (!await group.evaluate((element) => (element as HTMLDetailsElement).open)) await group.locator(':scope > summary').click();
  return group;
}

test('organization tokens save multiple values and editor sections reopen cleanly', async ({ page }) => {
  await createWorkspace(page);
  await page.getByPlaceholder('Add new item').fill('Design system item');
  await page.getByPlaceholder('Add new item').press('Enter');

  const organization = await openSection(page, 'Organization');
  await organization.getByLabel('Priority').selectOption('3');
  await organization.getByLabel('Add Area').fill('Work');
  await organization.getByLabel('Add Area').press('Enter');
  await organization.getByLabel('Add Area').fill('Learning');
  await organization.getByLabel('Add Area').press('Enter');
  await organization.getByLabel('Add Project').fill('Phase 3');
  await organization.getByLabel('Add Project').press('Enter');
  await organization.getByLabel('Add Tag').fill('design');
  await organization.getByLabel('Add Tag').press('Enter');
  await organization.getByLabel('Add Tag').fill('calm');
  await organization.getByLabel('Add Tag').press('Enter');
  await organization.getByLabel('Create Task list').fill('Phase 3');
  await page.getByRole('button', { name: 'Save item' }).click();

  await page.getByText('Design system item', { exact: true }).first().click();
  const reopenedOrganization = page.locator('.editor-scroll > details').filter({ has: page.getByText('Organization', { exact: true }) }).first();
  await expect(reopenedOrganization).not.toHaveAttribute('open', '');
  await reopenedOrganization.locator(':scope > summary').click();
  await expect(page.getByLabel('Priority')).toHaveValue('3');
  await expect(page.getByRole('button', { name: 'Remove Area Work' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Area Learning' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Project Phase 3' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Tag design' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Tag calm' })).toBeVisible();
  await expect(page.getByLabel('Create Task list')).toHaveValue('Phase 3');
  await expect(page.locator('.editor-scroll > details > summary').filter({ hasText: 'Organization' }).first().locator('.section-dot')).toHaveCount(1);
});

test('template toggle uses the shared checkbox without changing template semantics', async ({ page }) => {
  await createWorkspace(page);
  await page.getByPlaceholder('Add new item').fill('Reusable template');
  await page.getByPlaceholder('Add new item').press('Enter');
  const more = await openSection(page, 'More');
  const templateSummary = more.locator('details > summary').filter({ hasText: 'Template' }).first();
  const template = templateSummary.locator('..');
  if (!await template.evaluate((element) => (element as HTMLDetailsElement).open)) await templateSummary.click();
  await template.getByRole('checkbox', { name: 'Save this item as a template' }).check();
  await page.getByRole('button', { name: 'Save item' }).click();

  await expect(page.getByText('Reusable template', { exact: true })).toHaveCount(0);
  await page.getByPlaceholder('Add new item').fill('From template');
  await page.getByPlaceholder('Add new item').press('Enter');
  const picker = page.locator('.template-picker');
  if (!await picker.evaluate((element) => (element as HTMLDetailsElement).open)) await picker.locator(':scope > summary').click();
  await expect(picker.getByRole('button', { name: 'Reusable template' })).toBeVisible();
});

test('related PARA suggestions support many-to-many selection and item conversion', async ({ page }) => {
  await createWorkspace(page);
  await goTo(page, 'PARA');
  await page.getByLabel('New Area', { exact: true }).fill('Work');
  await page.getByLabel('New Area', { exact: true }).press('Enter');
  await page.getByLabel('New Area', { exact: true }).fill('Personal');
  await page.getByLabel('New Area', { exact: true }).press('Enter');

  const workGroup = await openArea(page, 'Work');
  await workGroup.getByLabel('New Project in Work').fill('Launch');
  await workGroup.getByLabel('New Project in Work').press('Enter');
  await expect(workGroup.getByText('Launch', { exact: true })).toBeVisible();

  await goTo(page, 'Home');
  await page.getByPlaceholder('Add new item').fill('Connected item');
  await page.getByPlaceholder('Add new item').press('Enter');
  const organization = await openSection(page, 'Organization');
  const launchSuggestion = organization.locator('[aria-label="Projects suggestions"] button').filter({ hasText: 'Launch' });
  await expect(launchSuggestion).toContainText('In: Work');
  await launchSuggestion.click();
  await expect(organization.getByRole('button', { name: 'Remove Project Launch' })).toBeVisible();
  await expect(organization.getByRole('button', { name: 'Remove Area Work' })).toBeVisible();

  await organization.getByRole('button', { name: 'Remove Area Work' }).click();
  await expect(organization.getByRole('button', { name: 'Remove Project Launch' })).toBeVisible();
  await organization.locator('[aria-label="Areas suggestions"] button').filter({ hasText: 'Work' }).click();
  await organization.getByRole('button', { name: 'Convert item to Project' }).click();
  await page.getByRole('button', { name: 'Save item' }).click();

  await goTo(page, 'PARA');
  const reopenedWork = await openArea(page, 'Work');
  await expect(reopenedWork.getByText('Connected item', { exact: true })).toBeVisible();
});

test('Projects can be reordered directly inside their Area', async ({ page }) => {
  await createWorkspace(page);
  await goTo(page, 'PARA');
  await page.getByLabel('New Area', { exact: true }).fill('Work');
  await page.getByLabel('New Area', { exact: true }).press('Enter');
  await page.getByLabel('New Area', { exact: true }).fill('Personal');
  await page.getByLabel('New Area', { exact: true }).press('Enter');

  const areaHeadings = page.locator('.organization-area-group > summary h3');
  await expect(areaHeadings).toHaveText(['No Area', 'Work', 'Personal']);
  await page.getByRole('button', { name: 'Reorder Area Personal' }).press('ArrowUp');
  await expect(areaHeadings).toHaveText(['No Area', 'Personal', 'Work']);

  const workGroup = await openArea(page, 'Work');
  const projectInput = workGroup.getByLabel('New Project in Work');
  await projectInput.fill('Alpha');
  await projectInput.press('Enter');
  await projectInput.fill('Beta');
  await projectInput.press('Enter');

  const projectNames = workGroup.locator('.organization-project-row > strong');
  await expect(projectNames).toHaveText(['Alpha', 'Beta']);
  await workGroup.getByRole('button', { name: 'Reorder Project Alpha' }).press('ArrowDown');
  await expect(projectNames).toHaveText(['Beta', 'Alpha']);

  const alphaHandle = workGroup.getByRole('button', { name: 'Reorder Project Alpha' });
  const betaRow = workGroup.locator('.organization-project-drag-row').filter({ has: page.getByText('Beta', { exact: true }) });
  const target = await betaRow.boundingBox();
  expect(target).not.toBeNull();
  await alphaHandle.dragTo(betaRow, { targetPosition: { x: target!.width / 2, y: target!.height / 4 } });
  await expect(projectNames).toHaveText(['Alpha', 'Beta']);
});

test('Unified priority mirrors Project links to several Areas and keeps occurrences customizable', async ({ page }) => {
  await createWorkspace(page);
  await goTo(page, 'PARA');
  await page.getByLabel('New Area', { exact: true }).fill('Work');
  await page.getByLabel('New Area', { exact: true }).press('Enter');
  await page.getByLabel('New Area', { exact: true }).fill('Personal');
  await page.getByLabel('New Area', { exact: true }).press('Enter');

  const workGroup = await openArea(page, 'Work');
  await workGroup.getByLabel('New Project in Work').fill('Shared');
  await workGroup.getByLabel('New Project in Work').press('Enter');
  const workProject = workGroup.locator('.organization-project-row').filter({ has: page.getByText('Shared', { exact: true }) });
  await workProject.getByLabel('Add Area to Shared').selectOption('Personal');
  await workProject.getByRole('button', { name: 'Add', exact: true }).click();

  const personalGroup = await openArea(page, 'Personal');
  await expect(personalGroup.getByText('Shared', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reorder Project Shared in Work' })).toBeVisible();
  const personalOccurrence = page.getByRole('button', { name: 'Reorder Project Shared in Personal' });
  await expect(personalOccurrence).toBeVisible();
  await personalOccurrence.press('Home');
  await expect(page.locator('.organization-priority-list > .organization-priority-row').first().getByRole('button')).toHaveAttribute('aria-label', 'Reorder Project Shared in Personal');

  await personalGroup.getByRole('button', { name: 'Remove Shared from Personal' }).click();
  await expect(personalGroup.getByText('Shared', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reorder Project Shared in Personal' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reorder Project Shared in Work' })).toHaveCount(1);
});
