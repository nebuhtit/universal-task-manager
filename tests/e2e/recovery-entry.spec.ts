import { expect, test } from '@playwright/test';

test('native recovery URL stays on safe entry and opens read-only without automatic biometrics', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { webkit: { messageHandlers: { utmNativeBiometrics: { async postMessage(message: { kind: string }) {
      if (message.kind === 'status') return { available: true };
      sessionStorage.setItem('unexpected-biometric-request', message.kind);
      throw new Error('Not enrolled');
    } } } } });
  });
  await page.goto('/');
  const password = 'synthetic-recovery-password';
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await expect(page.getByPlaceholder('Add new item')).toBeVisible();
  await page.goto('/?utm-recovery=1');
  await expect(page.getByRole('checkbox', { name: /Безопасное открытие/ })).toBeChecked();
  await expect(page.getByRole('heading', { name: 'Unlock your workspace' })).toBeVisible();
  await page.waitForTimeout(750);
  expect(await page.evaluate(() => sessionStorage.getItem('unexpected-biometric-request'))).toBeNull();
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByText('SAFE RECOVERY MODE', { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('Add new item')).toHaveCount(0);
});
