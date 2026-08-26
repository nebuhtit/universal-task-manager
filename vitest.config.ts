import { defineConfig } from 'vitest/config';

/** Unit tests use Vitest; browser scenarios live exclusively in Playwright. */
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**'],
  },
});
