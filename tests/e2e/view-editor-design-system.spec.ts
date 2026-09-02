import { expect, test, type Page } from '@playwright/test';

async function createWorkspace(page: Page) {
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('View editor design system');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
}

async function openSection(page: Page, name: string) {
  const details = page.locator('.view-editor details.view-editor-section').filter({ has: page.getByText(name, { exact: true }) }).first();
  if (!await details.evaluate((element) => (element as HTMLDetailsElement).open)) await details.locator(':scope > summary').click();
  return details;
}

test('view editor keeps visual, display, sorting, and creation-default semantics', async ({ page, browserName }) => {
  if (browserName === 'chromium') await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await createWorkspace(page);
  const trigger = page.getByRole('button', { name: 'New view' });
  await trigger.click();

  const dialog = page.getByRole('dialog', { name: 'Edit view' });
  await expect(dialog).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('Design system view');

  const visual = await openSection(page, 'Visual setup');
  const row = visual.locator('.visual-condition-row').first();
  await row.getByRole('combobox', { name: 'Property' }).selectOption('state');
  await row.getByRole('combobox', { name: 'Value' }).selectOption('done');

  await openSection(page, 'Show in results');
  await page.getByRole('button', { name: 'Hide all' }).click();
  await page.getByLabel('Search displayed fields').fill('title');
  const core = page.locator('.field-groups details').filter({ has: page.getByText('Core', { exact: true }) });
  if (!await core.evaluate((element) => (element as HTMLDetailsElement).open)) await core.locator(':scope > summary').click();
  await core.getByRole('checkbox', { name: /^Title/ }).check();

  const advanced = await openSection(page, 'Advanced filter code');
  await expect(page.getByLabel('Advanced filter code')).toHaveValue(/state == "done"/);
  const copyCode = advanced.getByRole('button', { name: 'Copy' });
  await copyCode.click();
  await expect(copyCode).toHaveText('Copied');
  if (browserName === 'chromium') await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('state == "done"');

  await openSection(page, 'Sorting');
  await page.getByRole('combobox', { name: 'Sort field 1' }).selectOption('priority');
  await expect(page.getByLabel('SQL-like sorting')).toHaveValue('priority desc nulls last\nupdatedAt desc nulls last');

  await openSection(page, 'Defaults for new items');
  await page.getByRole('button', { name: '+ Pin property' }).click();
  const defaults = page.locator('.creation-default-row').first();
  await defaults.getByRole('spinbutton').fill('4');

  const statistics = await openSection(page, 'Statistics');
  await expect(statistics.getByRole('checkbox', { name: 'Show time statistics' })).toBeChecked();
  await statistics.getByText('Reserved items', { exact: true }).click();
  await expect(statistics.getByLabel('Search reserved items')).toBeVisible();
  await statistics.getByRole('checkbox', { name: 'Show time statistics' }).uncheck();

  await page.getByRole('button', { name: 'Save view' }).click();
  const view = page.locator('.view-section').filter({ hasText: 'Design system view' });
  await expect(view.getByRole('heading', { name: 'Design system view' })).toBeVisible();

  await view.getByRole('button', { name: /^Edit / }).click();
  await expect(page.locator('.view-editor details.view-editor-section[open]')).toHaveCount(0);
  await openSection(page, 'Show in results');
  const reopenedCore = page.locator('.field-groups details').filter({ has: page.getByText('Core', { exact: true }) });
  await reopenedCore.locator(':scope > summary').click();
  await expect(page.locator('.field-groups').getByRole('checkbox', { name: /^Title/ })).toBeChecked();
  await openSection(page, 'Defaults for new items');
  await expect(page.locator('.creation-default-row').getByRole('spinbutton')).toHaveValue('4');
  const reopenedStatistics = await openSection(page, 'Statistics');
  await expect(reopenedStatistics.getByRole('checkbox', { name: 'Show time statistics' })).not.toBeChecked();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  if ((page.viewportSize()?.width ?? 0) > 620) await expect(view.getByRole('button', { name: /^Edit / })).toBeFocused();
});

test('builds reusable schedule periods with tomorrow, custom dates and overdue', async ({ page }) => {
  await createWorkspace(page);
  await page.getByRole('button', { name: 'New view' }).click();
  const visual = await openSection(page, 'Visual setup');
  await visual.getByRole('button', { name: '+ Add time period' }).click();
  const row = visual.locator('.visual-condition-row').last();
  await expect(row.getByRole('combobox', { name: 'Property' })).toHaveValue('schedulePeriod');
  await row.getByRole('combobox', { name: 'Schedule period' }).selectOption('tomorrow');
  await row.getByRole('checkbox', { name: 'Include overdue' }).check();
  await row.getByRole('checkbox', { name: 'Event opens → Event ends overlaps period' }).check();
  await openSection(page, 'Advanced filter code');
  await expect(page.getByLabel('Advanced filter code')).toHaveValue(/scheduleInPeriod\("tomorrow", "event_open,active,due,event", true, 7, "", ""\)/);

  await openSection(page, 'Visual setup');
  await row.getByRole('combobox', { name: 'Schedule period' }).selectOption('custom');
  await row.getByLabel('Custom period starts').fill('2026-09-10');
  await row.getByLabel('Custom period ends').fill('2026-09-14');
  const statistics = await openSection(page, 'Statistics');
  await expect(statistics).toContainText('2026-09-10 – 2026-09-14');
  await openSection(page, 'Advanced filter code');
  await expect(page.getByLabel('Advanced filter code')).toHaveValue(/scheduleInPeriod\("custom", "event_open,active,due,event", true, 7, "2026-09-10", "2026-09-14"\)/);

  await page.getByRole('button', { name: 'Save view' }).click();
  const view = page.locator('.view-section').filter({ hasText: 'New view' });
  await view.getByRole('button', { name: /^Edit / }).click();
  await openSection(page, 'Visual setup');
  await expect(page.getByRole('combobox', { name: 'Schedule period' })).toHaveValue('custom');
  await expect(page.getByRole('checkbox', { name: 'Include overdue' })).toBeChecked();
});

