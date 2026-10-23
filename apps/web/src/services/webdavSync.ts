import { APP_VERSION, createWorkspace, validateWorkspace, type WorkspaceDocument } from '@utm/core';
import { decryptBytes, encryptBytes } from '@utm/sdk';
import { acquireDavLock, davCreate, davRequest, davStatus, ensureDavFolder, type DavConnection } from './webdavTransport';
import { applySyncSnapshot, mergeSync, syncEqual, syncSnapshot, type SyncSnapshot, type SyncConflict } from './webdavMerge';
import { exportSafeDiagnostics } from './diagnosticsExport';
import { auditDav, snapshotEvidence, setDavDiagnosticsEnabled } from './webdavDiagnostics';
import { diagnosticFailureCode } from './diagnostics';

export interface DavSettings extends DavConnection { enabled: boolean; logs: boolean; syncPassword: string; deviceId: string; baseline?: SyncSnapshot; remoteCache?: { scope: string; etag: string; snapshot: SyncSnapshot } }
export interface DavPayload { format: 'utm-webdav-sync'; version: 1; workspaceId: string; schemaVersion: string; appVersion?: string; snapshot: SyncSnapshot }
export class DavConflict extends Error {
  constructor(public readonly conflicts: SyncConflict[], public readonly etag: string) { super('webdav-conflict'); }
}
const encoder = new TextEncoder(), decoder = new TextDecoder();
const aad = 'utm:webdav-sync:v1';
const strongEtag = (value: string | null | undefined): value is string => typeof value === 'string' && /^"[^"\r\n]*"$/.test(value);
async function cacheScope(settings: DavSettings, workspace: WorkspaceDocument): Promise<string> {
  const bytes = encoder.encode(JSON.stringify([settings.url, settings.folder, settings.username, settings.password, settings.syncPassword, workspace.workspaceId, workspace.schemaVersion]));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function davWorkspacePath(workspaceId: string): Promise<string> {
  if (!/^[a-f0-9-]{36}$/i.test(workspaceId)) throw new Error('webdav-invalid-workspace-code');
  const key = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(workspaceId))), byte => byte.toString(16).padStart(2, '0')).join('');
  return `workspace-${key}.json`;
}
/** Read only: importing must never publish an empty workspace over the remote one. */
export async function downloadDavWorkspace(settings: DavSettings, workspaceId: string): Promise<{ workspace: WorkspaceDocument; settings: DavSettings }> {
  const response = await davRequest(settings, 'GET', await davWorkspacePath(workspaceId));
  davStatus(response);
  const workspace = createWorkspace('WebDAV workspace');
  workspace.workspaceId = workspaceId;
  const payload = await decodeDavState(response.text, settings.syncPassword, workspace);
  applySyncSnapshot(workspace, payload.snapshot);
  return { workspace, settings: { ...settings, baseline: payload.snapshot } };
}
export async function encodeDavState(payload: DavPayload, password: string): Promise<string> {
  if (password.length < 10) throw new Error('webdav-sync-password');
  return JSON.stringify({ magic: 'UTM-WEBDAV', version: 1, envelope: await encryptBytes(encoder.encode(JSON.stringify(payload)), password, aad) });
}
export async function decodeDavState(source: string, password: string, workspace: WorkspaceDocument): Promise<DavPayload> {
  let payload: DavPayload;
  try {
    const wire = JSON.parse(source) as { magic: string; version: number; envelope: Parameters<typeof decryptBytes>[0] };
    if (wire.magic !== 'UTM-WEBDAV' || wire.version !== 1) throw new Error();
    if (wire.envelope?.kdf?.memoryBytes !== 19 * 1024 * 1024 || wire.envelope.kdf.operations !== 2 || wire.envelope.kdf.parallelism !== 1 || wire.envelope.kdf.algorithm !== 'argon2id13') throw new Error();
    payload = JSON.parse(decoder.decode(await decryptBytes(wire.envelope, password, aad))) as DavPayload;
  } catch { throw new Error('webdav-password-or-damaged-file'); }
  if (payload.format !== 'utm-webdav-sync' || payload.version !== 1) { auditDav('incompatible-protocol-blocked'); throw new Error('webdav-protocol-version'); }
  if (payload.workspaceId !== workspace.workspaceId) throw new Error('webdav-wrong-workspace');
  auditDav('remote-format', { producer: payload.appVersion ?? 'unknown', remoteSchema: payload.schemaVersion, localSchema: workspace.schemaVersion, protocol: payload.version });
  if (payload.schemaVersion !== workspace.schemaVersion) {
    auditDav('incompatible-schema-blocked', { remoteSchema: payload.schemaVersion, localSchema: workspace.schemaVersion });
    throw new Error('webdav-schema-version');
  }
  const expected = Object.keys(syncSnapshot(workspace)).sort();
  if (!payload.snapshot || !syncEqual(Object.keys(payload.snapshot).sort(), expected)) throw new Error('webdav-invalid-state');
  const inspect = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('webdav-invalid-state');
      inspect(child);
    }
  };
  inspect(payload.snapshot);
  const candidate = JSON.parse(JSON.stringify(workspace)) as WorkspaceDocument;
  try { applySyncSnapshot(candidate, payload.snapshot); } catch { throw new Error('webdav-invalid-state'); }
  if (!validateWorkspace(candidate).valid) throw new Error('webdav-invalid-state');
  // Even an authenticated peer must not reintroduce Google caches/outboxes.
  if (!syncEqual(syncSnapshot(candidate), payload.snapshot)) throw new Error('webdav-invalid-state');
  return payload;
}
export interface DavPorts {
  timing?: (stage: 'network' | 'decrypt' | 'encrypt' | 'merge' | 'local-save', durationMs: number) => void;
  progress?: (stage: 'checking' | 'downloading' | 'merging' | 'uploading' | 'saving') => void;
  getWorkspace: () => WorkspaceDocument | undefined;
  flush: () => Promise<void>;
  commit: (message: string, mutation: (draft: WorkspaceDocument) => void) => boolean;
  checkpoint: (settings: DavSettings) => Promise<void>;
}
let verifiedTransport: typeof fetch | undefined;
const verifiedConnections = new Set<string>();
const connectionKey = (settings: DavSettings) => JSON.stringify([settings.url, settings.folder, settings.username, settings.password]);
function connectionVerified(settings: DavSettings): boolean {
  if (verifiedTransport !== globalThis.fetch) { verifiedTransport = globalThis.fetch; verifiedConnections.clear(); }
  return verifiedConnections.has(connectionKey(settings));
}
export async function testDavConnection(settings: DavSettings): Promise<void> {
  connectionVerified(settings);
  await ensureDavFolder(settings);
  const path = `probe-${crypto.randomUUID()}.json`;
  const created = await davCreate(settings, path, '{"test":"utm-webdav-conditional-write"}');
  if (created.status === 412) throw new Error('webdav-conditional-writes-required');
  davStatus(created);
  const read = await davRequest(settings, 'GET', path); davStatus(read);
  if (!read.etag || read.etag.startsWith('W/')) throw new Error('webdav-etag-required');
  let cleanupEtag = read.etag;
  try {
    const duplicate = await davCreate(settings, path, '{}');
    const stale = await davRequest(settings, 'PUT', path, '{}', { etag: `"utm-never-match-${crypto.randomUUID()}"` });
    const checked = await davRequest(settings, 'GET', path); davStatus(checked);
    if (duplicate.status !== 412 || stale.status !== 412 || checked.text !== read.text) throw new Error('webdav-conditional-writes-required');
    // Some embedded servers race If-Match checks. Require a server-enforced
    // exclusive lock as well, including protection against tokenless writers.
    const bodies = ['{"test":"concurrent-a"}', '{"test":"concurrent-b"}'];
    const lease = await acquireDavLock(settings, path);
    try {
      const denied = await davRequest(settings, 'LOCK', path, '<?xml version="1.0"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockinfo>');
      const blocked = await davRequest(settings, 'PUT', path, bodies[1]);
      if ((denied.status >= 200 && denied.status < 300) || blocked.status !== 423) throw new Error('webdav-lock-required');
      await lease.refresh();
      davStatus(await davRequest(settings, 'PUT', path, bodies[0], { etag: read.etag, lockToken: lease.token }));
      const final = await davRequest(settings, 'GET', path); davStatus(final);
      if (final.text !== bodies[0] || !strongEtag(final.etag) || final.etag === read.etag) throw new Error('webdav-conditional-writes-required');
      cleanupEtag = final.etag;
    } finally { await lease.release(); }
    verifiedConnections.add(connectionKey(settings));
  } finally {
    // Delete only the random probe created by this check, and only while its
    // ETag still matches. A server without DELETE may retain this tiny probe.
    await davRequest(settings, 'DELETE', path, undefined, { etag: cleanupEtag }).catch(() => undefined);
  }
}
export async function runDavSync(settings: DavSettings, ports: DavPorts, choice?: { resolution: 'local' | 'remote'; etag: string }): Promise<{ settings: DavSettings; changed: boolean }> {
  setDavDiagnosticsEnabled(settings.logs);
  const runId = crypto.randomUUID();
  auditDav('sync-start', { runId, deviceId: settings.deviceId, workspaceId: ports.getWorkspace()?.workspaceId, baseline: Boolean(settings.baseline), cache: Boolean(settings.remoteCache), resolution: choice?.resolution });
  const timed = async <T,>(stage: 'network' | 'decrypt' | 'encrypt' | 'local-save', action: () => Promise<T>): Promise<T> => {
    const started = performance.now();
    try { return await action(); }
    catch (error) { auditDav('stage-failed', { runId, stage, category: diagnosticFailureCode(error), frames: error instanceof Error ? error.stack?.match(/[\w.-]+\.js:\d+:\d+/g)?.slice(0, 20) : undefined }); throw error; }
    finally { const durationMs = performance.now() - started; ports.timing?.(stage, durationMs); auditDav('stage', { runId, stage, durationMs }); }
  };
  await timed('local-save', () => ports.flush());
  ports.progress?.('checking');
  if (!connectionVerified(settings)) await timed('network', () => testDavConnection(settings));
  const original = ports.getWorkspace();
  if (!original) throw new Error('webdav-session-changed');
  const workspaceId = original.workspaceId;
  const scope = await cacheScope(settings, original);
  let cache = settings.remoteCache?.scope === scope && strongEtag(settings.remoteCache.etag) ? settings.remoteCache : undefined;
  const path = await davWorkspacePath(workspaceId);
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 100 + Math.floor(Math.random() * 400 * attempt)));
    const lease = await timed('network', () => acquireDavLock(settings, path));
    try {
    const source = ports.getWorkspace();
    if (!source || source.workspaceId !== workspaceId) throw new Error('webdav-session-changed');
    const local = syncSnapshot(source);
    ports.progress?.('downloading');
    let response = await timed('network', () => davRequest(settings, 'GET', path, undefined, cache ? { ifNoneMatch: cache.etag } : undefined));
    // LOCK may create a new empty lock-null resource. Only its creator may
    // initialize that empty resource; an existing empty file remains an error.
    if (lease.created && response.status === 200 && response.text === '') response = { ...response, status: 404 };
    // A 304 is usable only with the exact previously authenticated snapshot.
    if (response.status === 304 && (!cache || (response.etag !== null && response.etag !== cache.etag))) {
      cache = undefined;
      response = await timed('network', () => davRequest(settings, 'GET', path));
    }
    const notModified = response.status === 304 && cache !== undefined;
    if (response.status !== 404 && !notModified) davStatus(response);
    const etag = notModified ? cache!.etag : response.etag;
    if (response.status !== 404 && !strongEtag(etag)) throw new Error('webdav-etag-required');
    const remote = response.status === 404 ? local : notModified ? cache!.snapshot : (await timed('decrypt', () => decodeDavState(response.text, settings.syncPassword, source))).snapshot;
    cache = response.status !== 404 ? { scope, etag: etag!, snapshot: remote } : undefined;
    const selected = choice && choice.etag === etag ? choice.resolution : undefined;
    ports.progress?.('merging');
    const mergeStarted = performance.now();
    const merged = response.status === 404 ? { snapshot: local, conflicts: [] } : mergeSync(settings.baseline ?? {}, local, remote, selected);
    ports.timing?.('merge', performance.now() - mergeStarted);
    if (settings.logs) auditDav('comparison', { runId, attempt, notModified, etag, baseline: settings.baseline ? await snapshotEvidence(settings.baseline) : null, local: await snapshotEvidence(local), remote: await snapshotEvidence(remote), merged: await snapshotEvidence(merged.snapshot), conflicts: merged.conflicts.map(c => c.path) });
    const payload = (snapshot: SyncSnapshot): DavPayload => ({ format: 'utm-webdav-sync', version: 1, appVersion: APP_VERSION, workspaceId, schemaVersion: source.schemaVersion, snapshot });
    if (merged.conflicts.length && !selected) {
      // Preserve this device's branch before asking the user to resolve a
      // conflict. Never silently pick the newest clock or overwrite either side.
      const backup = await encodeDavState(payload(local), settings.syncPassword);
      davStatus(await davCreate(settings, `conflict-${settings.deviceId}-${crypto.randomUUID()}.json`, backup));
      const remoteBackup = await encodeDavState(payload(remote), settings.syncPassword);
      davStatus(await davCreate(settings, `conflict-remote-${crypto.randomUUID()}.json`, remoteBackup));
      throw new DavConflict(merged.conflicts, etag!);
    }
    const candidate = JSON.parse(JSON.stringify(source)) as WorkspaceDocument;
    applySyncSnapshot(candidate, merged.snapshot);
    if (!validateWorkspace(candidate).valid) throw new Error('webdav-invalid-merge');
    if (ports.getWorkspace() !== source) continue;
    const changed = !syncEqual(remote, merged.snapshot) || response.status === 404;
    if (response.status !== 404 && (changed || !syncEqual(local, merged.snapshot))) {
      const folder = await timed('network', () => davRequest(settings, 'MKCOL', 'recovery/'));
      if (folder.status !== 405) davStatus(folder);
      const prefix = `recovery/${settings.deviceId}-${runId}-${attempt}`;
      davStatus(await timed('network', async () => davCreate(settings, `${prefix}-local.json`, await encodeDavState(payload(local), settings.syncPassword))));
      if (response.status !== 404 && !syncEqual(local, remote)) davStatus(await timed('network', async () => davCreate(settings, `${prefix}-remote.json`, await encodeDavState(payload(remote), settings.syncPassword))));
      auditDav('recovery-saved', { runId, prefix });
      // The backup may take time. Re-read rather than replace edits typed meanwhile.
      if (ports.getWorkspace() !== source) continue;
    }
    if (changed) {
      ports.progress?.('uploading');
      const wire = await timed('encrypt', () => encodeDavState(payload(merged.snapshot), settings.syncPassword));
      if (ports.getWorkspace() !== source) continue;
      await timed('network', () => lease.refresh());
      const written = await timed('network', () => davRequest(settings, 'PUT', path, wire, { ...(response.status === 404 ? {} : { etag: etag! }), lockToken: lease.token }));
      if (written.status === 412) { auditDav('write-race-retry', { runId, attempt }); cache = undefined; continue; }
      davStatus(written);
      // A successful HTTP reply alone is not durable-state evidence. Read the
      // complete authenticated state back before advancing the local baseline.
      const verified = await timed('network', () => davRequest(settings, 'GET', path));
      davStatus(verified);
      if (!strongEtag(verified.etag) || (etag && verified.etag === etag)) {
        verifiedConnections.delete(connectionKey(settings));
        throw new Error('webdav-write-verification');
      }
      const readback = (await timed('decrypt', () => decodeDavState(verified.text, settings.syncPassword, source))).snapshot;
      if (!syncEqual(readback, merged.snapshot)) {
        auditDav('readback-newer-version', { runId, attempt, etag: verified.etag });
        if (written.etag && written.etag === verified.etag) {
          verifiedConnections.delete(connectionKey(settings));
          throw new Error('webdav-write-verification');
        }
        cache = undefined;
        continue;
      }
      cache = { scope, etag: verified.etag, snapshot: readback };
      auditDav('write-readback-confirmed', { runId, etag: verified.etag });
    }
    // Preserve local edits made while the network write was in progress.
    const current = ports.getWorkspace();
    if (!current || current.workspaceId !== workspaceId) throw new Error('webdav-session-changed');
    const followup = mergeSync(local, syncSnapshot(current), merged.snapshot);
    if (followup.conflicts.length) throw new DavConflict(followup.conflicts, etag ?? '');
    if (!syncEqual(syncSnapshot(current), followup.snapshot)) {
      if (!ports.commit('Merge WebDAV workspace', draft => applySyncSnapshot(draft, followup.snapshot))) throw new Error('webdav-local-save');
      await timed('local-save', () => ports.flush());
      auditDav('local-merge-durable', { runId });
    }
    const next = { ...settings, baseline: merged.snapshot };
    if (cache) next.remoteCache = cache;
    else delete next.remoteCache;
    // A 304 with unchanged workspace data keeps the existing encrypted
    // checkpoint and ETag. The caller still records the successful check time.
    const checkpointChanged = !syncEqual(settings.baseline ?? null, next.baseline ?? null)
      || !syncEqual(settings.remoteCache ?? null, next.remoteCache ?? null);
    if (checkpointChanged) {
      ports.progress?.('saving');
      await timed('local-save', () => ports.checkpoint(next));
    }
    auditDav('sync-complete', { runId, uploaded: changed, checkpointSaved: checkpointChanged, cacheEtag: cache?.etag });
    return { settings: next, changed };
    } finally {
      await timed('network', () => lease.release()).catch(error => { auditDav('lock-release-failed', { runId, code: error instanceof Error ? error.message : 'unexpected' }); });
    }
  }
  throw new Error('webdav-concurrent-write-retry');
}

