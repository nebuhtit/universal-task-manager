import { expect, test } from '@playwright/test';

for (const colorScheme of ['light', 'dark'] as const) {
  test(`mobile menu dismiss has no full-screen tap highlight (${colorScheme})`, async ({ page }) => {
    test.skip(!test.info().project.use.hasTouch, 'touchscreen contract');
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    await page.getByLabel('Workspace name').fill('Menu dismissal');
    await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
    await page.getByLabel('Confirm password').fill('correct horse battery staple');
    await page.getByRole('button', { name: 'Create encrypted workspace' }).click();

    const toggle = page.locator('.mobile-menu-button');
    const menu = page.locator('.mobile-nav-menu');
    const scrim = page.locator('.mobile-nav-scrim');
    await toggle.tap();
    await expect(menu).toHaveCSS('opacity', '1');
    await expect(menu).toHaveCSS('backdrop-filter', /blur\(/);
    // A transparent full-viewport button must not receive Safari's default
    // 40%-black touch highlight, which looks like the entire screen blinking.
    await expect(scrim).toHaveCSS('-webkit-tap-highlight-color', 'rgba(0, 0, 0, 0)');

    const content = await page.locator('main.content').elementHandle();
    expect(content).not.toBeNull();
    const clip = { x: 0, y: 300, width: 100, height: 100 };
    const background = await page.screenshot({ clip, scale: 'css' });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      // Capture the underlying page during dismissal, not just the final state.
      const [, frames] = await Promise.all([
        page.touchscreen.tap(10, 450),
        (async () => {
          const frames: Buffer[] = [];
          for (let frame = 0; frame < 3; frame += 1) {
            frames.push(await page.screenshot({ clip, scale: 'css' }));
          }
          return frames;
        })(),
      ]);
      for (const frame of frames) expect(frame.equals(background)).toBe(true);
      await expect(menu).toHaveAttribute('aria-hidden', 'true');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(await content!.evaluate(el => el.isConnected)).toBe(true);
      await toggle.tap();
      await expect(menu).toHaveCSS('opacity', '1');
    }
    // Closing with the toggle must also leave the page in place.
    const toggleBox = await toggle.boundingBox();
    expect(toggleBox).not.toBeNull();
    await page.touchscreen.tap(toggleBox!.x + toggleBox!.width / 2, toggleBox!.y + toggleBox!.height / 2);
    await expect(menu).toHaveCSS('opacity', '0');
    await expect(scrim).toHaveCSS('pointer-events', 'none');
  });
}
