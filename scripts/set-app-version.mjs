import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const version = process.argv[2]?.trim();
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('Usage: pnpm version:app 1.9.1');
  process.exit(1);
}

const root = resolve(import.meta.dirname, '..');
const typesPath = resolve(root, 'packages/core/src/types.ts');
const e2ePath = resolve(root, 'tests/e2e/app.spec.ts');
const iosProjectPath = resolve(root, 'ios/UniversalTaskManager.xcodeproj/project.pbxproj');
const releasedAt = new Date().toISOString();

const types = await readFile(typesPath, 'utf8');
const nextTypes = types
  .replace(/export const APP_VERSION = '[^']+';/, `export const APP_VERSION = '${version}';`)
  .replace(/export const APP_RELEASED_AT = '[^']+';/, `export const APP_RELEASED_AT = '${releasedAt}';`);
if (types === nextTypes) throw new Error('APP_VERSION markers were not found or already match exactly');

const e2e = await readFile(e2ePath, 'utf8');
const escapedVersion = version.replaceAll('.', '\\.');
const nextE2e = e2e
  .replace(/getByText\('v[^']+', \{ exact: true \}\)/, `getByText('v${version}', { exact: true })`)
  .replace(/const releaseLabel = \/\^v[^;]+;/, `const releaseLabel = /^v${escapedVersion} · (?:local changes · )?commit [0-9a-f]{7}$/;`)
  .replace(/await expect\(page\.locator\('\.settings-release-info'\)\)\.toHaveText\(\/\^Universal Task Manager · v[^;]+;/, `await expect(page.locator('.settings-release-info')).toHaveText(/^Universal Task Manager · v${escapedVersion} · build [0-9a-f]{7}(?: · local changes)?$/);`);
if (e2e === nextE2e) throw new Error('Login version assertion was not found or already matches exactly');

const iosProject = await readFile(iosProjectPath, 'utf8');
const nextIosProject = iosProject.replaceAll(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`);
if (iosProject === nextIosProject) throw new Error('iOS MARKETING_VERSION markers were not found or already match exactly');

await Promise.all([
  writeFile(typesPath, nextTypes),
  writeFile(e2ePath, nextE2e),
  writeFile(iosProjectPath, nextIosProject),
]);
console.log(`UTM application version updated to ${version} (${releasedAt})`);
