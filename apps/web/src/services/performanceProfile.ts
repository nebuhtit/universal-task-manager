import { APP_VERSION } from '@utm/core';

export const PERFORMANCE_PROFILE_KEY = 'utm:performance-profile:v1';
export const PROFILE_BATCH_MS = 10_000;
export const MAX_PROFILE_ACTIONS = 40;
const MAX_SPANS = 24;
const MAX_SAMPLES = 64;

// Only fixed vocabulary and numbers cross this boundary. Never pass a label,
// selector, expression, item/workspace ID, exception or an event's contents.
const stages = ['editor.catalog', 'editor.within-preview', 'editor.parse', 'editor.input', 'editor.preview', 'editor.suggestions', 'agenda.header-input', 'agenda.header-wait', 'agenda.header', 'agenda.input', 'agenda.project', 'reminders.prepare', 'notices.filter', 'save.worker-startup', 'save.worker-delivery', 'ui.dispatch', 'ui.handling', 'ui.commit-delay', 'ui.home-commit-delay', 'ui.calendar-commit-delay', 'ui.editor-commit-delay', 'ui.frame-opportunity', 'item.prepare', 'workspace.commit', 'workspace.index', 'view.evaluate', 'view.select', 'view.sort', 'home.deduplicate', 'calendar.evaluate', 'calendar.signature', 'calendar.map', 'calendar.project', 'calendar.group-project', 'calendar.timeline-prepare', 'calendar.plan', 'calendar.capacity', 'save.queue', 'save.serial-queue', 'save.total', 'save.prepare', 'save.serialize', 'save.snapshot', 'save.transfer', 'save.worker-wait', 'save.worker-work', 'save.worker-filter', 'save.worker-encode', 'save.encrypt', 'save.write', 'save.mirror', 'google.queue', 'google.download', 'google.snapshot', 'google.calculate', 'google.apply', 'google.persist', 'google.worker-work'] as const;
const metricKeys = ['scanned', 'matched', 'recalculated', 'days', 'rows', 'bytes', 'coalesced', 'failed', 'calls'] as const;
const caches = ['workspace.index', 'view.evaluation', 'calendar.mapping', 'calendar.range', 'calendar.group', 'calendar.day', 'calendar.plan', 'calendar.capacity', 'save.snapshot'] as const;
const reasons = ['empty', 'snapshot-not-indexed', 'workspace-timestamp', 'workspace-reference', 'view-reference', 'time-boundary', 'completion', 'schedule-signature', 'day-signature', 'range-not-cached', 'inputs', 'content-only', 'unchanged'] as const;
const actions = ['pointer', 'click', 'input', 'keydown', 'calendar-list', 'calendar-timeline', 'item-save', 'google-sync'] as const;
export type ProfileStage = typeof stages[number];
export type ProfileMetrics = Partial<Record<typeof metricKeys[number], number>>;
export type ProfileCache = typeof caches[number];
export type ProfileReason = typeof reasons[number];
export type ProfileActionKind = typeof actions[number];
type Span = { stage: ProfileStage; clock: 'main' | 'worker'; offsetMs?: number; durationMs: number; metrics: ProfileMetrics };
type Action = { id: number; kind: ProfileActionKind; at: string; dispatchMs: number; handlingMs?: number; firstCommitMs?: number; lastCommitMs?: number; commitObservations: number; frameMs?: number; spans: Span[]; omittedSpans: number; caches: CacheSummary[]; omittedCacheObservations: number };
type Aggregate = { stage: ProfileStage; count: number; totalMs: number; maxMs: number; p50Ms: number; p95Ms: number; sampleCount: number; metrics: ProfileMetrics };
type CacheSummary = { cache: ProfileCache; reason: ProfileReason; hits: number; misses: number; objects: number };
export type PerformanceProfile = { schemaVersion: 1; version: string; commit: string; dirty: boolean | 'unknown'; builtAt?: string; environment: 'ios' | 'web' | 'obsidian'; session: string; at: string; aggregates: Aggregate[]; caches: CacheSummary[]; actions: Action[] };
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const numeric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e12;
const round = (value: number) => Math.round(value * 100) / 100;
const safeMetrics = (source: ProfileMetrics): ProfileMetrics => {
  const result: ProfileMetrics = {};
  for (const key of metricKeys) if (numeric(source?.[key])) result[key] = round(source[key]!);
  return result;
};
const member = <T extends string>(values: readonly T[], value: unknown): value is T => values.includes(value as T);
const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value);

