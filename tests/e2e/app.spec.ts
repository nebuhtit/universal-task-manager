import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('utm-secure-v1');
      request.onsuccess = () => resolve(); request.onerror = () => resolve(); request.onblocked = () => resolve();
    });
  });
  await page.reload();
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

  await page.getByRole('button', { name: 'Lock' }).click();
  await expect(page.getByRole('heading', { name: 'Unlock your workspace' })).toBeVisible();
  await page.getByLabel('Password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('Prepare material by Thursday')).toBeVisible();
  await page.getByRole('button', { name: 'Views' }).click();
  await expect(page.locator('.view-section').getByText('Prepare material by Thursday', { exact: true })).toBeVisible();
});

test('mobile shell stays usable at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByLabel('Workspace name').fill('Mobile');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await expect(page.locator('.bottom-nav')).toBeVisible();
  await page.getByRole('button', { name: '+ New item' }).click();
  await expect(page.getByRole('dialog', { name: 'Item editor' })).toBeVisible();
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
  await page.getByLabel('Due', { exact: true }).fill('2030-08-15T18:30');
  await expect(page.getByLabel('Due', { exact: true })).toHaveValue('2030-08-15T18:30');
  await page.getByRole('button', { name: 'Save item' }).click();
  await expect(page.getByRole('dialog', { name: 'Item editor' })).toBeHidden();

  await page.getByRole('button', { name: 'All items' }).click();
  await page.getByText('series templates', { exact: true }).click();
  await expect(page.getByText('Weekly due-only item', { exact: true })).toBeVisible();
});
