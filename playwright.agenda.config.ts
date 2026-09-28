import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', testMatch: 'agenda-worker.spec.ts', workers: 1,
  use: { ...devices['iPhone 13'], browserName: 'webkit', baseURL: 'http://127.0.0.1:4198', trace: 'off', screenshot: 'off', video: 'off' },
  webServer: { command: 'pnpm --filter @utm/web dev --host 127.0.0.1 --port 4198 --strictPort', port: 4198, reuseExistingServer: false },
});