/** Read back only this schema's allowlisted values, even from modified storage. */
function sanitizeProfile(source: unknown): PerformanceProfile | undefined {
  if (!source || typeof source !== 'object') return;
  const value = source as PerformanceProfile;
  if (value.schemaVersion !== 1 || !/^\d+\.\d+\.\d+$/.test(value.version) || !/^(local|[a-f\d]{7,40})$/.test(value.commit)
    || !/^[a-f\d-]{36}$/.test(value.session) || !isDate(value.at) || !member(['ios', 'web', 'obsidian'], value.environment)) return;
  const aggregates = Array.isArray(value.aggregates) ? value.aggregates.slice(0, stages.length).flatMap(entry => {
    if (!entry || !member(stages, entry.stage) || ![entry.count, entry.totalMs, entry.maxMs, entry.p50Ms, entry.p95Ms, entry.sampleCount].every(numeric)) return [];
    return [{ stage: entry.stage, count: entry.count, totalMs: entry.totalMs, maxMs: entry.maxMs, p50Ms: entry.p50Ms, p95Ms: entry.p95Ms, sampleCount: entry.sampleCount, metrics: safeMetrics(entry.metrics) }];
  }) : [];
  const cacheEntries = Array.isArray(value.caches) ? value.caches.slice(0, caches.length * reasons.length).flatMap(entry => {
    if (!entry || !member(caches, entry.cache) || !member(reasons, entry.reason) || ![entry.hits, entry.misses, entry.objects].every(numeric)) return [];
    return [{ cache: entry.cache, reason: entry.reason, hits: entry.hits, misses: entry.misses, objects: entry.objects }];
  }) : [];
  const actionEntries = Array.isArray(value.actions) ? value.actions.slice(-MAX_PROFILE_ACTIONS).flatMap(entry => {
    if (!entry || !member(actions, entry.kind) || !isDate(entry.at) || ![entry.id, entry.dispatchMs, entry.commitObservations, entry.omittedSpans].every(numeric)) return [];
    const spans = Array.isArray(entry.spans) ? entry.spans.slice(0, MAX_SPANS).flatMap((span): Span[] => !span || !member(stages, span.stage) || !member(['main', 'worker'], span.clock) || !numeric(span.durationMs) || (span.clock === 'main' && !numeric(span.offsetMs)) ? []
      : [{ stage: span.stage, clock: span.clock, ...(span.clock === 'main' ? { offsetMs: span.offsetMs! } : {}), durationMs: span.durationMs, metrics: safeMetrics(span.metrics) }]) : [];
    const actionCaches = Array.isArray(entry.caches) ? entry.caches.slice(0, 12).flatMap(cache => !cache || !member(caches, cache.cache) || !member(reasons, cache.reason) || ![cache.hits, cache.misses, cache.objects].every(numeric) ? [] : [{ cache: cache.cache, reason: cache.reason, hits: cache.hits, misses: cache.misses, objects: cache.objects }]) : [];
    return [{ id: entry.id, kind: entry.kind, at: entry.at, dispatchMs: entry.dispatchMs, commitObservations: entry.commitObservations, omittedSpans: entry.omittedSpans, spans, caches: actionCaches, omittedCacheObservations: numeric(entry.omittedCacheObservations) ? entry.omittedCacheObservations : 0,
      ...(numeric(entry.handlingMs) ? { handlingMs: entry.handlingMs } : {}), ...(numeric(entry.firstCommitMs) ? { firstCommitMs: entry.firstCommitMs } : {}),
      ...(numeric(entry.lastCommitMs) ? { lastCommitMs: entry.lastCommitMs } : {}), ...(numeric(entry.frameMs) ? { frameMs: entry.frameMs } : {}) }];
  }) : [];
  return { schemaVersion: 1, version: value.version, commit: value.commit, dirty: typeof value.dirty === 'boolean' ? value.dirty : 'unknown', ...(isDate(value.builtAt) ? { builtAt: value.builtAt } : {}), environment: value.environment, session: value.session, at: value.at, aggregates, caches: cacheEntries, actions: actionEntries };
}

