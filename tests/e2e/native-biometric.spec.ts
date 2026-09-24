import { expect, test } from '@playwright/test';

// Exercises encrypted persistence and fallback; does not simulate Keychain security.
test('native Face ID enrollment, reopen, cancellation, password fallback and disable', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Desktop bridge/persistence contract; actual Face ID needs a physical iPhone.');
  await page.addInitScript(() => {
    Object.assign(window, { webkit: { messageHandlers: { utmNativeBiometrics: { async postMessage(message: { kind: string; id?: string }) {
      const prefix = 'synthetic-native-key:';
      if (message.kind === 'status') return { available: true };
      if (message.kind === 'create') {
        const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
        sessionStorage.setItem(prefix + message.id, key);
        return { key };
      }
      if (message.kind === 'read') {
        if (sessionStorage.getItem('synthetic-cancel')) throw new Error('cancelled');
        return { key: sessionStorage.getItem(prefix + message.id) };
      }
      for (const key of Object.keys(sessionStorage)) if (key.startsWith(prefix) && (!message.id || key === prefix + message.id)) sessionStorage.removeItem(key);
      return {};
    } } } } });
  });
  await page.goto('/');
  const password = 'synthetic-biometric-test-password';
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  await page.locator('.sidebar').getByRole('button', { name: 'Settings' }).click();
  await page.getByText('Device unlock', { exact: true }).click();
  await page.getByRole('button', { name: 'Enable Face ID', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Disable Face ID', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.sidebar').getByRole('button', { name: 'Settings' })).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem('synthetic-cancel', '1'));
  await page.reload();
  await expect(page.getByText('Face ID was unavailable, cancelled, or could not unlock this workspace. Enter your password below instead.')).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.locator('.sidebar').getByRole('button', { name: 'Settings' }).click();
  const disclosure = page.locator('details').filter({ has: page.getByText('Device unlock', { exact: true }) }).last();
  if (!await disclosure.getAttribute('open').then(value => value !== null)) await page.getByText('Device unlock', { exact: true }).click();
  await page.getByRole('button', { name: 'Disable Face ID', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Enable Face ID', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unlock with Face ID' })).toHaveCount(0);
});
