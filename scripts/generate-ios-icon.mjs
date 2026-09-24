import { chromium } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Reuse the existing UTM vector mark, rendered opaque for Apple's app icon.
const root = new URL('../', import.meta.url);
const destination = new URL('ios/UniversalTaskManager/Assets.xcassets/AppIcon.appiconset/', root);
await mkdir(destination, { recursive: true });
const svg = await readFile(new URL('apps/web/public/icon.svg', root), 'utf8');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;background:#0d0d0d}svg{display:block;width:1024px;height:1024px}</style>${svg}`);
  await page.screenshot({ path: fileURLToPath(new URL('AppIcon.png', destination)) });
} finally { await browser.close(); }
