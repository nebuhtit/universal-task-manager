import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const base = process.env.VITE_GITHUB_PAGES === 'true' ? '/universal-task-manager/' : '/';

export default defineConfig({
  base,
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
