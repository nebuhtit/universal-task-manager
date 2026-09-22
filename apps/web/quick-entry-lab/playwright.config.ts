import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: '*.pw.ts', outputDir: '/tmp/utm-quick-entry-results',
  fullyParallel: true, workers: 2,
  use: { baseURL: 'http://127.0.0.1:4187', timezoneId: 'Europe/Moscow', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
});
