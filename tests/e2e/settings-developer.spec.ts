import { expect, test, type Locator } from '@playwright/test';

test('developer tools stay grouped and diagnostics remain usable', async ({ page }, testInfo) => {
  const touch = testInfo.project.use.hasTouch === true;
  const activate = async (control: Locator) => {
    await control.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (touch) await control.tap(); else await control.click();
  };
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('Developer settings');
  await page.getByLabel('Password', { exact: true }).fill('settings-test-password');
  await page.getByLabel('Confirm password').fill('settings-test-password');
  await activate(page.getByRole('button', { name: 'Create encrypted workspace' }));
  await expect(page.locator('.capture-dock input')).toBeVisible();
  if (touch) {
    await activate(page.getByRole('button', { name: 'Open navigation' }));
    await activate(page.locator('.mobile-nav-menu').getByRole('button', { name: 'Settings', exact: true }));
  } else await activate(page.locator('.sidebar').getByRole('button', { name: 'Settings', exact: true }));

  const developer = page.getByTestId('developer-settings');
  await expect(developer).toBeVisible();
  await expect(page.getByLabel('Record local diagnostics', { exact: true })).toBeHidden();
  const security = page.getByTestId('device-unlock-settings');
  await activate(security.locator(':scope > summary'));
  await expect(security.getByRole('button', { name: 'Change password', exact: true })).toBeVisible();
  await expect(security.getByRole('heading', { name: 'Face ID / Touch ID', exact: true })).toBeVisible();
  await expect(security.getByRole('button', { name: 'Disable encryption (test)', exact: true })).toHaveCount(0);
  await activate(security.locator(':scope > summary'));

  const developerSummary = developer.locator(':scope > summary');
  if (touch) await activate(developerSummary);
  else { await developerSummary.focus(); await page.keyboard.press('Enter'); }
  const diagnostics = developer.locator('details').filter({ has: page.locator('summary').getByText('Diagnostics', { exact: true }) });
  await activate(diagnostics.locator(':scope > summary'));
  const recording = diagnostics.getByLabel('Record local diagnostics', { exact: true });
  await expect(recording).toBeChecked();
  await activate(recording);
  await expect(recording).not.toBeChecked();
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(diagnostics.getByRole('button', { name: 'Download log', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await activate(developer.locator('summary').getByText('Unencrypted test mode', { exact: true }));
  await expect(developer.getByRole('button', { name: 'Disable encryption (test)', exact: true })).toBeDisabled();
  await activate(developer.locator('summary').getByText('Accelerated day', { exact: true }));
  await expect(developer.getByLabel('Enable accelerated test clock', { exact: true })).not.toBeChecked();
  await activate(developer.locator('summary').getByText('Live Text diagnostics', { exact: true }));
  await expect(developer.getByRole('button', { name: 'Скачать логи JSON', exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await activate(developer.getByRole('button', { name: 'Скачать логи JSON', exact: true }));
  expect((await download).suggestedFilename()).toBe('utm-live-text-reports.json');
  await activate(developerSummary);
  await expect(developer).not.toHaveAttribute('open', '');
  // Chromium can retain descendant layout boxes inside closed nested details.
  // The native visibility check accounts for the closed content container.
  await expect.poll(() => recording.evaluate(element => element.checkVisibility())).toBe(false);
});
