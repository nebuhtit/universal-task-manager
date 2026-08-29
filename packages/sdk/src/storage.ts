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
const MIRROR_KEYS = ['workspace-verified-mirror-1', 'workspace-verified-mirror-2'] as const;
const FACE_ID_KEY = 'face-id-unlock-v1';
const BLOCK_AAD = 'utm:local:workspace:v1';
const FACE_ID_AAD = 'utm:face-id:data-key:v1';
// Previous encrypted container revisions used these authenticated labels.
// They remain decoder variants inside the single public .utmb format.
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
interface VerifiedWorkspaceMirror { savedAt: string; metadata: EncryptedLocalMetadata; workspace: EncryptedLocalBlock }
interface FaceIdUnlockRecord { version: 1; credentialId: string; salt: string; wrappedDataKey: { nonce: string; ciphertext: string }; createdAt: string }
export interface LocalProtectionStatus { verifiedMirrors: number; latestVerifiedAt?: string }

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

async function saveVerifiedMirror(metadata: EncryptedLocalMetadata, workspace: EncryptedLocalBlock): Promise<void> {
  const previous = await getRecord<VerifiedWorkspaceMirror>(MIRROR_KEYS[0]);
  await putRecords([
    [MIRROR_KEYS[0], { savedAt: new Date().toISOString(), metadata, workspace } satisfies VerifiedWorkspaceMirror],
    ...(previous ? [[MIRROR_KEYS[1], previous] as [string, unknown]] : []),
  ]);
}

async function latestVerifiedMirror(): Promise<VerifiedWorkspaceMirror | undefined> {
  return await getRecord<VerifiedWorkspaceMirror>(MIRROR_KEYS[0]) ?? await getRecord<VerifiedWorkspaceMirror>(MIRROR_KEYS[1]);
}

export async function getLocalProtectionStatus(): Promise<LocalProtectionStatus> {
  const mirrors = await Promise.all(MIRROR_KEYS.map((key) => getRecord<VerifiedWorkspaceMirror>(key)));
  const available = mirrors.filter((mirror): mirror is VerifiedWorkspaceMirror => Boolean(mirror));
  return { verifiedMirrors: available.length, ...(available[0]?.savedAt ? { latestVerifiedAt: available[0].savedAt } : {}) };
}

type FaceIdCredential = { rawId: ArrayBuffer; getClientExtensionResults?: () => AuthenticationExtensionsClientOutputs };
type FaceIdPrfOutputs = AuthenticationExtensionsClientOutputs & { prf?: { results?: { first?: ArrayBuffer } } };
const webAuthnAvailable = () => typeof window !== 'undefined' && Boolean(window.PublicKeyCredential && navigator.credentials);
const randomBytes = (size: number) => crypto.getRandomValues(new Uint8Array(size));
const arrayBuffer = (value: Uint8Array) => value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;

async function faceIdKey(credentialId: ArrayBuffer, salt: Uint8Array): Promise<Uint8Array> {
  if (!webAuthnAvailable()) throw new Error('Face ID is not available in this browser. Use your password instead.');
  const credential = await navigator.credentials.get({ publicKey: {
    challenge: randomBytes(32), allowCredentials: [{ type: 'public-key', id: credentialId }], userVerification: 'required', timeout: 60_000,
    extensions: { prf: { eval: { first: arrayBuffer(salt) } } } as AuthenticationExtensionsClientInputs,
  } }) as FaceIdCredential | null;
  const output = credential?.getClientExtensionResults?.() as FaceIdPrfOutputs | undefined;
  const secret = output?.prf?.results?.first;
  if (!secret) throw new Error('Face ID cannot provide a protected unlock key on this device. Use your password instead.');
  return new Uint8Array(await crypto.subtle.digest('SHA-256', secret));
}

export async function faceIdStatus(): Promise<'available' | 'unsupported' | 'configured'> {
  if (!webAuthnAvailable()) return 'unsupported';
  if (await getRecord<FaceIdUnlockRecord>(FACE_ID_KEY)) return 'configured';
  try { return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable() ? 'available' : 'unsupported'; }
  catch { return 'unsupported'; }
}

