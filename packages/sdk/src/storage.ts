import * as Automerge from '@automerge/automerge';
import { createWorkspace, WORKSPACE_FORMAT_GUIDE } from '@utm/core';
import type { WorkspaceDocument, WorkspaceLanguage } from '@utm/core';
import {
  decryptBytes, decryptWithKey, encryptWithKey, fromBase64, randomKey, ready, toBase64, unwrapKey, wrapKey,
  type EncryptedEnvelope,
} from './crypto.js';
import { createAutomergeDocument, merge, unlock } from './container.js';

interface EncryptedLocalMetadata { version: 1; wrappedKey: EncryptedEnvelope; createdAt: string; mode?: 'encrypted' }
interface PlaintextLocalMetadata { version: 1; mode: 'plaintext'; createdAt: string }
type LocalMetadata = EncryptedLocalMetadata | PlaintextLocalMetadata;
interface EncryptedLocalBlock { version: 1; mode?: never; nonce: string; ciphertext: string }
interface PlaintextLocalBlock { version: 1; mode: 'plaintext'; binary: Uint8Array }
type LocalBlock = EncryptedLocalBlock | PlaintextLocalBlock;
export interface UnlockedWorkspace { document: Automerge.Doc<WorkspaceDocument>; dataKey: Uint8Array; storageMode?: 'encrypted' | 'plaintext' }
export interface ReadableWorkspaceRecovery {
  format: 'utm-readable-workspace';
  formatVersion: 1;
  decryptedAt: string;
  source: { magic: 'UTM-LOCAL-ENCRYPTED' | 'UTM-ENCRYPTED'; diagnosticsIncluded: boolean };
  readme: typeof WORKSPACE_FORMAT_GUIDE;
  workspace: WorkspaceDocument;
  diagnostics?: unknown;
}

const DB_NAME = 'utm-secure-v1';
const STORE = 'encrypted-records';
const META_KEY = 'metadata';
const BLOCK_KEY = 'workspace';
const SNAPSHOT_KEYS = ['workspace-snapshot-1', 'workspace-snapshot-2'] as const;
const BLOCK_AAD = 'utm:local:workspace:v1';
// A few early recovery builds used these labels while the recovery export was
// being introduced. Keep read compatibility so a copied .utmlocal never
// becomes undecryptable merely because the app was updated.
const LEGACY_BLOCK_AAD = ['utm:local:block:v1', 'utm:workspace:v1'] as const;
const LEGACY_KEY_AAD = ['utm:workspace-key', 'utm:local:key:v1'] as const;

async function unwrapLocalKey(envelope: EncryptedEnvelope, password: string): Promise<Uint8Array> {
  try { return await unwrapKey(envelope, password); }
  catch (primary) {
    for (const aad of LEGACY_KEY_AAD) {
      try { return await decryptBytes(envelope, password, aad); } catch { /* try next compatibility label */ }
    }
    throw primary;
  }
}

async function decryptLocalBlock(block: EncryptedLocalBlock, dataKey: Uint8Array): Promise<Uint8Array> {
  try { return await decryptWithKey(block, dataKey, BLOCK_AAD); }
  catch (primary) {
    for (const aad of LEGACY_BLOCK_AAD) {
      try { return await decryptWithKey(block, dataKey, aad); } catch { /* try next compatibility label */ }
    }
    throw primary;
  }
}

/** Verify the exact bytes that will be persisted can be authenticated and loaded. */
async function verifyEncryptedDocument(block: EncryptedLocalBlock, dataKey: Uint8Array): Promise<void> {
  const binary = await decryptLocalBlock(block, dataKey);
  try { Automerge.load<WorkspaceDocument>(binary); }
  catch { throw new Error('Encrypted workspace round-trip verification failed'); }
}

export interface LocalWorkspaceSnapshotInfo { id: string; createdAt: string; schemaVersion: string; reason: string }
interface LocalWorkspaceSnapshot extends LocalWorkspaceSnapshotInfo { metadata: LocalMetadata; workspace: LocalBlock }

const isPlaintextBlock = (block: LocalBlock): block is PlaintextLocalBlock => block.mode === 'plaintext';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error ?? new Error('Cannot open IndexedDB'));
    request.onsuccess = () => resolve(request.result);
  });
}

