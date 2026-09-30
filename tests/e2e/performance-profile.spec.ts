import { expect, test } from '@playwright/test';

test('profiles trusted actions and worker saves without retaining private inputs', async ({ page }) => {
  test.setTimeout(60_000);
  const marker = 'PROFILE_PRIVATE_ITEM_8934';
  const password = 'PROFILE_SECRET_PASSWORD_2741';
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('PROFILE_PRIVATE_WORKSPACE_3129');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create encrypted workspace', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();

  await page.getByPlaceholder('Add new item', { exact: true }).fill(marker);
  await page.getByPlaceholder('Add new item', { exact: true }).press('Enter');
  const editor = page.getByRole('dialog', { name: 'Item editor' });
  await expect(editor).toBeVisible();
  await editor.getByLabel('Title', { exact: true }).fill(marker + '_edited');
  await editor.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(editor).toBeHidden();

  await page.locator('.quick-page-nav').getByRole('button', { name: 'Calendar', exact: true }).click();
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await page.getByRole('button', { name: 'List', exact: true }).click();

  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('utm:performance-profile:v1') ?? '[]') as {
    commit: string; dirty: boolean; builtAt: string; environment: string;
    actions: { kind: string; frameMs?: number; spans: { stage: string }[] }[];
    aggregates: { stage: string; count: number }[];
  }[]);
  await expect.poll(async () => (await read()).at(-1)?.aggregates.map(entry => entry.stage), { timeout: 25_000 }).toEqual(expect.arrayContaining(['save.worker-work', 'save.write', 'calendar.evaluate']));
  const report = (await read()).at(-1)!;
  expect(report.commit).toMatch(/^[a-f0-9]{7}$/);
  expect(typeof report.dirty).toBe('boolean');
  expect(report.builtAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(report.environment).toBe('web');
  expect(report.actions.map(action => action.kind)).toEqual(expect.arrayContaining(['item-save', 'calendar-list', 'calendar-timeline', 'input']));
  expect(report.actions.find(action => action.kind === 'calendar-timeline')?.frameMs).toBeGreaterThanOrEqual(0);
  expect(report.actions.find(action => action.kind === 'item-save')?.spans.some(span => span.stage === 'save.queue')).toBe(true);
  expect(JSON.stringify(report)).not.toMatch(/PROFILE_PRIVATE|PROFILE_SECRET|_edited/);
});
