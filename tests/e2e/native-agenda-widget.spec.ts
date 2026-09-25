import { expect, test } from '@playwright/test';

test('widget requires opt-in, sends only agenda projection and can clear it', async ({ page, isMobile }) => {
  await page.addInitScript(() => {
    let enabled = false;
    Object.assign(window, { widgetPayload: null, webkit: { messageHandlers: { utmNativeAgenda: { async postMessage(message: { kind: string; payload?: unknown }) {
      if (message.kind === 'enable') enabled = true;
      if (message.kind === 'disable') { enabled = false; Object.assign(window, { widgetPayload: null }); }
      if (message.kind === 'sync' && enabled) Object.assign(window, { widgetPayload: message.payload });
      return { enabled };
    } } } } });
  });
  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill('synthetic-widget-password');
  await page.getByLabel('Confirm password').fill('synthetic-widget-password');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  if (isMobile) {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.locator('.mobile-nav-menu').getByRole('button', { name: 'Settings', exact: true }).click();
  } else await page.locator('.sidebar').getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByText('Lock Screen widget', { exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).widgetPayload)).toBeNull();
  await page.getByRole('button', { name: 'Enable widget' }).click();
  await expect.poll(() => page.evaluate(() => Boolean((window as any).widgetPayload?.entries?.length))).toBe(true);
  const payload = await page.evaluate(() => (window as any).widgetPayload);
  expect(Object.keys(payload).sort()).toEqual(['entries', 'expires', 'refreshLabel']);
  await page.getByRole('button', { name: 'Disable and clear' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).widgetPayload)).toBeNull();
});
