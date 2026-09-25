import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// One transparent master; deterministic web sizes and opaque Apple exports.
const root = new URL('../', import.meta.url);
const destination = new URL('ios/UniversalTaskManager/Assets.xcassets/AppIcon.appiconset/', root);
await mkdir(destination, { recursive: true });
const source = await readFile(new URL('assets/branding/clock-glass-source.png', root));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
  // User-approved deterministic mask: retain the glass dial only, replacing
  // the moulded casing and exterior residue with a perfectly flat white body.
  const master = await page.evaluate(async data => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1024;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.beginPath();
    context.roundRect(0, 0, 1024, 1024, 220);
    context.fill();
    context.save();
    context.beginPath();
    context.arc(512, 512, 405, 0, Math.PI * 2);
    context.clip();
    // The source dial occupies x=140..1111, y=132..1103 on its
    // 1254-square image. Preserve its glass surface inside the circular mask.
    context.drawImage(image, 140 / 1254 * image.width, 132 / 1254 * image.height,
      972 / 1254 * image.width, 972 / 1254 * image.height, 107, 107, 810, 810);
    context.restore();
    const pixels = context.getImageData(0, 0, 1024, 1024).data;
    const pixel = (x, y) => Array.from(pixels.slice((y * 1024 + x) * 4, (y * 1024 + x) * 4 + 4));
    if (pixel(0, 0)[3] !== 0 || pixel(512, 30).join() !== '255,255,255,255') {
      throw new Error('Icon mask must have transparent corners and a flat white casing');
    }
    return canvas.toDataURL('image/png').split(',')[1];
  }, source.toString('base64'));
  await writeFile(new URL('assets/branding/clock-cutout.png', root), Buffer.from(master, 'base64'));
  const exports = [
    ['apps/web/public/icon-192.png', 192, false, 1],
    ['apps/web/public/icon-512.png', 512, false, 1],
    ['apps/web/public/favicon.png', 32, false, 1],
    ['apps/web/public/apple-touch-icon.png', 180, true, 1],
    ['apps/web/public/icon-maskable.png', 512, true, 0.8],
    ['ios/UniversalTaskManager/Assets.xcassets/AppIcon.appiconset/AppIcon.png', 1024, true, 1],
  ];
  for (const [path, size, opaque, scale] of exports) {
    const encoded = await page.evaluate(async ({ data, size, opaque, scale }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const context = canvas.getContext('2d', { alpha: !opaque });
      if (opaque) { context.fillStyle = '#ffffff'; context.fillRect(0, 0, size, size); }
      const ratio = size * scale / Math.max(image.width, image.height);
      const width = image.width * ratio, height = image.height * ratio;
      context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
      return canvas.toDataURL('image/png').split(',')[1];
    }, { data: master, size, opaque, scale });
    const outputPath = fileURLToPath(new URL(path, root));
    if (opaque) {
      // Chromium canvas PNGs retain an alpha channel even when all pixels are
      // opaque. A normal page screenshot exports RGB for Apple's app catalog.
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(`<style>html,body{margin:0;background:white}img{display:block}</style><img width="${size}" height="${size}" src="data:image/png;base64,${encoded}">`);
      await page.locator('img').evaluate(image => image.decode());
      await page.screenshot({ path: outputPath, omitBackground: false });
    } else {
      await writeFile(outputPath, Buffer.from(encoded, 'base64'));
    }
  }
} finally { await browser.close(); }
