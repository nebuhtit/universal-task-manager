// Targeted, repeatable smoke check. Uses an isolated browser and a disposable
// passwordless workspace; never connects to Google or opens user backups.
import { chromium, expect } from '@playwright/test';

const baseURL = process.argv[2] ?? 'http://127.0.0.1:43829';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: mobile, hasTouch: mobile, colorScheme: mobile ? 'dark' : 'light' });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(baseURL);
    await page.getByLabel('Workspace name').fill('Filter smoke');
    await page.getByLabel('Create a local test workspace without password or encryption').check();
    await page.getByRole('button', { name: /Create.*workspace/ }).click();
    await page.getByRole('button', { name: 'Edit Today', exact: true }).click();
    const dialog = page.getByRole('dialog');
    // Disclosure state is inspected rather than toggled blindly.
    const summary = dialog.locator('summary').filter({ hasText: 'Visual setup' });
    if (!await summary.evaluate((element) => element.parentElement.open)) await summary.click();
    await dialog.getByRole('button', { name: 'Code (Python-like)', exact: true }).click();
    const program = '# Keep completed in the same Schedule period\nif not scheduleInPeriod("today", "due", False, 7, "", ""):\n    return False\nif state == "done":\n    return True\nelif state == "open":\n    return any(regexMatch(entry, "^work", True) for entry in tags)\nelse:\n    return False';
    await dialog.getByLabel('Filter code', { exact: true }).fill(program);
    await expect(dialog.locator('.filter-program [role="alert"]')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Blocks', exact: true }).click();
    await expect(dialog.locator('.filter-block strong').filter({ hasText: /^IF$/ }).first()).toBeVisible();
    await dialog.getByRole('button', { name: 'Code (Python-like)', exact: true }).click();
    await expect(dialog.getByLabel('Filter code', { exact: true })).toHaveValue(program);
    await dialog.getByRole('button', { name: 'Save view', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit Today', exact: true }).click();
    const again = page.getByRole('dialog');
    const againSummary = again.locator('summary').filter({ hasText: 'Visual setup' });
    if (!await againSummary.evaluate((element) => element.parentElement.open)) await againSummary.click();
    await again.getByRole('button', { name: 'Code (Python-like)', exact: true }).click();
    await expect(again.getByLabel('Filter code', { exact: true })).toHaveValue(program);
    await again.getByLabel('Filter code', { exact: true }).fill('return regexMatch(title, "[", True)');
    await expect(again.locator('.filter-program [role="alert"]')).toBeVisible();
    await expect(again.getByRole('button', { name: 'Save view', exact: true })).toBeDisabled();
    await expect(again).toBeVisible();
    await again.getByLabel('Filter code', { exact: true }).fill(program);
    await again.getByRole('button', { name: 'Blocks', exact: true }).click();
    const overflow = await again.evaluate((element) => element.scrollWidth > element.clientWidth + 1);
    expect(overflow).toBe(false);
    await page.screenshot({ path: `/tmp/utm-filter-${mobile ? 'mobile-dark' : 'desktop-light'}.png` });
    await page.keyboard.press('Escape');
    await expect(again).toHaveCount(0);
    // Touch activation does not give the trigger keyboard focus.
    if (!mobile) await expect(page.getByRole('button', { name: 'Edit Today', exact: true })).toBeFocused();
    if (mobile) { await page.getByRole('button', { name: 'Open navigation' }).click(); await page.locator('.mobile-nav-menu').getByRole('button', { name: 'Calendar', exact: true }).click(); }
    else await page.locator('.sidebar').getByRole('button', { name: 'Calendar', exact: true }).click();
    await page.getByRole('button', { name: 'Edit calendar day view' }).click();
    const calendar = page.getByRole('dialog', { name: 'Edit calendar day view' });
    const filterSummary = calendar.locator('summary').filter({ hasText: 'Filter items' });
    if (!await filterSummary.evaluate((element) => element.parentElement.open)) await filterSummary.click();
    await calendar.getByRole('button', { name: 'Code (Python-like)', exact: true }).click();
    await calendar.getByLabel('Filter code', { exact: true }).fill('# Calendar\nreturn not googleCalendarAllDay');
    await calendar.getByRole('button', { name: 'Save view', exact: true }).click();
    await expect(calendar).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Edit Today', exact: true })).toBeVisible();
    if (mobile) { await page.getByRole('button', { name: 'Open navigation' }).click(); await page.locator('.mobile-nav-menu').getByRole('button', { name: 'Calendar', exact: true }).click(); }
    else await page.locator('.sidebar').getByRole('button', { name: 'Calendar', exact: true }).click();
    await page.getByRole('button', { name: 'Edit calendar day view' }).click();
    const restored = page.getByRole('dialog');
    const restoredSummary = restored.locator('summary').filter({ hasText: 'Filter items' });
    if (!await restoredSummary.evaluate((element) => element.parentElement.open)) await restoredSummary.click();
    await restored.getByRole('button', { name: 'Code (Python-like)', exact: true }).click();
    await expect(restored.getByLabel('Filter code', { exact: true })).toHaveValue('# Calendar\nreturn not googleCalendarAllDay');
    expect(errors).toEqual([]);
    console.log(`${mobile ? 'mobile dark' : 'desktop light'}: code, blocks, comments, validation, save/reopen, calendar, reload passed`);
    await context.close();
  }
} finally { await browser.close(); }
