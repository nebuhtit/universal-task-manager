import { cp, mkdir, rm, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(repositoryRoot, 'apps/web/dist-native');
const destination = resolve(repositoryRoot, 'ios/UniversalTaskManager/Generated/WebApp');

// Fail packaging if a future build accidentally restores deferred UI chunks.
// Background workers are separate by design; page/editor modules are not.
const javascript = (await readdir(resolve(source, 'assets'))).filter(name => name.endsWith('.js') && !name.includes('.worker-'));
if (javascript.length !== 1 || !javascript[0].startsWith('index-')) {
  throw new Error('Native UI must be a single installed JavaScript entry (no lazy page chunks).');
}

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });

console.log(`Packaged the local web app at ${destination}`);