/** Enables Face ID/Touch ID only as a local convenience unlock. Password recovery always remains available. */
export async function enableFaceIdUnlock(dataKey: Uint8Array): Promise<void> {
  if (!webAuthnAvailable()) throw new Error('Face ID is not available in this browser. Use your password instead.');
  if (!await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false)) throw new Error('This device has no available Face ID, Touch ID, or secure screen lock. Use your password instead.');
  const salt = randomBytes(32);
  const credential = await navigator.credentials.create({ publicKey: {
    challenge: randomBytes(32), rp: { name: 'Universal Task Manager' },
    user: { id: arrayBuffer(randomBytes(32)), name: 'universal-local-unlock', displayName: 'Universal local unlock' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' }, timeout: 60_000,
    extensions: { prf: { eval: { first: arrayBuffer(salt) } } } as AuthenticationExtensionsClientInputs,
  } }) as FaceIdCredential | null;
  if (!credential) throw new Error('Face ID setup was cancelled. Your password still works.');
  const key = await faceIdKey(credential.rawId, salt);
  try {
    const wrappedDataKey = await encryptWithKey(dataKey, key, FACE_ID_AAD);
    await putRecords([[FACE_ID_KEY, { version: 1, credentialId: toBase64(new Uint8Array(credential.rawId)), salt: toBase64(salt), wrappedDataKey, createdAt: new Date().toISOString() } satisfies FaceIdUnlockRecord]]);
  } finally { key.fill(0); }
}

export async function disableFaceIdUnlock(): Promise<void> { await transactRecords([], [FACE_ID_KEY]); }

export async function unlockLocalWorkspaceWithFaceId(): Promise<UnlockedWorkspace> {
  const record = await getRecord<FaceIdUnlockRecord>(FACE_ID_KEY);
  const metadata = await getRecord<LocalMetadata>(META_KEY);
  const block = await getRecord<LocalBlock>(BLOCK_KEY);
  if (!record || !metadata || !block || metadata.mode === 'plaintext' || isPlaintextBlock(block)) throw new Error('Face ID is not configured. Use your password instead.');
  let biometricKey: Uint8Array | undefined;
  let dataKey: Uint8Array | undefined;
  try {
    biometricKey = await faceIdKey(arrayBuffer(fromBase64(record.credentialId)), fromBase64(record.salt));
    dataKey = await decryptWithKey(record.wrappedDataKey, biometricKey, FACE_ID_AAD);
    const document = Automerge.load<WorkspaceDocument>(await decryptLocalBlock(block, dataKey));
    return { document, dataKey, storageMode: 'encrypted' };
  } catch (reason) {
    dataKey?.fill(0);
    throw reason instanceof Error ? reason : new Error('Face ID unlock failed. Use your password instead.');
  } finally { biometricKey?.fill(0); }
}

export async function hasLocalWorkspace(): Promise<boolean> { return Boolean(await getRecord<LocalMetadata>(META_KEY) ?? await latestVerifiedMirror()); }

