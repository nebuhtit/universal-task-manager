import { workspaceForExport, type WorkspaceDocument } from '@utm/core';
import type * as Automerge from '@automerge/automerge';

const encoder = new TextEncoder();
const googleHistoryMarkers = [encoder.encode('google_calendar'), encoder.encode('google:')];

function includesBytes(source: Uint8Array, expected: Uint8Array): boolean {
  if (!expected.length || expected.length > source.length) return false;
  outer: for (let index = 0; index <= source.length - expected.length; index += 1) {
    for (let offset = 0; offset < expected.length; offset += 1) if (source[index + offset] !== expected[offset]) continue outer;
    return true;
  }
  return false;
}

/** Returns a fresh privacy-safe snapshot only when normal CRDT history is unsafe to export. */
export function persistenceExportSafeSnapshot(
  document: Automerge.Doc<WorkspaceDocument>,
  changes: Uint8Array[],
): WorkspaceDocument | undefined {
  const current = structuredClone(document) as WorkspaceDocument;
  const snapshot = workspaceForExport(current);
  const currentDataChanged = JSON.stringify(snapshot) !== JSON.stringify(current);
  const privateHistory = changes.some((change) => googleHistoryMarkers.some((marker) => includesBytes(change, marker)));
  return currentDataChanged || privateHistory ? snapshot : undefined;
}
