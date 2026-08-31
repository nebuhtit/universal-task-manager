import * as Automerge from '@automerge/automerge';
import { fromCanonicalJSON, migrateWorkspace, toCanonicalJSON, toICS, validateWorkspace, workspaceForExport } from '@utm/core';
import type { WorkspaceDocument } from '@utm/core';
import { decryptBytes, digest, encryptBytes, fromBase64, toBase64, type EncryptedEnvelope } from './crypto.js';

export interface UtmPayload {
  format: 'utm-workspace';
  schemaVersion: string;
  workspaceId: string;
  exportedAt: string;
  snapshot: WorkspaceDocument;
  automerge: string;
  manifest: { snapshotDigest: string; automergeDigest: string; itemCount: number; historyMode?: 'full' | 'snapshot' };
}

export interface UtmContainer {
  magic: 'UTM-ENCRYPTED';
  version: 1;
  envelope: EncryptedEnvelope;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const containerAad = 'utm:container:v1';
const googleHistoryMarkers = [encoder.encode('google_calendar'), encoder.encode('google:')];

function includesBytes(source: Uint8Array, expected: Uint8Array): boolean {
  if (!expected.length || expected.length > source.length) return false;
  outer: for (let index = 0; index <= source.length - expected.length; index += 1) {
    for (let offset = 0; offset < expected.length; offset += 1) if (source[index + offset] !== expected[offset]) continue outer;
    return true;
  }
  return false;
}

/** Google values removed from the current snapshot can still exist in CRDT changes. */
export function requiresPrivacySafeSnapshot(document: Automerge.Doc<WorkspaceDocument>): boolean {
  const current = structuredClone(document) as WorkspaceDocument;
  if (JSON.stringify(workspaceForExport(current)) !== JSON.stringify(current)) return true;
  return Automerge.getAllChanges(document).some((change) => googleHistoryMarkers.some((marker) => includesBytes(change, marker)));
}

export function createAutomergeDocument(workspace: WorkspaceDocument): Automerge.Doc<WorkspaceDocument> {
  return Automerge.from(workspace as unknown as Record<string, unknown>) as unknown as Automerge.Doc<WorkspaceDocument>;
}

export async function exportContainer(document: Automerge.Doc<WorkspaceDocument>, password: string): Promise<string> {
  const original = structuredClone(document) as WorkspaceDocument;
  const snapshot = workspaceForExport(original);
  const validation = validateWorkspace(snapshot);
  if (!validation.valid) throw new Error(`Cannot export invalid workspace: ${validation.errors.join('; ')}`);
  const privacyFiltered = requiresPrivacySafeSnapshot(document);
  // Never carry removed Google events in Automerge history. A filtered export
  // deliberately starts from a fresh canonical snapshot.
  const exportDocument = privacyFiltered ? createAutomergeDocument(snapshot) : document;
  const binary = Automerge.save(exportDocument);
  const snapshotBytes = encoder.encode(toCanonicalJSON(snapshot, false));
  const payload: UtmPayload = {
    format: 'utm-workspace', schemaVersion: snapshot.schemaVersion, workspaceId: snapshot.workspaceId,
    exportedAt: new Date().toISOString(), snapshot, automerge: toBase64(binary),
    manifest: { snapshotDigest: await digest(snapshotBytes), automergeDigest: await digest(binary), itemCount: Object.keys(snapshot.items).length, ...(privacyFiltered ? { historyMode: 'snapshot' as const } : {}) },
  };
  const envelope = await encryptBytes(encoder.encode(JSON.stringify(payload)), password, containerAad);
  return JSON.stringify({ magic: 'UTM-ENCRYPTED', version: 1, envelope } satisfies UtmContainer);
}

function parseContainer(source: string): UtmContainer {
  const parsed: unknown = JSON.parse(source);
  if (!parsed || typeof parsed !== 'object') throw new Error('Container must be an object');
  const container = parsed as Partial<UtmContainer>;
  if (container.magic !== 'UTM-ENCRYPTED' || container.version !== 1 || !container.envelope) throw new Error('Not a supported encrypted backup container');
  return container as UtmContainer;
}

export async function unlock(source: string, password: string): Promise<{ payload: UtmPayload; document: Automerge.Doc<WorkspaceDocument> }> {
  const container = parseContainer(source);
  const plaintext = await decryptBytes(container.envelope, password, containerAad);
  let payload: UtmPayload;
  try { payload = JSON.parse(decoder.decode(plaintext)) as UtmPayload; }
  catch { throw new Error('Decrypted container payload is not valid JSON'); }
  if (payload.format !== 'utm-workspace' || payload.workspaceId !== payload.snapshot?.workspaceId) throw new Error('Container manifest does not match its snapshot');
  const binary = fromBase64(payload.automerge);
  const snapshotDigest = await digest(encoder.encode(JSON.stringify(payload.snapshot)));
  if (snapshotDigest !== payload.manifest.snapshotDigest || await digest(binary) !== payload.manifest.automergeDigest) throw new Error('Container manifest integrity check failed');
  let document: Automerge.Doc<WorkspaceDocument>;
  try { document = Automerge.load<WorkspaceDocument>(binary); }
  catch { throw new Error('Automerge history is damaged'); }
  if (document.workspaceId !== payload.workspaceId) throw new Error('Automerge history belongs to another workspace');
  const migratedSnapshot = migrateWorkspace(payload.snapshot).value;
  if (document.schemaVersion !== migratedSnapshot.schemaVersion) {
    document = Automerge.change(document, 'Migrate imported workspace schema', (draft) => {
      const next = migratedSnapshot as unknown as Record<string, unknown>;
      for (const key of Object.keys(draft as unknown as Record<string, unknown>)) delete (draft as unknown as Record<string, unknown>)[key];
      for (const [key, value] of Object.entries(next)) (draft as unknown as Record<string, unknown>)[key] = value;
    });
  }
  payload = { ...payload, schemaVersion: migratedSnapshot.schemaVersion, snapshot: migratedSnapshot };
  return { payload, document };
}

export async function merge(
  current: Automerge.Doc<WorkspaceDocument>,
  source: string,
  password: string,
): Promise<{ document: Automerge.Doc<WorkspaceDocument>; changedItems: number }> {
  const incoming = await unlock(source, password);
  if (incoming.document.workspaceId !== current.workspaceId) throw new Error('Only containers from the same workspace can be merged');
  const before = new Map(Object.entries(current.items).map(([id, item]) => [id, item.revision]));
  let document: Automerge.Doc<WorkspaceDocument>;
  if (incoming.payload.manifest.historyMode === 'snapshot') {
    const source = incoming.payload.snapshot;
    document = Automerge.change(current, 'Merge privacy-safe workspace snapshot', (draft) => {
      for (const [id, item] of Object.entries(source.items)) {
        const local = draft.items[id];
        if (!local || item.revision > local.revision || (item.revision === local.revision && item.updatedAt > local.updatedAt)) draft.items[id] = structuredClone(item);
      }
      for (const [id, deletedAt] of Object.entries(source.tombstones)) {
        if (!draft.tombstones[id] || deletedAt > draft.tombstones[id]!) draft.tombstones[id] = deletedAt;
        if (draft.items[id] && draft.items[id]!.updatedAt <= deletedAt) delete draft.items[id];
      }
      if (source.updatedAt > draft.updatedAt) {
        draft.listDefinitions = structuredClone(source.listDefinitions);
        draft.areaDefinitions = structuredClone(source.areaDefinitions);
        draft.projectDefinitions = structuredClone(source.projectDefinitions);
        draft.organizationPreferences = structuredClone(source.organizationPreferences);
        draft.customFields = structuredClone(source.customFields);
        draft.views = structuredClone(source.views);
        draft.viewOrder = [...source.viewOrder];
        draft.dashboards = structuredClone(source.dashboards);
        draft.automations = structuredClone(source.automations);
        draft.calendarPreferences = { ...structuredClone(source.calendarPreferences), ...(draft.calendarPreferences.googleCalendar ? { googleCalendar: structuredClone(draft.calendarPreferences.googleCalendar) } : {}) };
      }
    });
  } else document = Automerge.merge(current, incoming.document);
  document = Automerge.change(document, 'Record merge time', (draft) => { draft.updatedAt = new Date().toISOString(); });
  const changedItems = Object.entries(document.items).filter(([id, item]) => before.get(id) !== item.revision).length;
  return { document, changedItems };
}

export async function validateContainer(source: string, password: string): Promise<{ valid: true; workspaceId: string; itemCount: number; exportedAt: string }> {
  const { payload } = await unlock(source, password);
  return { valid: true, workspaceId: payload.workspaceId, itemCount: payload.manifest.itemCount, exportedAt: payload.exportedAt };
}

export async function toJSON(source: string, password: string): Promise<string> {
  const { payload } = await unlock(source, password);
  return toCanonicalJSON(payload.snapshot);
}

export async function containerToICS(source: string, password: string): Promise<{ ics: string; warnings: ReturnType<typeof toICS>['warnings'] }> {
  const { payload } = await unlock(source, password);
  return toICS(payload.snapshot);
}

export async function fromJSON(source: string, password: string): Promise<string> {
  return exportContainer(createAutomergeDocument(fromCanonicalJSON(source)), password);
}
