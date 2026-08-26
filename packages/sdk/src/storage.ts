import * as Automerge from '@automerge/automerge';
import { createWorkspace } from '@utm/core';
import type { WorkspaceDocument, WorkspaceLanguage } from '@utm/core';
import {
  decryptWithKey, encryptWithKey, fromBase64, randomKey, ready, toBase64, unwrapKey, wrapKey,
  type EncryptedEnvelope,
} from './crypto.js';
import { createAutomergeDocument, merge, unlock } from './container.js';

interface LocalMetadata { version: 1; wrappedKey: EncryptedEnvelope; createdAt: string }
interface LocalBlock { version: 1; nonce: string; ciphertext: string }
export interface UnlockedWorkspace { document: Automerge.Doc<WorkspaceDocument>; dataKey: Uint8Array }

const DB_NAME = 'utm-secure-v1';
const STORE = 'encrypted-records';
const META_KEY = 'metadata';
const BLOCK_KEY = 'workspace';
const BLOCK_AAD = 'utm:local:workspace:v1';

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

export async function hasLocalWorkspace(): Promise<boolean> { return Boolean(await getRecord<LocalMetadata>(META_KEY)); }

export async function createLocalWorkspace(password: string, name = 'My workspace', language: WorkspaceLanguage = 'en'): Promise<UnlockedWorkspace> {
  if (await hasLocalWorkspace()) throw new Error('A local workspace already exists');
  const dataKey = await randomKey();
  const wrappedKey = await wrapKey(dataKey, password);
  const workspace = createWorkspace(name);
  workspace.calendarPreferences.language = language;
  const document = createAutomergeDocument(workspace);
  const encrypted = await encryptWithKey(Automerge.save(document), dataKey, BLOCK_AAD);
  const metadata: LocalMetadata = { version: 1, wrappedKey, createdAt: new Date().toISOString() };
  await putRecords([[META_KEY, metadata], [BLOCK_KEY, { version: 1, ...encrypted } satisfies LocalBlock]]);
  return { document, dataKey };
}

export async function unlockLocalWorkspace(password: string): Promise<UnlockedWorkspace> {
  const metadata = await getRecord<LocalMetadata>(META_KEY);
  const block = await getRecord<LocalBlock>(BLOCK_KEY);
  if (!metadata || !block) throw new Error('No local workspace exists');
  const dataKey = await unwrapKey(metadata.wrappedKey, password);
  const binary = await decryptWithKey(block, dataKey, BLOCK_AAD);
  try { return { document: Automerge.load<WorkspaceDocument>(binary), dataKey }; }
  catch { throw new Error('Decrypted local workspace is damaged'); }
}

export async function saveLocalWorkspace(document: Automerge.Doc<WorkspaceDocument>, dataKey: Uint8Array): Promise<void> {
  const encrypted = await encryptWithKey(Automerge.save(document), dataKey, BLOCK_AAD);
  await putRecords([[BLOCK_KEY, { version: 1, ...encrypted } satisfies LocalBlock]]);
}

export async function importAsLocalWorkspace(source: string, password: string): Promise<UnlockedWorkspace> {
  if (await hasLocalWorkspace()) throw new Error('A local workspace already exists');
  const incoming = await unlock(source, password);
  const dataKey = await randomKey();
  const metadata: LocalMetadata = { version: 1, wrappedKey: await wrapKey(dataKey, password), createdAt: new Date().toISOString() };
  const encrypted = await encryptWithKey(Automerge.save(incoming.document), dataKey, BLOCK_AAD);
  await putRecords([[META_KEY, metadata], [BLOCK_KEY, { version: 1, ...encrypted } satisfies LocalBlock]]);
  return { document: incoming.document, dataKey };
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
  const metadata: LocalMetadata = { version: 1, wrappedKey: await wrapKey(dataKey, password), createdAt: new Date().toISOString() };
  const encrypted = await encryptWithKey(Automerge.save(incoming.document), dataKey, BLOCK_AAD);
  await putRecords([[META_KEY, metadata], [BLOCK_KEY, { version: 1, ...encrypted } satisfies LocalBlock]]);
  return { document: incoming.document, dataKey };
}

export async function mergeIntoLocalWorkspace(
  current: UnlockedWorkspace,
  source: string,
  password: string,
): Promise<{ unlocked: UnlockedWorkspace; changedItems: number }> {
  const merged = await merge(current.document, source, password);
  await saveLocalWorkspace(merged.document, current.dataKey);
  return { unlocked: { document: merged.document, dataKey: current.dataKey }, changedItems: merged.changedItems };
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  const metadata = await getRecord<LocalMetadata>(META_KEY);
  if (!metadata) throw new Error('No local workspace exists');
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

export function lock(unlocked: UnlockedWorkspace): void { unlocked.dataKey.fill(0); }

export const __testing = { DB_NAME, STORE, META_KEY, BLOCK_KEY, toBase64, fromBase64 };