export function createPerformanceProfiler(options: { storage?: StoragePort; now?: () => number; date?: () => string; enabled?: boolean } = {}) {
  const now = options.now ?? (() => performance.now());
  const date = options.date ?? (() => new Date().toISOString());
  const session = crypto.randomUUID();
  let enabled = options.enabled ?? true, dirty = false, nextId = 0;
  let active: { action: Action; receivedAt: number } | undefined;
  const recent: { action: Action; receivedAt: number }[] = [];
  const totals = new Map<ProfileStage, { count: number; totalMs: number; maxMs: number; samples: number[]; metrics: ProfileMetrics }>();
  const cacheTotals = new Map<string, CacheSummary>();
  const stored = (): PerformanceProfile[] => {
    try {
      const raw = JSON.parse(options.storage?.getItem(PERFORMANCE_PROFILE_KEY) ?? '[]') as unknown;
      return Array.isArray(raw) ? raw.slice(-2).flatMap(entry => { const safe = sanitizeProfile(entry); return safe ? [safe] : []; }) : [];
    } catch { return []; }
  };
  const record = (stage: ProfileStage, durationMs: number, metrics: ProfileMetrics = {}, actionId: number | null | undefined = active?.action.id, startedAt: number | null = now() - durationMs) => {
    if (!enabled || !member(stages, stage) || !numeric(durationMs)) return;
    const safe = safeMetrics(metrics);
    const entry = totals.get(stage) ?? { count: 0, totalMs: 0, maxMs: 0, samples: [], metrics: {} };
    entry.count++; entry.totalMs += durationMs; entry.maxMs = Math.max(entry.maxMs, durationMs);
    if (entry.samples.length === MAX_SAMPLES) entry.samples.shift();
    entry.samples.push(durationMs);
    for (const key of metricKeys) if (safe[key] !== undefined) entry.metrics[key] = (entry.metrics[key] ?? 0) + safe[key]!;
    totals.set(stage, entry); dirty = true;
    const target = actionId === undefined ? undefined : recent.find(entry => entry.action.id === actionId);
    // UI milestones already have dedicated scalar fields on the action.
    // Keep the bounded span budget for calculations and background saving.
    if (target && !stage.startsWith('ui.')) {
      if (target.action.spans.length < MAX_SPANS) target.action.spans.push({ stage, clock: startedAt === null ? 'worker' : 'main', ...(startedAt === null ? {} : { offsetMs: round(Math.max(0, startedAt - target.receivedAt)) }), durationMs: round(durationMs), metrics: safe });
      else target.action.omittedSpans++;
    }
  };
  const snapshot = (): PerformanceProfile => ({
    schemaVersion: 1, version: APP_VERSION, commit: /^(local|[a-f\d]{7,40})$/.test(import.meta.env.VITE_COMMIT_SHA ?? '') ? import.meta.env.VITE_COMMIT_SHA : 'local',
    dirty: typeof import.meta.env.VITE_BUILD_DIRTY === 'boolean' ? import.meta.env.VITE_BUILD_DIRTY : 'unknown', ...(isDate(import.meta.env.VITE_BUILD_AT) ? { builtAt: import.meta.env.VITE_BUILD_AT } : {}),
    environment: import.meta.env.VITE_NATIVE_IOS === 'true' ? 'ios' : import.meta.env.VITE_OBSIDIAN === 'true' ? 'obsidian' : 'web', session, at: date(),
    aggregates: [...totals].map(([stage, value]) => {
      const samples = [...value.samples].sort((a, b) => a - b);
      const percentile = (fraction: number) => round(samples[Math.max(0, Math.ceil(samples.length * fraction) - 1)] ?? 0);
      return { stage, count: value.count, totalMs: round(value.totalMs), maxMs: round(value.maxMs), p50Ms: percentile(.5), p95Ms: percentile(.95), sampleCount: samples.length, metrics: { ...value.metrics } };
    }),
    caches: [...cacheTotals.values()].map(entry => ({ ...entry })),
    actions: recent.map(({ action }) => ({ ...action, spans: action.spans.map(span => ({ ...span, metrics: { ...span.metrics } })), caches: action.caches.map(entry => ({ ...entry })) })),
  });
  const read = () => [...stored().filter(entry => entry.session !== session), ...(totals.size || recent.length || cacheTotals.size ? [snapshot()] : [])].slice(-2);
  return {
    record,
    begin(stage: ProfileStage, actionId: number | null | undefined = active?.action.id) {
      if (!enabled) return (_metrics?: ProfileMetrics) => undefined;
      const startedAt = now(); let finished = false;
      return (metrics: ProfileMetrics = {}) => { if (!finished) { finished = true; record(stage, now() - startedAt, metrics, actionId, startedAt); } };
    },
    cache(cache: ProfileCache, hit: boolean, reason: ProfileReason, objects = 0) {
      if (!enabled || !member(caches, cache) || !member(reasons, reason)) return;
      const key = `${cache}:${reason}`;
      const entry = cacheTotals.get(key) ?? { cache, reason, hits: 0, misses: 0, objects: 0 };
      if (hit) entry.hits++; else entry.misses++;
      if (numeric(objects)) entry.objects += objects;
      cacheTotals.set(key, entry); dirty = true;
      if (active) {
        let observed = active.action.caches.find(entry => entry.cache === cache && entry.reason === reason);
        if (!observed && active.action.caches.length < 12) { observed = { cache, reason, hits: 0, misses: 0, objects: 0 }; active.action.caches.push(observed); }
        if (observed) { if (hit) observed.hits++; else observed.misses++; if (numeric(objects)) observed.objects += objects; }
        else active.action.omittedCacheObservations++;
      }
    },
    startAction(kind: ProfileActionKind, dispatchMs: number) {
      if (!enabled || !member(actions, kind)) return undefined;
      const receivedAt = now();
      const action: Action = { id: ++nextId, kind, at: date(), dispatchMs: numeric(dispatchMs) ? round(dispatchMs) : 0, commitObservations: 0, spans: [], omittedSpans: 0, caches: [], omittedCacheObservations: 0 };
      active = { action, receivedAt }; recent.push(active);
      if (recent.length > MAX_PROFILE_ACTIONS) recent.shift();
      record('ui.dispatch', action.dispatchMs, {}, action.id, receivedAt); dirty = true;
      return action.id;
    },
    labelAction(kind: ProfileActionKind) { if (enabled && active && member(actions, kind)) { active.action.kind = kind; dirty = true; } },
    actionId: () => enabled ? active?.action.id : undefined,
    abandonAction() { active = undefined; },
    handling(actionId: number) {
      const target = recent.find(entry => entry.action.id === actionId);
      if (!enabled || !target) return;
      target.action.handlingMs = round(now() - target.receivedAt);
      record('ui.handling', target.action.handlingMs, {}, actionId, target.receivedAt);
    },
    commit(surface: 'app' | 'home' | 'calendar' | 'editor' = 'app') {
      if (!enabled || !active) return;
      const delay = round(now() - active.receivedAt);
      active.action.firstCommitMs ??= delay; active.action.lastCommitMs = delay; active.action.commitObservations++;
      record(surface === 'app' ? 'ui.commit-delay' : `ui.${surface}-commit-delay`, delay, {}, active.action.id, active.receivedAt);
    },
    frame(actionId: number) {
      const target = recent.find(entry => entry.action.id === actionId);
      if (!enabled || !target) return;
      target.action.frameMs = round(now() - target.receivedAt);
      record('ui.frame-opportunity', target.action.frameMs, {}, actionId, target.receivedAt);
      if (active?.action.id === actionId) active = undefined;
    },
    read,
    flush() {
      if (!dirty) return;
      try { options.storage?.setItem(PERFORMANCE_PROFILE_KEY, JSON.stringify(read())); dirty = false; } catch { /* Keep the bounded in-memory profile for export/retry. */ }
    },
    setEnabled(value: boolean) { enabled = value; if (!value) active = undefined; },
    clear() { totals.clear(); cacheTotals.clear(); recent.length = 0; active = undefined; dirty = false; try { options.storage?.removeItem(PERFORMANCE_PROFILE_KEY); } catch { /* Optional diagnostics. */ } },
  };
}

