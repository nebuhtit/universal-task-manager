import { expect, test } from '@playwright/test';

test('two-row header keeps its height, truncates titles and updates countdown', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-23T12:00:00Z') });
  await page.goto('/');
  await page.getByLabel('Workspace name').fill('Header');
  await page.getByLabel('Password', { exact: true }).fill('header-test-password');
  await page.getByLabel('Confirm password').fill('header-test-password');
  await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
  const bar = page.locator('.topbar');
  await expect(bar).toBeVisible();
  const title = 'A very long upcoming meeting title that must be truncated without hiding the countdown';
  const capture = page.getByPlaceholder('Add new item');
  await capture.fill(`${title} tomorrow 15:00`); await capture.press('Enter');
  await page.getByRole('button', { name: 'Save item', exact: true }).click();
  const agenda = page.locator('.header-agenda');
  await expect(agenda).toContainText(title);
  await capture.fill('Current long meeting name for checking the compact header today 00:00 23h'); await capture.press('Enter');
  await page.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(agenda).not.toContainText('Now:');
  await expect(agenda).toContainText('Current long meeting name');
  // Simulate the optional Google sync control to exercise the widest action group.
  await page.locator('.top-actions').evaluate(el => { const button = el.querySelector('button')!.cloneNode(true) as HTMLElement; button.setAttribute('aria-label', 'Extra sync control'); el.append(button); });
  const first = await agenda.innerText();
  await page.clock.fastForward(3600000);
  await expect(agenda).not.toHaveText(first);
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      const geometry = await bar.evaluate(el => {
        const bar = el.getBoundingClientRect();
        const agenda = el.querySelector('.header-agenda')!.getBoundingClientRect();
        const actions = el.querySelector('.top-actions')!.getBoundingClientRect();
        const clock = el.querySelector('.responsive-clock')!.getBoundingClientRect();
        return { height: bar.height, width: bar.width, agendaRight: agenda.right, barRight: bar.right, agendaTop: agenda.top, actionsBottom: actions.bottom, clockRight: clock.right, actionsLeft: actions.left, overflow: el.scrollWidth > el.clientWidth };
      });
      expect(geometry.height).toBe(width <= 620 ? 56 : 60);
      expect(geometry.overflow).toBe(false);
      expect(geometry.agendaRight).toBeLessThanOrEqual(geometry.barRight);
      expect(geometry.agendaTop).toBeGreaterThanOrEqual(geometry.actionsBottom);
      expect(geometry.clockRight).toBeLessThanOrEqual(geometry.actionsLeft);
      const textFits = await agenda.evaluate(el => [...el.querySelectorAll('.header-agenda-part > span:not(.header-agenda-title)')].every(span => span.getBoundingClientRect().right <= el.getBoundingClientRect().right));
      expect(textFits).toBe(true);
      if (width === 390 && colorScheme === 'light') await page.screenshot({ path: '/tmp/utm-header-mobile.png' });
    }
  }
  const notifications = page.getByRole('button', { name: 'Notifications', exact: true });
  await notifications.focus(); await expect(notifications).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('complementary', { name: 'Notification center' })).toBeVisible();
});
