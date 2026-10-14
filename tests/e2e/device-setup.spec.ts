import { expect, test, type Locator } from '@playwright/test';

async function activateControl(control: Locator, touch: boolean) {
  if (touch) await control.tap(); else await control.click();
}

for (const enableBiometrics of [false, true]) test(`device setup choices persist: biometrics ${enableBiometrics ? 'enabled' : 'declined'}`, async ({ page, isMobile }) => {
  await page.addInitScript(() => {
    Object.assign(window, { webkit: { messageHandlers: {
      utmNativeBiometrics: { async postMessage(message: { kind: string; id?: string }) {
        if (message.kind === 'status') return { available: true };
        if (message.kind === 'create') {
          const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
          sessionStorage.setItem(`test-biometric:${message.id}`, key); return { key };
        }
        if (message.kind === 'read') {
          sessionStorage.setItem('test-biometric-reads', String(Number(sessionStorage.getItem('test-biometric-reads') ?? 0) + 1));
          return { key: sessionStorage.getItem(`test-biometric:${message.id}`) };
        }
        return {};
      } },
      utmNativeReminders: { postMessage(message: { id: string; kind: string }) {
        if (message.kind === 'reminders.requestPermission') {
          sessionStorage.setItem('test-permission-requests', String(Number(sessionStorage.getItem('test-permission-requests') ?? 0) + 1));
          sessionStorage.setItem('test-permission', 'granted');
        }
        queueMicrotask(() => window.dispatchEvent(new CustomEvent('utm-native-reminders-status', { detail: { id: message.id, ok: true, authorization: sessionStorage.getItem('test-permission') ?? 'notDetermined', scheduled: 0 } })));
      } },
    } } });
  });
  const password = 'device-setup-test-password';
  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await activateControl(page.getByRole('button', { name: 'Create encrypted workspace' }), isMobile);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('utm:device-setup:v1'))).toContain('notifications');
  await expect(page.locator('.notice-popups .notice-card')).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('test-permission-requests'))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem('test-biometric-reads'))).toBeNull();
  await activateControl(page.getByRole('button', { name: 'Notifications', exact: true }), isMobile);
  const center = page.getByRole('complementary', { name: 'Notification center' });
  await activateControl(center.getByRole('button', { name: /Enable Face ID \/ Touch ID\?/ }), isMobile);
  let dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await activateControl(page.getByRole('button', { name: 'Notifications', exact: true }), isMobile);
  await activateControl(center.getByRole('button', { name: /Enable Face ID \/ Touch ID\?/ }), isMobile);
  await activateControl(dialog.getByRole('button', { name: enableBiometrics ? 'Enable' : 'Decline', exact: true }), isMobile);
  await expect(dialog).toHaveCount(0);
  await activateControl(page.getByRole('button', { name: 'Notifications', exact: true }), isMobile);
  await activateControl(center.getByRole('button', { name: /Enable local notifications\?/ }), isMobile);
  dialog = page.getByRole('dialog');
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await expect(dialog).toBeVisible();
  await activateControl(dialog.getByRole('button', { name: enableBiometrics ? 'Decline' : 'Enable', exact: true }), isMobile);
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('test-permission-requests'))).toBe(enableBiometrics ? null : '1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  if (!enableBiometrics) {
    await page.getByLabel('Password', { exact: true }).fill(password);
    await activateControl(page.getByRole('button', { name: 'Unlock', exact: true }), isMobile);
  }
  await expect(page.getByPlaceholder('Add new item')).toBeVisible();
  await activateControl(page.getByRole('button', { name: 'Notifications', exact: true }), isMobile);
  await expect(center.getByRole('button', { name: /Enable (Face ID|local notifications)/ })).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('test-permission-requests'))).toBe(enableBiometrics ? null : '1');
});
