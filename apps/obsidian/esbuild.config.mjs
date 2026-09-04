import esbuild from 'esbuild';
import builtins from 'builtin-modules';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const pluginRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(pluginRoot, '../..');
const outputRoot = resolve(pluginRoot, 'dist');
const production = process.argv[2] === 'production';

execFileSync('pnpm', ['--filter', '@utm/web', 'build'], {
  cwd: repositoryRoot,
  env: { ...process.env, VITE_OBSIDIAN: 'true' },
  stdio: 'inherit',
});

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

await esbuild.build({
  entryPoints: [resolve(pluginRoot, 'main.ts')],
  bundle: true,
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*', ...builtins],
  format: 'cjs',
  platform: 'browser',
  target: 'es2018',
  outfile: resolve(outputRoot, 'main.js'),
  sourcemap: production ? false : 'inline',
  minify: production,
  logLevel: 'info',
});

await Promise.all([
  cp(resolve(pluginRoot, 'manifest.json'), resolve(outputRoot, 'manifest.json')),
  cp(resolve(pluginRoot, 'styles.css'), resolve(outputRoot, 'styles.css')),
  cp(resolve(repositoryRoot, 'apps/web/dist'), resolve(outputRoot, 'web'), { recursive: true }),
]);

console.log(`Built Obsidian plugin at ${outputRoot}`);
