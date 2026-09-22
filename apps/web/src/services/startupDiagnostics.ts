import { APP_VERSION } from '@utm/core';
import { setEntryProgressObserver } from '@utm/sdk';
import { PENDING_SAVE_KEY } from './workspaceWriter';

export const STARTUP_LOG_KEY = 'utm:startup-log:v1';
export const STARTUP_PENDING_KEY = 'utm:startup-pending:v1';
export const STARTUP_DURABLE_PENDING_KEY = 'utm:startup-last-pending:v1';
type Stage = 'entry' | 'decrypt' | 'load' | 'storage-preparation' | 'migration' | 'recurrence' | 'apply-recurrence' | 'preparation' | 'persistence' | 'render';
type Phase = 'started' | 'completed' | 'failed';
type Source = 'local' | 'backup' | 'automatic' | 'safe';
type Entry = { at: string; attempt: string; version: string; build: string; source: Source; stage: Stage; phase: Phase; elapsedMs: number; bytes?: number; items?: number };
let attempt = '';
let source: Source = 'local';
let startedAt = 0;

export function readStartupLog(): Entry[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STARTUP_LOG_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.slice(-120).flatMap((entry): Entry[] => {
      if (!entry || typeof entry !== 'object' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(entry.at) || !/^[\da-f-]{36}$/.test(entry.attempt) || !/^\d+\.\d+\.\d+$/.test(entry.version)
        || !/^(?:local|[a-f\d]{7,40})$/.test(entry.build)
        || !['local', 'backup', 'automatic', 'safe'].includes(entry.source)
        || !['entry', 'decrypt', 'load', 'storage-preparation', 'migration', 'recurrence', 'apply-recurrence', 'preparation', 'persistence', 'render'].includes(entry.stage)
        || !['started', 'completed', 'failed'].includes(entry.phase) || !Number.isFinite(entry.elapsedMs)) return [];
      const safe: Entry = { at: entry.at, attempt: entry.attempt, version: entry.version, build: entry.build, source: entry.source, stage: entry.stage, phase: entry.phase, elapsedMs: Math.max(0, Math.floor(entry.elapsedMs)) };
      for (const key of ['bytes', 'items'] as const) if (typeof entry[key] === 'number' && Number.isFinite(entry[key]) && entry[key] >= 0) safe[key] = Math.floor(entry[key]);
      return [safe];
    });
  }
  catch { return []; }
}

/** A restart loses sessionStorage; the durable marker keeps the recovery offer. */
export function interruptedStartup(): boolean {
  try { return sessionStorage.getItem(STARTUP_PENDING_KEY) === '1' || Boolean(localStorage.getItem(STARTUP_DURABLE_PENDING_KEY)) || Boolean(localStorage.getItem(PENDING_SAVE_KEY)); } catch { return false; }
}

export function beginStartup(next: Source): void {
  source = next; attempt = crypto.randomUUID(); startedAt = performance.now();
  try { sessionStorage.setItem(STARTUP_PENDING_KEY, '1'); } catch { /* Best effort. */ }
  try { localStorage.setItem(STARTUP_DURABLE_PENDING_KEY, attempt); } catch { /* Best effort. */ }
  startupCheckpoint('entry', 'started');
}

export function startupCheckpoint(stage: Stage, phase: Phase, metrics: { bytes?: number; items?: number } = {}): void {
  if (!attempt) beginStartup('automatic');
  // Explicit numeric allow-list, not exception messages or serialized objects.
  const build = import.meta.env.VITE_COMMIT_SHA || 'local';
  const entry: Entry = { at: new Date().toISOString(), attempt, version: APP_VERSION, build: /^(?:local|[a-f\d]{7,40})$/.test(build) ? build : 'local', source, stage, phase, elapsedMs: Math.round(performance.now() - startedAt) };
  for (const key of ['bytes', 'items'] as const) {
    const value = metrics[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) entry[key] = Math.floor(value);
  }
  try {
    if (localStorage.getItem('utm:diagnostics-enabled:v1') === 'false') return;
    localStorage.setItem(STARTUP_LOG_KEY, JSON.stringify([...readStartupLog(), entry].slice(-120)));
    window.dispatchEvent(new Event('utm:diagnostics-changed'));
  } catch { /* Quota/private mode must not block entry. */ }
}

export function finishStartup(): void {
  startupCheckpoint('render', 'completed');
  try { sessionStorage.removeItem(STARTUP_PENDING_KEY); } catch { /* Best effort. */ }
  try { if (localStorage.getItem(STARTUP_DURABLE_PENDING_KEY) === attempt) localStorage.removeItem(STARTUP_DURABLE_PENDING_KEY); } catch { /* Best effort. */ }
}

export function clearStartupLog(): void {
  try { localStorage.removeItem(STARTUP_LOG_KEY); } catch { /* Preserve pending marker. */ }
}

export function failStartup(): void {
  startupCheckpoint('entry', 'failed');
  // Keep the marker so the next attempt offers recovery, including known failures.
}

setEntryProgressObserver(({ stage, phase, bytes }) => startupCheckpoint(stage, phase, bytes === undefined ? {} : { bytes }));