async function getRecord<T>(key: string): Promise<T | undefined> {
  const db = await openDatabase();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'));
    });
  } finally { db.close(); }
}

async function putRecords(records: Array<[string, unknown]>): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      records.forEach(([key, value]) => store.put(value, key));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    });
  } finally { db.close(); }
}

async function transactRecords(records: Array<[string, unknown]>, deleteKeys: string[] = []): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      records.forEach(([key, value]) => store.put(value, key));
      deleteKeys.forEach((key) => store.delete(key));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    });
  } finally { db.close(); }
}

export async function hasLocalWorkspace(): Promise<boolean> { return Boolean(await getRecord<LocalMetadata>(META_KEY)); }

/** A plaintext workspace is deliberately opt-in and meant only for local testing. */
export async function localWorkspaceMode(): Promise<'encrypted' | 'plaintext' | null> {
  const metadata = await getRecord<LocalMetadata>(META_KEY);
  if (!metadata) return null;
  return metadata.mode === 'plaintext' ? 'plaintext' : 'encrypted';
}

export async function createLocalWorkspace(password: string, name = 'My workspace', language: WorkspaceLanguage = 'en'): Promise<UnlockedWorkspace> {
  if (await hasLocalWorkspace()) throw new Error('A local workspace already exists');
  const dataKey = await randomKey();
  const wrappedKey = await wrapKey(dataKey, password);
  const workspace = createWorkspace(name);
  workspace.calendarPreferences.language = language;
  const document = createAutomergeDocument(workspace);
  const encrypted = await encryptWithKey(Automerge.save(document), dataKey, BLOCK_AAD);
  const metadata: EncryptedLocalMetadata = { version: 1, wrappedKey, createdAt: new Date().toISOString() };
  await putRecords([[META_KEY, metadata], [BLOCK_KEY, { version: 1, ...encrypted } satisfies EncryptedLocalBlock]]);
  return { document, dataKey, storageMode: 'encrypted' };
}

export async function createUnencryptedLocalWorkspace(name = 'Test workspace', language: WorkspaceLanguage = 'en'): Promise<UnlockedWorkspace> {
  if (await hasLocalWorkspace()) throw new Error('A local workspace already exists');
  const workspace = createWorkspace(name);
  workspace.calendarPreferences.language = language;
  const document = createAutomergeDocument(workspace);
  const metadata: PlaintextLocalMetadata = { version: 1, mode: 'plaintext', createdAt: new Date().toISOString() };
  await putRecords([[META_KEY, metadata], [BLOCK_KEY, { version: 1, mode: 'plaintext', binary: Automerge.save(document) } satisfies PlaintextLocalBlock]]);
  return { document, dataKey: new Uint8Array(), storageMode: 'plaintext' };
}

export async function unlockLocalWorkspace(password: string): Promise<UnlockedWorkspace> {
  const metadata = await getRecord<LocalMetadata>(META_KEY);
  const block = await getRecord<LocalBlock>(BLOCK_KEY);
  if (!metadata || !block) throw new Error('No local workspace exists');
  if (metadata.mode === 'plaintext' || isPlaintextBlock(block)) throw new Error('This local workspace is configured without encryption');
  const dataKey = await unwrapLocalKey(metadata.wrappedKey, password);
  const binary = await decryptWithKey(block, dataKey, BLOCK_AAD);
  try { return { document: Automerge.load<WorkspaceDocument>(binary), dataKey, storageMode: 'encrypted' }; }
  catch { throw new Error('Decrypted local workspace is damaged'); }
}

export async function unlockUnencryptedLocalWorkspace(): Promise<UnlockedWorkspace> {
  const metadata = await getRecord<LocalMetadata>(META_KEY);
  const block = await getRecord<LocalBlock>(BLOCK_KEY);
  if (!metadata || !block) throw new Error('No local workspace exists');
  if (metadata.mode !== 'plaintext' || !isPlaintextBlock(block)) throw new Error('This local workspace requires its password');
  try { return { document: Automerge.load<WorkspaceDocument>(block.binary), dataKey: new Uint8Array(), storageMode: 'plaintext' }; }
  catch { throw new Error('Plaintext local workspace is damaged'); }
}

