import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Reproducible platform exports with the user-approved rounded mask.
// Apple's catalog stays opaque; iOS applies its own corner mask.
const root = new URL('../', import.meta.url);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const theme of ['light', 'dark']) {
    const source = await readFile(new URL(`assets/branding/clock-${theme}-source.png`, root));
    const suffix = theme === 'dark' ? '-dark' : '';
    const background = theme === 'dark' ? '#141414' : '#ffffff';
    const exports = [
      [`assets/branding/clock-cutout${suffix}.png`, 1024, false, 1],
      [`apps/web/public/icon-192${suffix}.png`, 192, false, 1],
      [`apps/web/public/icon-512${suffix}.png`, 512, false, 1],
      [`apps/web/public/favicon${suffix}.png`, 32, false, 1],
      [`apps/web/public/apple-touch-icon${suffix}.png`, 180, true, 1],
      [`apps/web/public/icon-maskable${suffix}.png`, 512, true, 0.8],
      [`ios/UniversalTaskManager/Assets.xcassets/AppIcon.appiconset/AppIcon${theme === 'dark' ? 'Dark' : ''}.png`, 1024, true, 1],
    ];
    for (const [path, size, opaque, scale] of exports) {
      const encoded = await page.evaluate(async ({ data, size, opaque, scale, background }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        // Color-range background mask removes the generator's near-neutral
        // paper grain without altering the colored glass hands or gray ticks.
        const flat = document.createElement('canvas');
        flat.width = image.width; flat.height = image.height;
        const flatContext = flat.getContext('2d');
        flatContext.drawImage(image, 0, 0);
        const pixels = flatContext.getImageData(0, 0, flat.width, flat.height);
        const dark = background !== '#ffffff';
        for (let i = 0; i < pixels.data.length; i += 4) {
          const low = Math.min(...pixels.data.subarray(i, i + 3));
          const high = Math.max(...pixels.data.subarray(i, i + 3));
          if (high - low <= 10 && (dark ? high <= 40 : low >= 235)) {
            pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = dark ? 20 : 255;
            pixels.data[i + 3] = 255;
          }
        }
        flatContext.putImageData(pixels, 0, 0);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const context = canvas.getContext('2d');
        if (opaque) { context.fillStyle = background; context.fillRect(0, 0, size, size); }
        const edge = size * scale, offset = (size - edge) / 2;
        if (!opaque) {
          context.beginPath(); context.roundRect(offset, offset, edge, edge, edge * 220 / 1024); context.clip();
        }
        context.drawImage(flat, offset, offset, edge, edge);
        return canvas.toDataURL('image/png').split(',')[1];
      }, { data: source.toString('base64'), size, opaque, scale, background });
      const outputPath = fileURLToPath(new URL(path, root));
      if (opaque) {
        await page.setViewportSize({ width: size, height: size });
        await page.setContent(`<style>html,body{margin:0;background:${background}}img{display:block}</style><img width="${size}" height="${size}" src="data:image/png;base64,${encoded}">`);
        await page.locator('img').evaluate(image => image.decode());
        await page.screenshot({ path: outputPath, omitBackground: false });
      } else await writeFile(outputPath, Buffer.from(encoded, 'base64'));
    }
  }
} finally { await browser.close(); }
