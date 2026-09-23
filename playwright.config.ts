import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: 'google-create.spec.ts',
  fullyParallel: true,
  workers: 2,
  use: { baseURL, trace: 'on-first-retry' },
  webServer: {
    command: `pnpm --filter @utm/core build && pnpm --filter @utm/sdk build && pnpm --filter @utm/web build && pnpm --filter @utm/web preview --host 127.0.0.1 --port ${port}`,
    port,
    reuseExistingServer: true,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'] } },
  ],
});
