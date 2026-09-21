import { chromium, devices, expect } from '@playwright/test';

// An isolated, temporary browser context: never opens or changes a user's workspace.
const [url, version, commit] = process.argv.slice(2);
if (!url || !/^\d+\.\d+\.\d+$/.test(version ?? '') || !/^[a-f0-9]{7,40}$/.test(commit ?? '')) throw new Error('Usage: node scripts/check-release-ui.mjs URL VERSION COMMIT');
const browser = await chromium.launch();
try {
  for (const [name, options] of [['desktop', { viewport: { width: 1280, height: 900 } }], ['mobile', devices['iPhone 13']]]) {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    await page.goto(url);
    await expect(page.locator('.lock-version')).toHaveText(`v${version} · commit ${commit.slice(0, 7)}`, { timeout: 30000 });
    await page.getByLabel('Workspace name').fill('Isolated release check');
    await page.getByLabel('Password', { exact: true }).fill('temporary-release-check-password');
    await page.getByLabel('Confirm password').fill('temporary-release-check-password');
    await page.getByRole('button', { name: 'Create encrypted workspace' }).click();
    await page.getByPlaceholder('Add new item').fill('Release program check');
    await page.getByPlaceholder('Add new item').press('Enter');
    const editor = page.getByRole('dialog', { name: 'Item editor', exact: true });
    const program = editor.locator('.event-program');
    if (await editor.locator('[data-editor-section="dates"]').getAttribute('open') === null) await editor.locator('[data-editor-section="dates"] > summary').click();
    await program.locator(':scope > summary').click();
    await program.getByRole('button', { name: 'Add block', exact: true }).click();
    await program.getByLabel('Block title 1', { exact: true }).fill('Release block');
    await editor.getByRole('button', { name: 'Save item', exact: true }).click();
    await expect(editor).toBeHidden();
    await page.getByText('Release program check', { exact: true }).first().click();
    await expect(editor.locator('.item-script-row')).toHaveCount(1);
    if (await editor.locator('[data-editor-section="dates"]').getAttribute('open') === null) await editor.locator('[data-editor-section="dates"] > summary').click();
    if (await program.getAttribute('open') === null) await program.locator(':scope > summary').click();
    await expect(program.getByLabel('Block title 1', { exact: true })).toHaveValue('Release block');
    await context.close();
    console.log(`${name}: version ${version}, commit ${commit.slice(0, 7)}, program save/reopen and managed script verified`);
  }
} finally { await browser.close(); }
