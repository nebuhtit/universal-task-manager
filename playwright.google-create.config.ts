import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4189);
// Mocked OAuth/API only; never reuse a running personal workspace server.
export default defineConfig({
  ...base,
  // Encrypted workspace activation and WebKit compete heavily for local memory.
  workers: 1,
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: `pnpm --filter @utm/web dev --host 127.0.0.1 --port ${port} --strictPort`,
    port, reuseExistingServer: false,
    env: { VITE_GOOGLE_CLIENT_ID: 'test-client' },
  },
  testIgnore: [], testMatch: 'google-create.spec.ts',
  use: { ...base.use, actionTimeout: 15_000, baseURL: process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}` },
});
