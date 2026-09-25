import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execFileSync } from 'node:child_process';

const readLocalCommit = () => {
  try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return 'local'; }
};
const hasLocalChanges = () => {
  try { return execFileSync('git', ['status', '--porcelain'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().length > 0; }
  catch { return false; }
};
const localCommit = readLocalCommit();
const isObsidianBuild = process.env.VITE_OBSIDIAN === 'true';
const isNativeBuild = process.env.VITE_NATIVE_IOS === 'true';

const liveBuildInfo: Plugin = {
  name: 'utm-live-build-info',
  configureServer(server) {
    server.middlewares.use('/__utm-build-info', (_request, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Cache-Control', 'no-store');
      response.end(JSON.stringify({ commit: readLocalCommit(), dirty: hasLocalChanges() }));
    });
  },
};

const base = process.env.VITE_GITHUB_PAGES === 'true'
  ? '/universal-task-manager/'
  : isObsidianBuild
    ? './'
    : '/';

export default defineConfig({
  base,
  // Native packaging must not overwrite the website's service worker output.
  build: { outDir: isNativeBuild ? 'dist-native' : 'dist' },
  // The separate lab build must not trigger full reloads of the main app.
  server: { watch: { ignored: ['**/quick-entry-lab/dist/**'] } },
  define: {
    // GitHub supplies its exact SHA; local development reads the checked-out commit.
    'import.meta.env.VITE_COMMIT_SHA': JSON.stringify(process.env.VITE_COMMIT_SHA || localCommit),
  },
  // Keep Automerge's JavaScript slim and load its WASM as one cacheable asset.
  // The webpack condition remains for packages that expose browser-safe entries.
  resolve: {
    alias: [{ find: /^@automerge\/automerge$/, replacement: '@automerge/automerge/slim' }],
    conditions: ['webpack'],
    // Workspace symlinks can otherwise let the dev server optimize React from
    // more than one path. A remote Safari client then sees an Invalid Hook Call
    // after HMR even though production has one React runtime.
    dedupe: ['react', 'react-dom'],
  },
  plugins: [
    liveBuildInfo,
    react(),
    VitePWA({
      disable: isObsidianBuild || isNativeBuild,
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        id: base,
        name: 'Universal Task Manager',
        short_name: 'Universal',
        description: 'A local-first programmable task, event and habit system.',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: base,
        icons: [
          { src: `${base}icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: `${base}icon-maskable.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // Excel is optional and comparatively large. Its dynamic chunk should
        // be fetched only when the user actually imports or exports .xlsx.
        globIgnores: ['**/xlsx-*.js'],
      },
    }),
  ],
});
