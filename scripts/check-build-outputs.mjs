import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const exists = (path) => access(resolve(root, path)).then(() => true, () => false);
const web = await readFile(resolve(root, 'apps/web/dist/index.html'), 'utf8');
const plugin = await readFile(resolve(root, 'apps/obsidian/dist/web/index.html'), 'utf8');
if (!await exists('apps/web/dist/sw.js') || !await exists('apps/web/dist/manifest.webmanifest')) throw new Error('The website output must retain its PWA service worker and manifest');
if (!/src="\/(?:universal-task-manager\/)?assets\//.test(web)) throw new Error('Unexpected website asset base');
if (!plugin.includes('src="./assets/') || await exists('apps/obsidian/dist/web/sw.js')) throw new Error('Obsidian must have relative assets and no PWA service worker');
console.log('Website PWA and offline Obsidian build outputs are isolated.');