let profiler: ReturnType<typeof createPerformanceProfiler> | undefined;
function current() {
  if (!profiler) {
    let storage: StoragePort | undefined;
    let enabled = typeof window !== 'undefined';
    try { storage = globalThis.localStorage; enabled = enabled && storage?.getItem('utm:diagnostics-enabled:v1') !== 'false'; } catch { /* Storage may be unavailable. */ }
    profiler = createPerformanceProfiler({ ...(storage ? { storage } : {}), enabled });
  }
  return profiler;
}
export const beginProfileSpan = (stage: ProfileStage, actionId?: number | null) => current().begin(stage, actionId);
export const recordProfileSpan = (stage: ProfileStage, durationMs: number, metrics: ProfileMetrics = {}, actionId?: number | null) => current().record(stage, durationMs, metrics, actionId);
export const recordWorkerProfileSpan = (stage: 'agenda.header' | 'save.worker-work' | 'save.worker-filter' | 'save.worker-encode' | 'google.worker-work', durationMs: number, metrics: ProfileMetrics = {}, actionId?: number | null) => current().record(stage, durationMs, metrics, actionId, null);
export const recordProfileCache = (cache: ProfileCache, hit: boolean, reason: ProfileReason, objects = 0) => current().cache(cache, hit, reason, objects);
export const currentProfileActionId = () => current().actionId();
export const labelProfileAction = (kind: ProfileActionKind) => current().labelAction(kind);
export const recordProfileCommit = (surface: 'app' | 'home' | 'calendar' | 'editor' = 'app') => current().commit(surface);
export const readPerformanceProfiles = () => current().read();
export const clearPerformanceProfiles = () => current().clear();
export const setPerformanceProfilingEnabled = (enabled: boolean) => current().setEnabled(enabled);

