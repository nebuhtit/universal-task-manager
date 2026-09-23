import { readFile } from 'node:fs/promises';
import { inspectWorkspaceIntegrity, validateWorkspace } from '../packages/core/dist/index.js';
import { decryptWorkspaceFile } from '../packages/sdk/dist/index.js';

const path = process.argv[2];
if (!path) throw new Error('Usage: pnpm audit:workspace <backup.utmb|workspace.json>. Encrypted files require UTM_AUDIT_PASSWORD.');
const source = await readFile(path, 'utf8');
const parsed = JSON.parse(source);
let workspace;
if (parsed.magic === 'UTM-LOCAL-ENCRYPTED' || parsed.magic === 'UTM-ENCRYPTED') {
  const password = process.env.UTM_AUDIT_PASSWORD;
  if (!password) throw new Error('Set UTM_AUDIT_PASSWORD for an encrypted backup; never pass it as a command argument.');
  workspace = (await decryptWorkspaceFile(source, password)).workspace;
} else workspace = parsed.workspace ?? parsed;
const validation = validateWorkspace(workspace);
if (!validation.valid) {
  // Schema messages may embed source values: print only the count here.
  console.log(JSON.stringify({ schemaValid: false, schemaErrorCount: validation.errors.length, changed: false }, null, 2));
  process.exitCode = 2;
} else {
  const issues = inspectWorkspaceIntegrity(workspace);
  console.log(JSON.stringify({ schemaValid: true, itemCount: Object.keys(workspace.items).length, issues, changed: false }, null, 2));
  if (issues.length) process.exitCode = 2;
}