export async function saveLocalWorkspace(document: Automerge.Doc<WorkspaceDocument>, dataKey: Uint8Array, storageMode: UnlockedWorkspace['storageMode'] = 'encrypted'): Promise<void> {
  if (storageMode === 'plaintext') {
    await putRecords([[BLOCK_KEY, { version: 1, mode: 'plaintext', binary: Automerge.save(document) } satisfies PlaintextLocalBlock]]);
    return;
  }
  const encrypted = await encryptWithKey(Automerge.save(document), dataKey, BLOCK_AAD);
  await verifyEncryptedDocument({ version: 1, ...encrypted }, dataKey);
  await putRecords([[BLOCK_KEY, { version: 1, ...encrypted } satisfies EncryptedLocalBlock]]);
}

/** Atomically stores the current encrypted block as a rollback point and writes the migrated document. */
export async function saveMigratedLocalWorkspace(document: Automerge.Doc<WorkspaceDocument>, dataKey: Uint8Array, fromVersion: string, reason = 'schema migration'): Promise<void> {
  const metadata = await getRecord<LocalMetadata>(META_KEY);
  const current = await getRecord<LocalBlock>(BLOCK_KEY);
  if (!metadata || !current) throw new Error('No local workspace exists');
  const previousSnapshot = await getRecord<LocalWorkspaceSnapshot>(SNAPSHOT_KEYS[0]);
  const snapshot: LocalWorkspaceSnapshot = { id: SNAPSHOT_KEYS[0], createdAt: new Date().toISOString(), schemaVersion: fromVersion, reason, metadata, workspace: current };
  const nextBlock: LocalBlock = metadata.mode === 'plaintext'
    ? { version: 1, mode: 'plaintext', binary: Automerge.save(document) }
    : { version: 1, ...await encryptWithKey(Automerge.save(document), dataKey, BLOCK_AAD) };
  if (!isPlaintextBlock(nextBlock)) await verifyEncryptedDocument(nextBlock, dataKey);
  await transactRecords([
    [BLOCK_KEY, nextBlock],
    [SNAPSHOT_KEYS[0], snapshot],
    ...(previousSnapshot ? [[SNAPSHOT_KEYS[1], { ...previousSnapshot, id: SNAPSHOT_KEYS[1] }] as [string, unknown]] : []),
  ], previousSnapshot ? [] : [SNAPSHOT_KEYS[1]]);
}

export async function listLocalWorkspaceSnapshots(): Promise<LocalWorkspaceSnapshotInfo[]> {
  const snapshots = await Promise.all(SNAPSHOT_KEYS.map((key) => getRecord<LocalWorkspaceSnapshot>(key)));
  return snapshots.filter((entry): entry is LocalWorkspaceSnapshot => Boolean(entry)).map(({ id, createdAt, schemaVersion, reason }) => ({ id, createdAt, schemaVersion, reason }));
}

export async function exportLocalWorkspaceSnapshot(id: string): Promise<string> {
  if (!SNAPSHOT_KEYS.includes(id as typeof SNAPSHOT_KEYS[number])) throw new Error('Unknown workspace snapshot');
  const snapshot = await getRecord<LocalWorkspaceSnapshot>(id);
  if (!snapshot) throw new Error('Workspace snapshot does not exist');
  return JSON.stringify({ magic: 'UTM-LOCAL-ENCRYPTED', version: 1, exportedAt: new Date().toISOString(), metadata: snapshot.metadata, workspace: snapshot.workspace });
}

