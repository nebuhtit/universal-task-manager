import { useCallback, useEffect, useRef, useState } from 'react';
import { readLocalDeviceSecret, writeLocalDeviceSecret } from '@utm/sdk';
import type { WorkspaceDocument } from '@utm/core';
import { DavConflict, runDavSync, safeDavLog, testDavConnection, uploadDavLog, type DavSettings } from '../services/webdavSync';
import { davBase, hasLocalDavEndpoint } from '../services/webdavTransport';
import { recordDiagnostic } from '../services/diagnostics';
import { auditDav, setDavDiagnosticsEnabled } from '../services/webdavDiagnostics';

const davCode = (error: unknown) => error instanceof Error && /^webdav-[a-z0-9-]{1,80}$/.test(error.message) ? error.message : 'webdav-unexpected';
const logDav = (operation: 'connection' | 'sync' | 'log upload', outcome: 'started' | 'succeeded' | 'failed', code: string, durationMs?: number) => recordDiagnostic({
  operation: `WebDAV ${operation}`, kind: outcome === 'failed' ? 'error' : outcome === 'started' ? 'action' : 'result',
  outcome, message: `WebDAV ${operation} ${outcome}`, details: JSON.stringify({ code, network: networkType() }),
  ...(durationMs === undefined ? {} : { durationMs: Math.round(durationMs) }),
});
function networkType(): string {
  const connection = (navigator as Navigator & { connection?: { type?: string } }).connection;
  return ['wifi', 'cellular', 'ethernet', 'none'].includes(connection?.type ?? '') ? connection!.type! : navigator.onLine === false ? 'none' : 'unknown';
}

