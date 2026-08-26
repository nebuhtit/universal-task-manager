import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ResponsiveDialog } from './ResponsiveDialog';

describe('ResponsiveDialog contract', () => {
  it('exposes one controlled dialog/sheet component', () => {
    expect(ResponsiveDialog).toBeTypeOf('function');
  });

  it('styles portal layers and responsive sheet presentation with tokens', () => {
    const cssPath = fileURLToPath(new URL('./responsive-dialog.css', import.meta.url));
    const css = readFileSync(cssPath, 'utf8');
    expect(css).toContain('z-index: var(--z-overlay)');
    expect(css).toContain('background: var(--color-overlay)');
    expect(css).toContain('@media (max-width: 620px)');
    expect(css).toContain('max-height: 100dvh');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});
