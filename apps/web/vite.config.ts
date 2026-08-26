import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';

const localCommit = (() => {
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return 'local'; }
})();

const base = process.env.VITE_GITHUB_PAGES === 'true' ? '/universal-task-manager/' : '/';

export default defineConfig({
  base,
  define: {
    // GitHub supplies its exact SHA; local development reads the checked-out commit.
    'import.meta.env.VITE_COMMIT_SHA': JSON.stringify(process.env.VITE_COMMIT_SHA || localCommit),
  },
  // Automerge's webpack export embeds its WASM as base64, which works in Vite
  // without relying on the still-experimental ESM/WASM integration proposal.
  resolve: { conditions: ['webpack'] },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['icon.svg'],
      manifest: {
        id: base,
        name: 'Universal Task Manager',
        short_name: 'Universal',
        description: 'A local-first programmable task, event and habit system.',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: base,
        icons: [{ src: `${base}icon.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      injectManifest: {
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
});
