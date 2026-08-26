#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { exportContainer, fromJSON, merge, toJSON, containerToICS, unlock, validateContainer } from './index.js';

function usage(): never {
  process.stderr.write(`Universal Task Manager CLI

Password is read from UTM_CONTAINER_PASSWORD.

Commands:
  utm validate <workspace.utmb>
  utm unlock <workspace.utmb> --format json|ics
  utm merge <local.utmb> <incoming.utmb>
  utm from-json <workspace.json>

Plaintext is written only to stdout. Redirecting it to a file is an explicit user action.
`);
  process.exit(2);
}

async function password(): Promise<string> {
  const value = process.env.UTM_CONTAINER_PASSWORD;
  if (!value) throw new Error('Set UTM_CONTAINER_PASSWORD before running this command');
  return value;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command) usage();
  const secret = await password();
  if (command === 'validate' && args[0]) {
    const result = await validateContainer(await readFile(args[0], 'utf8'), secret);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === 'unlock' && args[0]) {
    const formatAt = args.indexOf('--format');
    const format = formatAt >= 0 ? args[formatAt + 1] : 'json';
    const source = await readFile(args[0], 'utf8');
    if (format === 'json') process.stdout.write(`${await toJSON(source, secret)}\n`);
    else if (format === 'ics') {
      const result = await containerToICS(source, secret);
      result.warnings.forEach((warning) => process.stderr.write(`warning: ${warning.itemId ?? 'workspace'} ${warning.message}\n`));
      process.stdout.write(result.ics);
    } else usage();
    return;
  }
  if (command === 'merge' && args[0] && args[1]) {
    const left = await unlock(await readFile(args[0], 'utf8'), secret);
    const result = await merge(left.document, await readFile(args[1], 'utf8'), secret);
    process.stdout.write(`${await exportContainer(result.document, secret)}\n`);
    process.stderr.write(`merged: ${result.changedItems} changed items\n`);
    return;
  }
  if (command === 'from-json' && args[0]) {
    process.stdout.write(`${await fromJSON(await readFile(args[0], 'utf8'), secret)}\n`);
    return;
  }
  usage();
}

main().catch((error) => {
  process.stderr.write(`utm: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
