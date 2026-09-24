import { expect, test } from '@playwright/test';

test('native diagnostics export keeps the app open and uses Files', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('utm:diagnostics:v1', JSON.stringify([{ at: new Date().toISOString(), kind: 'result', message: 'Synthetic export test' }]));
    const messages: Array<Record<string, unknown>> = [];
    Object.assign(window, {
      __nativeExportMessages: messages,
      webkit: { messageHandlers: { utmNativeBackup: { postMessage(message: Record<string, unknown>) {
        messages.push(message);
        if (message.kind === 'backup.end') setTimeout(() => window.dispatchEvent(new CustomEvent('utm-native-backup-status', { detail: { id: message.id, ok: true } })), 0);
      } } } },
    });
  });
  await page.goto('/');
  const url = page.url();
  await page.getByText('Help', { exact: true }).click();
  await page.getByRole('button', { name: 'Download log', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __nativeExportMessages: Array<Record<string, unknown>> }).__nativeExportMessages.some(message => message.kind === 'backup.end'))).toBe(true);
  const first = await page.evaluate(() => (window as unknown as { __nativeExportMessages: Array<Record<string, unknown>> }).__nativeExportMessages[0]);
  expect(first).toMatchObject({ kind: 'backup.begin', destination: 'files', fileName: 'utm-diagnostics.json' });
  expect(page.url()).toBe(url);
  await expect(page.getByRole('button', { name: 'Download log', exact: true })).toBeVisible();
});
