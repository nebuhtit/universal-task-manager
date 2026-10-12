import { defineConfig, devices } from '@playwright/test';
import baseConfig from './playwright.config';

// A bounded touch/WebKit regression run; reuse the normal build/server setup.
export default defineConfig({
  ...baseConfig,
  testDir: './tests/e2e', testMatch: 'menu-dismiss.spec.ts', workers: 1,
  use: { ...baseConfig.use, screenshot: 'only-on-failure' },
  projects: [
    { name: 'webkit-touch', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
    { name: 'chromium-touch', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
});