export async function restoreLocalWorkspaceSnapshot(id: string, password: string): Promise<UnlockedWorkspace> {
  if (!SNAPSHOT_KEYS.includes(id as typeof SNAPSHOT_KEYS[number])) throw new Error('Unknown workspace snapshot');
  const snapshot = await getRecord<LocalWorkspaceSnapshot>(id);
  const currentMetadata = await getRecord<LocalMetadata>(META_KEY);
  const currentBlock = await getRecord<LocalBlock>(BLOCK_KEY);
  if (!snapshot || !currentMetadata || !currentBlock) throw new Error('Workspace snapshot does not exist');
  if (snapshot.metadata.mode === 'plaintext' || isPlaintextBlock(snapshot.workspace)) throw new Error('This snapshot does not require a password');
  const dataKey = await unwrapKey(snapshot.metadata.wrappedKey, password);
  const binary = await decryptWithKey(snapshot.workspace, dataKey, BLOCK_AAD);
  let document: Automerge.Doc<WorkspaceDocument>;
  try { document = Automerge.load<WorkspaceDocument>(binary); } catch { throw new Error('Workspace snapshot is damaged'); }
  const previousSnapshot = await getRecord<LocalWorkspaceSnapshot>(SNAPSHOT_KEYS[0]);
  const current: LocalWorkspaceSnapshot = { id: SNAPSHOT_KEYS[0], createdAt: new Date().toISOString(), schemaVersion: String((document as WorkspaceDocument).schemaVersion ?? 'unknown'), reason: 'before snapshot restore', metadata: currentMetadata, workspace: currentBlock };
  await transactRecords([[META_KEY, snapshot.metadata], [BLOCK_KEY, snapshot.workspace], [SNAPSHOT_KEYS[0], current], ...(previousSnapshot ? [[SNAPSHOT_KEYS[1], { ...previousSnapshot, id: SNAPSHOT_KEYS[1] }] as [string, unknown]] : [])]);
  return { document, dataKey, storageMode: 'encrypted' };
}

export async function importAsLocalWorkspace(source: string, password: string): Promise<UnlockedWorkspace> {
  if (await hasLocalWorkspace()) throw new Error('A local workspace already exists');
  let localBackup: { magic?: string; version?: number; metadata?: EncryptedLocalMetadata; workspace?: EncryptedLocalBlock } | undefined;
  try { localBackup = JSON.parse(source) as typeof localBackup; } catch { /* Standard portable containers are parsed below. */ }
  if (localBackup?.magic === 'UTM-LOCAL-ENCRYPTED') {
    const metadata = localBackup.metadata;
    const block = localBackup.workspace;
    if (localBackup.version !== 1 || !metadata?.wrappedKey || !block?.nonce || !block.ciphertext) throw new Error('Encrypted recovery copy is incomplete');
    const dataKey = await unwrapLocalKey(metadata.wrappedKey, password);
    const binary = await decryptWithKey(block, dataKey, BLOCK_AAD);
    let document: Automerge.Doc<WorkspaceDocument>;
    try { document = Automerge.load<WorkspaceDocument>(binary); }
    catch { throw new Error('Decrypted recovery copy is damaged'); }
    await putRecords([[META_KEY, metadata], [BLOCK_KEY, block]]);
    return { document, dataKey, storageMode: 'encrypted' };
  }
  const incoming = await unlock(source, password);
  const dataKey = await randomKey();
  const metadata: EncryptedLocalMetadata = { version: 1, wrappedKey: await wrapKey(dataKey, password), createdAt: new Date().toISOString() };
  const encrypted = await encryptWithKey(Automerge.save(incoming.document), dataKey, BLOCK_AAD);
  await putRecords([[META_KEY, metadata], [BLOCK_KEY, { version: 1, ...encrypted } satisfies EncryptedLocalBlock]]);
  return { document: incoming.document, dataKey, storageMode: 'encrypted' };
}

/** Decrypts an arbitrary backup into documented JSON without reading or changing IndexedDB. */
export async function decryptWorkspaceFile(source: string, password: string): Promise<ReadableWorkspaceRecovery> {
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(source) as Record<string, unknown>; }
  catch { throw new Error('Encrypted workspace file is not valid JSON'); }
  if (parsed.magic === 'UTM-LOCAL-ENCRYPTED') {
    const metadata = parsed.metadata as EncryptedLocalMetadata | undefined;
    const block = parsed.workspace as EncryptedLocalBlock | undefined;
    if (parsed.version !== 1 || !metadata?.wrappedKey || !block?.nonce || !block.ciphertext) throw new Error('Encrypted recovery copy is incomplete');
    const dataKey = await unwrapLocalKey(metadata.wrappedKey, password);
    try {
      const binary = await decryptLocalBlock(block, dataKey);
      let document: Automerge.Doc<WorkspaceDocument>;
      try { document = Automerge.load<WorkspaceDocument>(binary); }
      catch { throw new Error('Decrypted recovery copy is damaged'); }
      return {
        format: 'utm-readable-workspace', formatVersion: 1, decryptedAt: new Date().toISOString(),
        source: { magic: 'UTM-LOCAL-ENCRYPTED', diagnosticsIncluded: 'diagnostics' in parsed },
        readme: WORKSPACE_FORMAT_GUIDE, workspace: JSON.parse(JSON.stringify(document)) as WorkspaceDocument,
        ...('diagnostics' in parsed ? { diagnostics: parsed.diagnostics } : {}),
      };
    } finally { dataKey.fill(0); }
  }
  if (parsed.magic === 'UTM-ENCRYPTED') {
    const incoming = await unlock(source, password);
    return {
      format: 'utm-readable-workspace', formatVersion: 1, decryptedAt: new Date().toISOString(),
      source: { magic: 'UTM-ENCRYPTED', diagnosticsIncluded: false },
      readme: WORKSPACE_FORMAT_GUIDE, workspace: structuredClone(incoming.payload.snapshot),
    };
  }
  throw new Error('Choose an encrypted UTM backup (.utmb, .utm or .utmlocal)');
}

