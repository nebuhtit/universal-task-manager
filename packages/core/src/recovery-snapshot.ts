import type { WorkspaceDocument } from './types.js';

const PREFIX = 'UTM-RECOVERY-JSON-1\n';
const prefixBytes = new TextEncoder().encode(PREFIX);

/** Plain current values, never CRDT history. Encrypt before storing this. */
export function encodeRecoverySnapshot(snapshot: WorkspaceDocument): Uint8Array {
  return new TextEncoder().encode(PREFIX + JSON.stringify(snapshot));
}

export function readRecoverySnapshot(binary: Uint8Array): WorkspaceDocument | undefined {
  if (!prefixBytes.every((byte, index) => binary[index] === byte)) return undefined;
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(binary.subarray(prefixBytes.length))) as WorkspaceDocument;
}