export function useWebDavSync(ports: { workspace: WorkspaceDocument | undefined; dataKey: Uint8Array | undefined; getWorkspace: () => WorkspaceDocument | undefined; flush: () => Promise<void>; commit: (message: string, mutation: (draft: WorkspaceDocument) => void) => boolean }) {
  const current = useRef(ports); current.current = ports;
  const [settings, setSettings] = useState<DavSettings | null>(null);
  const config = useRef<DavSettings | null>(null);
  const busy = useRef(false);
  const pending = useRef(false);
  const retryAt = useRef(0);
  const failures = useRef(0);
  const logBusy = useRef(false);
  const lastLog = useRef(0);
  const generation = useRef(0);
  const [status, setStatus] = useState('webdav-not-configured');
  const [running, setRunning] = useState(false);
  const [lastSuccess, setLastSuccess] = useState('');
  const [conflict, setConflict] = useState<DavConflict | null>(null);
  const [logError, setLogError] = useState(false);
  const workspaceId = ports.workspace?.workspaceId, dataKey = ports.dataKey;
  useEffect(() => {
    const epoch = ++generation.current;
    pending.current = false; retryAt.current = 0; failures.current = 0; lastLog.current = 0;
    config.current = null; setSettings(null); setConflict(null); setRunning(false); setLogError(false); setStatus('webdav-not-configured'); setLastSuccess('');
    if (!workspaceId || !dataKey) return;
    void readLocalDeviceSecret<DavSettings>(`webdav-${workspaceId}`, dataKey).then(value => {
      if (generation.current !== epoch || !value) return;
      davBase(value);
      if (!/^[a-f0-9-]{36}$/.test(value.deviceId) || value.syncPassword.length < 10) throw new Error();
      config.current = value; setSettings(value); setStatus(value.enabled ? 'webdav-ready' : 'webdav-paused');
      setDavDiagnosticsEnabled(value.logs); auditDav('session-open', { deviceId: value.deviceId });
    }).catch(() => { if (generation.current === epoch) setStatus('webdav-config-unreadable'); });
    return () => { auditDav('session-close'); setDavDiagnosticsEnabled(false); generation.current++; config.current = null; };
  }, [workspaceId, dataKey]);
  const persist = async (value: DavSettings, epoch: number) => {
    const key = current.current.dataKey, id = current.current.workspace?.workspaceId;
    if (!key || !id || epoch !== generation.current) throw new Error('webdav-session-changed');
    await writeLocalDeviceSecret(`webdav-${id}`, value, key);
    if (epoch !== generation.current) throw new Error('webdav-session-changed');
    config.current = value; setSettings(value);
    setDavDiagnosticsEnabled(value.logs);
  };
  const save = async (value: DavSettings) => {
    if (busy.current) throw new Error('webdav-busy');
    const epoch = generation.current;
    const old = config.current;
    const keepCheckpoint = old && old.url === value.url && old.folder === value.folder && old.syncPassword === value.syncPassword;
    const next = { ...value, deviceId: old?.deviceId ?? crypto.randomUUID(), ...(keepCheckpoint && old.baseline ? { baseline: old.baseline } : {}) };
    if (!keepCheckpoint) delete next.baseline;
    if (!keepCheckpoint || old?.username !== value.username || old?.password !== value.password) delete next.remoteCache;
    davBase(next);
    if (next.syncPassword.length < 10) throw new Error('webdav-sync-password');
    busy.current = true; setRunning(true); setStatus('webdav-testing');
    logDav('connection', 'started', 'webdav-testing');
    try { if (next.enabled) await testDavConnection(next); await persist(next, epoch); setConflict(null); setStatus(next.enabled ? 'webdav-ready' : 'webdav-paused'); logDav('connection', 'succeeded', next.enabled ? 'webdav-ready' : 'webdav-paused'); }
    catch (error) { logDav('connection', 'failed', davCode(error)); if (epoch === generation.current) setStatus(davCode(error)); throw error; }
    finally { busy.current = false; setRunning(false); }
  };
  const check = async (value: DavSettings) => {
    if (busy.current) return;
    const epoch = generation.current;
    busy.current = true; setRunning(true); setStatus('webdav-testing');
    logDav('connection', 'started', 'webdav-testing');
    try { await testDavConnection(value); logDav('connection', 'succeeded', 'webdav-ready'); if (epoch === generation.current) setStatus('webdav-ready'); }
    catch (error) { logDav('connection', 'failed', davCode(error)); if (epoch === generation.current) setStatus(davCode(error)); }
    finally { busy.current = false; if (epoch === generation.current) setRunning(false); }
  };
  const synchronize = useCallback(async (choice?: 'local' | 'remote') => {
    const value = config.current;
    if (!value) return;
    if (busy.current || (!choice && Date.now() < retryAt.current)) { auditDav('sync-queued', { busy: busy.current, retryAt: retryAt.current }); pending.current = true; return; }
    if (!navigator.onLine && hasLocalDavEndpoint(value)) auditDav('lan-sync-without-wan');
    pending.current = false;
    const epoch = generation.current;
    busy.current = true; setRunning(true); setStatus('webdav-syncing');
    const started = performance.now(); let result = 'webdav-succeeded';
    logDav('sync', 'started', 'webdav-syncing');
    try {
      await runDavSync(value, {
        timing: (stage, duration) => logDav('sync', 'succeeded', `webdav-stage-${stage}`, duration),
        progress: stage => { logDav('sync', 'started', `webdav-${stage}`); if (epoch === generation.current) setStatus(`webdav-${stage}`); },
        getWorkspace: () => epoch === generation.current ? current.current.getWorkspace() : undefined,
        flush: () => current.current.flush(),
        commit: (message, mutation) => epoch === generation.current && current.current.commit(message, mutation),
        checkpoint: next => persist(next, epoch),
      }, choice && conflict ? { resolution: choice, etag: conflict.etag } : undefined);
      if (epoch === generation.current) { failures.current = 0; retryAt.current = 0; setStatus(result); setLastSuccess(new Date().toISOString()); setConflict(null); }
    } catch (error) {
      result = error instanceof Error && /^webdav-[a-z0-9-]+$/.test(error.message) ? error.message : 'webdav-unexpected';
      if (epoch === generation.current && /network|timeout|http-5|http-423|http-412|server-busy|concurrent-write-retry/.test(result)) {
        retryAt.current = Date.now() + Math.min(300_000, 15_000 * 2 ** Math.min(failures.current++, 5));
        pending.current = true;
        auditDav('retry-delayed', { failures: failures.current, retryAt: retryAt.current, code: result });
      }
      auditDav('sync-failed', { code: result, durationMs: performance.now() - started });
      if (epoch === generation.current) { setStatus(result); if (error instanceof DavConflict) setConflict(error); }
    } finally {
      logDav('sync', result === 'webdav-succeeded' ? 'succeeded' : 'failed', result, performance.now() - started);
      busy.current = false; if (epoch === generation.current) setRunning(false);
      if (epoch === generation.current && value.logs && !logBusy.current && (result !== 'webdav-succeeded' || Date.now() - lastLog.current >= 300_000)) {
        logBusy.current = true; lastLog.current = Date.now();
        void uploadDavLog(value, safeDavLog(result, performance.now() - started)).then(() => {
          if (epoch === generation.current) setLogError(false);
        }).catch(error => {
          logDav('log upload', 'failed', davCode(error));
          if (epoch === generation.current) setLogError(true);
        }).finally(() => { logBusy.current = false; });
      }
    }
  }, [conflict]);
  useEffect(() => {
    if (!settings?.enabled || conflict) return;
    let nextPeriodic = 0;
    const networkReady = () => navigator.onLine || Boolean(config.current && hasLocalDavEndpoint(config.current));
    const run = () => { if (networkReady() && document.visibilityState === 'visible') { pending.current = true; void synchronize(); } };
    const timer = setInterval(() => {
      if (pending.current || Date.now() >= nextPeriodic) {
        nextPeriodic = Date.now() + 60_000;
        if (networkReady() && document.visibilityState === 'visible') void synchronize();
      }
    }, 1_000);
    window.addEventListener('online', run); window.addEventListener('focus', run);
    document.addEventListener('visibilitychange', run);
    run();
    return () => { clearInterval(timer); window.removeEventListener('online', run); window.removeEventListener('focus', run); document.removeEventListener('visibilitychange', run); };
  }, [settings?.enabled, synchronize]);
  useEffect(() => {
    if (!settings?.enabled || conflict || !ports.workspace) return;
    const timer = setTimeout(() => { if ((navigator.onLine || Boolean(config.current && hasLocalDavEndpoint(config.current))) && document.visibilityState === 'visible') void synchronize(); }, 5_000);
    return () => clearTimeout(timer);
  }, [ports.workspace, settings?.enabled, conflict, synchronize]);
  return { settings, save, check, synchronize, running, status, lastSuccess, conflict, logError, workspaceId };
}
export type WebDavController = ReturnType<typeof useWebDavSync>;