/**
 * Restores an encrypted container over the local browser copy.  This is
 * intentionally separate from merge: a backup made by another workspace
 * cannot be merged, but it can be used to recover a new device after the
 * user has explicitly chosen to replace its local copy.
 *
 * The container is fully unlocked and verified before any IndexedDB write is
 * started, and metadata + workspace are committed in one transaction.
 */
export async function restoreLocalWorkspace(source: string, password: string): Promise<UnlockedWorkspace> {
  const incoming = await unlock(source, password);
  const dataKey = await randomKey();
  const metadata: EncryptedLocalMetadata = { version: 1, wrappedKey: await wrapKey(dataKey, password), createdAt: new Date().toISOString() };
  const encrypted = await encryptWithKey(Automerge.save(incoming.document), dataKey, BLOCK_AAD);
  await putRecords([[META_KEY, metadata], [BLOCK_KEY, { version: 1, ...encrypted } satisfies EncryptedLocalBlock]]);
  return { document: incoming.document, dataKey, storageMode: 'encrypted' };
}

export async function mergeIntoLocalWorkspace(
  current: UnlockedWorkspace,
  source: string,
  password: string,
): Promise<{ unlocked: UnlockedWorkspace; changedItems: number }> {
  const merged = await merge(current.document, source, password);
  const storageMode = current.storageMode ?? 'encrypted';
  await saveLocalWorkspace(merged.document, current.dataKey, storageMode);
  return { unlocked: { document: merged.document, dataKey: current.dataKey, storageMode }, changedItems: merged.changedItems };
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  const metadata = await getRecord<LocalMetadata>(META_KEY);
  if (!metadata) throw new Error('No local workspace exists');
  if (metadata.mode === 'plaintext') throw new Error('This local workspace has no password');
  const key = await unwrapKey(metadata.wrappedKey, oldPassword);
  try { await putRecords([[META_KEY, { ...metadata, wrappedKey: await wrapKey(key, newPassword) } satisfies LocalMetadata]]); }
  finally { await ready(); key.fill(0); }
}

export async function clearLocalWorkspace(): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE, 'readwrite').objectStore(STORE).clear();
      request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function inspectEncryptedLocalRecords(): Promise<{ metadata: unknown; workspace: unknown }> {
  return { metadata: await getRecord(META_KEY), workspace: await getRecord(BLOCK_KEY) };
}

/** Export the encrypted browser records without decrypting them. Useful for recovery before unlock. */
export async function exportEncryptedLocalBackup(): Promise<string> {
  const metadata = await getRecord<LocalMetadata>(META_KEY);
  const workspace = await getRecord<LocalBlock>(BLOCK_KEY);
  if (!metadata || !workspace || metadata.mode === 'plaintext' || isPlaintextBlock(workspace)) {
    throw new Error('No encrypted local workspace exists');
  }
  return JSON.stringify({ magic: 'UTM-LOCAL-ENCRYPTED', version: 1, exportedAt: new Date().toISOString(), metadata, workspace });
}

export function lock(unlocked: UnlockedWorkspace): void { unlocked.dataKey.fill(0); }

export const __testing = { DB_NAME, STORE, META_KEY, BLOCK_KEY, toBase64, fromBase64 };