export function safeDavLog(result: string, durationMs: number): object {
  // Keep device context useful for troubleshooting without uploading a raw
  // User-Agent, which can contain a surprisingly identifying fingerprint.
  const device = (() => {
    if (typeof navigator === 'undefined') return { platform: 'unknown', formFactor: 'unknown', browser: 'unknown', model: null };
    const ua = navigator.userAgent ?? '';
    const uaData = (navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean; model?: string } }).userAgentData;
    const platformSource = `${uaData?.platform ?? ''} ${navigator.platform ?? ''} ${ua}`;
    const platform = /iphone|ipad|ipod|ios/i.test(platformSource) ? 'iOS'
      : /android/i.test(platformSource) ? 'Android'
        : /macintosh|mac os/i.test(platformSource) ? 'macOS'
          : /windows/i.test(platformSource) ? 'Windows'
            : /linux/i.test(platformSource) ? 'Linux' : 'other';
    const formFactor = uaData?.mobile === true || /iphone|ipod|mobile/i.test(ua) ? 'phone'
      : /ipad|tablet/i.test(ua) || (platform === 'iOS' && /macintosh/i.test(ua) && navigator.maxTouchPoints > 1) ? 'tablet'
        : 'desktop';
    const browser = /edg\//i.test(ua) ? 'Edge'
      : /firefox\//i.test(ua) ? 'Firefox'
        : /crios\//i.test(ua) ? 'Chrome'
          : /chrome\//i.test(ua) ? 'Chrome'
            : /safari\//i.test(ua) ? 'Safari' : 'other';
    const model = typeof uaData?.model === 'string' && /^[\w .()-]{1,48}$/.test(uaData.model) ? uaData.model : null;
    return { platform, formFactor, browser, model };
  })();
  const entries = exportSafeDiagnostics();
  return { format: 'utm-safe-device-log', version: 2, appVersion: APP_VERSION, at: new Date().toISOString(), device, sync: { result: /^webdav-[a-z0-9-]+$/.test(result) ? result : 'webdav-unexpected', durationMs: Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : 0 }, entries };
}
export async function uploadDavLog(settings: DavSettings, log: object): Promise<void> {
  if (!settings.logs) return;
  const folder = await davRequest(settings, 'MKCOL', 'logs/'); if (folder.status !== 405) davStatus(folder);
  const text = JSON.stringify(log);
  davStatus(await davRequest(settings, 'PUT', `logs/device-${settings.deviceId}.json`, text));
  // Keep earlier evidence across app reinstalls, upgrades and bounded local journals.
  const stamp = new Date().toISOString().replace(/[^0-9TZ]/g, '');
  davStatus(await davCreate(settings, `logs/device-${settings.deviceId}-${stamp}-${crypto.randomUUID()}.json`, text));
}
