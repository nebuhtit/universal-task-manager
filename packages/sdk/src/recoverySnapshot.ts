import * as Automerge from '@automerge/automerge';
import { migrateWorkspace, validateWorkspace, readRecoverySnapshot, type WorkspaceDocument } from '@utm/core';
export { encodeRecoverySnapshot } from '@utm/core';

// Only the export-safe recovery block uses this encoding. The live document
// still uses Automerge.save(), preserving its complete merge history.
export function decodeLocalWorkspaceBinary(binary: Uint8Array): Automerge.Doc<WorkspaceDocument> {
  const snapshot = readRecoverySnapshot(binary);
  if (snapshot === undefined) return Automerge.load<WorkspaceDocument>(binary);
  if (!validateWorkspace(snapshot).valid && !validateWorkspace(migrateWorkspace(snapshot).value).valid) {
    throw new Error('Recovery snapshot integrity check failed');
  }
  return Automerge.from(snapshot as unknown as Record<string, unknown>) as unknown as Automerge.Doc<WorkspaceDocument>;
}