export function measureProfile<T>(stage: ProfileStage, operation: () => T, metrics?: (value: T) => ProfileMetrics, actionId?: number | null): T {
  const finish = beginProfileSpan(stage, actionId);
  try { const result = operation(); finish(metrics?.(result)); return result; }
  catch (reason) { finish({ failed: 1 }); throw reason; }
}

/** One scheduled write per batch; no logging write in an input/render callback. */
export function installPerformanceProfile(profile = current()) {
  let idle: number | undefined;
  const cancelIdle = () => { if (idle !== undefined) window.cancelIdleCallback?.(idle); idle = undefined; };
  const flush = () => { cancelIdle(); profile.flush(); };
  const timer = setInterval(() => {
    if (idle !== undefined) return;
    if (window.requestIdleCallback) idle = window.requestIdleCallback(() => { idle = undefined; profile.flush(); }, { timeout: PROFILE_BATCH_MS });
    else flush();
  }, PROFILE_BATCH_MS);
  const visibility = () => { if (document.visibilityState === 'hidden') { profile.abandonAction(); flush(); } };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', flush);
  return () => { clearInterval(timer); flush(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', flush); };
}

export const profileInput = {
  start: (kind: ProfileActionKind, dispatchMs: number) => current().startAction(kind, dispatchMs),
  handling: (id: number) => current().handling(id),
  frame: (id: number) => current().frame(id),
  abandon: () => current().abandonAction(),
};