test('shows the existing Today preset as editable visual conditions', async ({ page }) => {
  await createWorkspace(page);
  const todayView = page.locator('.view-section').filter({ has: page.getByRole('heading', { name: 'Today', exact: true }) });
  await todayView.getByRole('button', { name: /^Edit / }).click();
  const visual = await openSection(page, 'Visual setup');
  await expect(visual.locator('.visual-condition-row')).toHaveCount(3);
  const period = visual.locator('.visual-condition-row').last();
  await expect(period.getByRole('combobox', { name: 'Property' })).toHaveValue('schedulePeriod');
  await expect(period.getByRole('combobox', { name: 'Schedule period' })).toHaveValue('today');
  await expect(period.getByRole('checkbox', { name: 'Include overdue' })).toBeChecked();
});

test('explains reminder filtering separately from reminder field visibility', async ({ page }) => {
  await createWorkspace(page);
  await page.getByRole('button', { name: 'New view' }).click();
  const visual = await openSection(page, 'Visual setup');
  const row = visual.locator('.visual-condition-row').first();
  await row.getByRole('combobox', { name: 'Property' }).selectOption('reminders');
  await expect(row.getByRole('combobox', { name: 'Property' }).locator('option:checked')).toHaveText('Any reminders');
  const filterExplanation = visual.getByText(/Any reminders includes acknowledged reminders/);
  await expect(filterExplanation).toBeHidden();
  await page.evaluate(() => { document.documentElement.dataset.explanations = 'on'; });
  await expect(filterExplanation).toBeVisible();

  const displayed = await openSection(page, 'Show in results');
  const reminders = displayed.locator('.field-groups details').filter({ has: page.getByText('Reminders', { exact: true }) });
  if (!await reminders.evaluate((element) => (element as HTMLDetailsElement).open)) await reminders.locator(':scope > summary').click();
  await expect(reminders.getByText(/Turning it off only hides the field/)).toBeVisible();
  await expect(reminders.getByRole('checkbox', { name: /^Active reminders/ })).toBeVisible();
  await expect(reminders.getByRole('checkbox', { name: /^Next resolved active reminder/ })).toBeVisible();
});

test('saving a view does not restore mobile focus to quick capture', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) > 620, 'Mobile focus behavior');
  await createWorkspace(page);
  const quickCapture = page.getByLabel('Add new item');
  await quickCapture.focus();
  const todayView = page.locator('.view-section').filter({ has: page.getByRole('heading', { name: 'Today', exact: true }) });
  await todayView.getByRole('button', { name: /^Edit / }).evaluate((button) => (button as HTMLButtonElement).click());
  await expect(page.getByRole('dialog', { name: 'Edit view' })).toBeVisible();

  await page.getByRole('button', { name: 'Save view' }).click();

  await expect(page.getByRole('dialog', { name: 'Edit view' })).toBeHidden();
  await expect(quickCapture).not.toBeFocused();
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).not.toMatch(/INPUT|TEXTAREA/);
});

test('view ordering uses drag handles and a keyboard alternative', async ({ page }) => {
  await createWorkspace(page);
  await page.getByRole('button', { name: 'New view' }).click();
  await openSection(page, 'Show in results');
  const rows = page.locator('.selected-fields > div');
  const labels = async () => await rows.locator('code').allTextContents();
  const initial = await labels();
  expect(initial.length).toBeGreaterThan(1);

  await page.getByRole('button', { name: `Reorder ${initial[0]}` }).press('ArrowDown');
  await expect.poll(labels).toEqual([initial[1], initial[0], ...initial.slice(2)]);

  const source = page.getByRole('button', { name: `Reorder ${initial[0]}` });
  const target = rows.first();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull(); expect(targetBox).not.toBeNull();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(labels).toEqual(initial);
});

test('view editor is readable as a dark mobile sheet', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) > 620, 'mobile contract');
  await page.emulateMedia({ colorScheme: 'dark' });
  await createWorkspace(page);
  await page.getByRole('button', { name: 'New view' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit view' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('border-bottom-left-radius', '0px');
  const colors = await dialog.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color };
  });
  expect(colors.background).not.toBe(colors.color);
  await openSection(page, 'Visual setup');
  await expect(dialog.locator('.ui-dialog-content')).toHaveCSS('overflow-y', 'auto');
  await page.getByRole('button', { name: 'Close view editor' }).click();
  await expect(dialog).toBeHidden();
});
