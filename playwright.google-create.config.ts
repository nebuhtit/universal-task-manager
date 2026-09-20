import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Run against an isolated dev server with VITE_GOOGLE_CLIENT_ID=test-client.
export default defineConfig({ ...base, webServer: undefined, testIgnore: [], testMatch: 'google-create.spec.ts', use: { ...base.use, baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4189' } });
