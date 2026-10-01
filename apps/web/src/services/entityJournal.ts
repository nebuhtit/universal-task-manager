import * as Automerge from '@automerge/automerge';
import { APP_VERSION, type WorkspaceDocument } from '@utm/core';
import { encryptWithKey, decryptWithKey } from '@utm/sdk';

const ENABLED = 'utm:entity-journal-enabled:v1';
const PREFIX = 'utm:entity-journal:v1:';
const AAD = 'utm:entity-journal:v1';
const MAX_BYTES = 1024 * 1024;
type Block = { nonce: string; ciphertext: string };
let tail: Promise<void> = Promise.resolve();
let pending = 0;
let skipped = 0;
export const entityJournalEnabled = () => { try { return localStorage.getItem(ENABLED) === 'true'; } catch { return false; } };
export function setEntityJournalEnabled(enabled: boolean) { try { localStorage.setItem(ENABLED, String(enabled)); } catch { /* Optional diagnostics. */ } }

/** Bounded JSON, not a backup. Credential-shaped properties are never retained. */
export function journalSnapshot(value: unknown) {
  let budget = 16000, nodes = 0, truncated = false;
  const visit = (input: unknown, depth: number): unknown => {
    if (++nodes > 1500 || budget <= 0 || depth > 16) { truncated = true; return '[omitted: size limit]'; }
    if (typeof input === 'string') { const size = Math.min(input.length, 4096, budget); budget -= size; if (size < input.length) truncated = true; return input.slice(0, size); }
    if (input === null || typeof input !== 'object') return input;
    if (Array.isArray(input)) { if (input.length > 100) truncated = true; return input.slice(0, 100).map(entry => visit(entry, depth + 1)); }
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(input)) {
      if (budget <= 0 || nodes > 1500) { truncated = true; break; }
      budget -= key.length;
      output[key] = /password|secret|token|datakey|privatekey|credential|authorization/i.test(key) ? '[redacted]' : visit(entry, depth + 1);
    }
    return output;
  };
  return { value: visit(value, 0), truncated };
}

function blocks(workspaceId: string): Block[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(PREFIX + workspaceId) ?? '[]'); return Array.isArray(value) ? value.slice(-32) : []; } catch { return []; }
}

export function recordEntityChanges(before: Automerge.Doc<WorkspaceDocument>, after: Automerge.Doc<WorkspaceDocument>, operation: string, dataKey: Uint8Array) {
  if (!entityJournalEnabled() || before === after) return;
  if (pending >= 4) { skipped++; return; }
  try {
    const patches = Automerge.diff(after, Automerge.getHeads(before), Automerge.getHeads(after));
    const ids = new Map<string, { kind: 'items' | 'views'; id: string }>();
    for (const patch of patches) {
      const [kind, id] = patch.path;
      if ((kind === 'items' || kind === 'views') && typeof id === 'string') ids.set(`${kind}:${id}`, { kind, id });
      if ((kind === 'items' || kind === 'views') && patch.path.length === 1) {
        for (const entityId of new Set([...Object.keys(before[kind]), ...Object.keys(after[kind])])) {
          ids.set(`${kind}:${entityId}`, { kind, id: entityId });
        }
      }
    }
    if (!ids.size) return;
    const payload = { at: new Date().toISOString(), operation: operation.slice(0, 200), skippedDuringBurst: skipped, stage: 'local-commit-not-durability-confirmation', totalChanged: ids.size, omitted: Math.max(0, ids.size - 10), changes: [...ids.values()].slice(0, 10).map(({ kind, id }) => ({ kind, id, before: journalSnapshot(before[kind][id] ?? null), after: journalSnapshot(after[kind][id] ?? null) })) };
    const text = JSON.stringify({ ...payload, appVersion: APP_VERSION });
    const workspaceId = after.workspaceId, key = dataKey.slice();
    skipped = 0;
    pending++;
    tail = tail.then(async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 0));
        if (!entityJournalEnabled()) return;
        const encrypted = await encryptWithKey(new TextEncoder().encode(text), key, AAD);
        const entries = [...blocks(workspaceId), encrypted].slice(-32);
        while (entries.length && JSON.stringify(entries).length * 2 > MAX_BYTES) entries.shift();
        localStorage.setItem(PREFIX + workspaceId, JSON.stringify(entries));
      } finally { key.fill(0); pending--; }
    }).catch(() => undefined);
  } catch { /* A diagnostic failure must never stop a real edit/save. */ }
}

export async function readEntityJournal(workspaceId: string, dataKey: Uint8Array) {
  await tail;
  const result: unknown[] = [];
  for (const block of blocks(workspaceId)) result.push(JSON.parse(new TextDecoder().decode(await decryptWithKey(block, dataKey, AAD))));
  return { format: 'utm-private-entity-journal-v1', warning: 'Contains private item/view content. Bounded diagnostic snapshots, not a backup.', entries: result };
}
export async function clearEntityJournal(workspaceId: string) { await tail; localStorage.removeItem(PREFIX + workspaceId); }