/** A plaintext workspace is deliberately opt-in and meant only for local testing. */
export async function localWorkspaceMode(): Promise<'encrypted' | 'plaintext' | null> {
  const metadata = await getRecord<LocalMetadata>(META_KEY) ?? (await latestVerifiedMirror())?.metadata;
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
  await verifyEncryptedDocument({ version: 1, ...encrypted }, dataKey);
  const metadata: EncryptedLocalMetadata = { version: 1, wrappedKey, createdAt: new Date().toISOString() };
  const block = { version: 1, ...encrypted } satisfies EncryptedLocalBlock;
  await putRecords([[META_KEY, metadata], [BLOCK_KEY, block]]);
  await saveVerifiedMirror(metadata, block);
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
  if (metadata?.mode === 'plaintext' || (block && isPlaintextBlock(block))) throw new Error('This local workspace is configured without encryption');
  const mirror = await latestVerifiedMirror();
  const candidates = [metadata && block && !isPlaintextBlock(block) ? { metadata, workspace: block, mirrored: false } : undefined, mirror ? { ...mirror, mirrored: true } : undefined].filter(Boolean) as Array<{ metadata: EncryptedLocalMetadata; workspace: EncryptedLocalBlock; mirrored: boolean }>;
  if (!candidates.length) throw new Error('No local workspace exists');
  let lastError: unknown;
  for (const candidate of candidates) {
    let dataKey: Uint8Array | undefined;
    try {
      dataKey = await unwrapLocalKey(candidate.metadata.wrappedKey, password);
      const document = Automerge.load<WorkspaceDocument>(await decryptLocalBlock(candidate.workspace, dataKey));
      if (candidate.mirrored) await putRecords([[META_KEY, candidate.metadata], [BLOCK_KEY, candidate.workspace]]);
      return { document, dataKey, storageMode: 'encrypted' };
    } catch (reason) { if (dataKey) dataKey.fill(0); lastError = reason; }
  }
  throw lastError instanceof Error ? lastError : new Error('Encrypted local workspace could not be opened');
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
  const block = { version: 1, ...encrypted } satisfies EncryptedLocalBlock;
  await verifyEncryptedDocument(block, dataKey);
  const metadata = await getRecord<EncryptedLocalMetadata>(META_KEY);
  if (!metadata) throw new Error('Encrypted workspace metadata is missing');
  await putRecords([[BLOCK_KEY, block]]);
  await saveVerifiedMirror(metadata, block);
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
  if (metadata.mode !== 'plaintext' && !isPlaintextBlock(nextBlock)) await saveVerifiedMirror(metadata, nextBlock);
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
  await saveVerifiedMirror(snapshot.metadata, snapshot.workspace);
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
    await transactRecords([[META_KEY, metadata], [BLOCK_KEY, block]], [FACE_ID_KEY]);
    await saveVerifiedMirror(metadata, block);
    return { document, dataKey, storageMode: 'encrypted' };
  }
  const incoming = await unlock(source, password);
  const dataKey = await randomKey();
  const metadata: EncryptedLocalMetadata = { version: 1, wrappedKey: await wrapKey(dataKey, password), createdAt: new Date().toISOString() };
  const encrypted = await encryptWithKey(Automerge.save(incoming.document), dataKey, BLOCK_AAD);
  await verifyEncryptedDocument({ version: 1, ...encrypted }, dataKey);
  const block = { version: 1, ...encrypted } satisfies EncryptedLocalBlock;
  await transactRecords([[META_KEY, metadata], [BLOCK_KEY, block]], [FACE_ID_KEY]);
  await saveVerifiedMirror(metadata, block);
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
  throw new Error('Choose an encrypted UTM backup (.utmb)');
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
  await verifyEncryptedDocument({ version: 1, ...encrypted }, dataKey);
  const block = { version: 1, ...encrypted } satisfies EncryptedLocalBlock;
  await transactRecords([[META_KEY, metadata], [BLOCK_KEY, block]], [FACE_ID_KEY]);
  await saveVerifiedMirror(metadata, block);
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
  const mirror = await latestVerifiedMirror();
  const metadata = await getRecord<LocalMetadata>(META_KEY) ?? mirror?.metadata;
  const workspace = await getRecord<LocalBlock>(BLOCK_KEY) ?? mirror?.workspace;
  if (!metadata || !workspace || metadata.mode === 'plaintext' || isPlaintextBlock(workspace)) {
    throw new Error('No encrypted local workspace exists');
  }
  return JSON.stringify({ magic: 'UTM-LOCAL-ENCRYPTED', version: 1, exportedAt: new Date().toISOString(), metadata, workspace });
}

export function lock(unlocked: UnlockedWorkspace): void { unlocked.dataKey.fill(0); }

export const __testing = { DB_NAME, STORE, META_KEY, BLOCK_KEY, toBase64, fromBase64 };
