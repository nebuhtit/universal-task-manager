import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPerformanceProfiler, installPerformanceProfile, MAX_PROFILE_ACTIONS, PERFORMANCE_PROFILE_KEY, PROFILE_BATCH_MS } from './performanceProfile';

function fixture() {
  let now = 0;
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: vi.fn((key: string, value: string) => { values.set(key, value); }), removeItem: (key: string) => { values.delete(key); } };
  const profile = createPerformanceProfiler({ storage, now: () => now, date: () => '2026-09-30T12:00:00.000Z' });
  return { profile, storage, values, advance: (ms: number) => { now += ms; } };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('bounded performance profile', () => {
  it('links handler, calculation, commit and frame without merging asynchronous saves into a later action', () => {
    const { profile, advance } = fixture();
    const first = profile.startAction('click', 17)!;
    profile.labelAction('calendar-timeline');
    profile.cache('calendar.day', false, 'day-signature', 20);
    profile.cache('calendar.day', true, 'unchanged');
    const calculate = profile.begin('calendar.evaluate');
    advance(120); calculate({ rows: 200, matched: 30 });
    profile.handling(first);
    advance(60); profile.commit('calendar');
    advance(30); profile.frame(first);
    const save = profile.begin('save.total', first);
    const second = profile.startAction('input', 3)!;
    advance(400); save({ bytes: 1000 });
    // Worker duration uses its own clock and has no fabricated main offset.
    profile.record('save.worker-work', 40, {}, first, null);
    const [result] = profile.read();
    expect(result!.actions[0]).toMatchObject({ id: first, kind: 'calendar-timeline', dispatchMs: 17, handlingMs: 120, firstCommitMs: 180, lastCommitMs: 180, frameMs: 210 });
    expect(result!.actions[0]!.spans).toContainEqual({ stage: 'calendar.evaluate', clock: 'main', offsetMs: 0, durationMs: 120, metrics: { rows: 200, matched: 30 } });
    expect(result!.actions[0]!.spans).toContainEqual({ stage: 'save.worker-work', clock: 'worker', durationMs: 40, metrics: {} });
    expect(result!.actions[0]!.caches).toEqual([{ cache: 'calendar.day', reason: 'day-signature', hits: 0, misses: 1, objects: 20 }, { cache: 'calendar.day', reason: 'unchanged', hits: 1, misses: 0, objects: 0 }]);
    expect(result!.actions[1]!.id).toBe(second);
    expect(result!.actions[1]!.spans.some(span => span.stage === 'save.total')).toBe(false);
  });

  it('keeps fast measurements, bounded samples and explicit cache reasons', () => {
    const { profile } = fixture();
    for (let index = 1; index <= 100; index++) profile.record('view.evaluate', index, { scanned: 2 });
    profile.cache('calendar.day', false, 'day-signature', 12);
    profile.cache('calendar.day', true, 'unchanged');
    const [result] = profile.read();
    expect(result!.aggregates[0]).toMatchObject({ count: 100, totalMs: 5050, maxMs: 100, p50Ms: 68, p95Ms: 97, sampleCount: 64, metrics: { scanned: 200 } });
    expect(result!.caches).toEqual([{ cache: 'calendar.day', reason: 'day-signature', hits: 0, misses: 1, objects: 12 }, { cache: 'calendar.day', reason: 'unchanged', hits: 1, misses: 0, objects: 0 }]);
  });

  it('batches recording without writing storage during actions and exports the freshest values', () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
    const { profile, storage } = fixture();
    const uninstall = installPerformanceProfile(profile);
    try {
      for (let index = 0; index < 1000; index++) { profile.record('view.select', 5); profile.cache('workspace.index', true, 'unchanged'); }
      expect(storage.setItem).not.toHaveBeenCalled();
      vi.advanceTimersByTime(PROFILE_BATCH_MS);
      expect(storage.setItem).toHaveBeenCalledTimes(1);
      profile.record('view.select', 7);
      expect(profile.read().at(-1)!.aggregates[0]!.count).toBe(1001);
      expect(storage.setItem).toHaveBeenCalledTimes(1);
      Object.assign(document, { visibilityState: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      expect(storage.setItem).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(PROFILE_BATCH_MS);
      expect(storage.setItem).toHaveBeenCalledTimes(2);
    } finally { uninstall(); }
    expect(vi.getTimerCount()).toBe(0);
  });

  it('limits retained actions and spans without losing aggregate counts', () => {
    const { profile } = fixture();
    for (let index = 0; index < MAX_PROFILE_ACTIONS + 5; index++) {
      const id = profile.startAction('click', 0)!;
      for (let span = 0; span < 40; span++) profile.record('workspace.index', 1);
      profile.frame(id);
    }
    const [result] = profile.read();
    expect(result!.actions).toHaveLength(MAX_PROFILE_ACTIONS);
    expect(result!.actions[0]!.id).toBe(6);
    expect(result!.actions[0]!.spans).toHaveLength(24);
    expect(result!.actions[0]!.omittedSpans).toBeGreaterThan(0);
    expect(result!.aggregates.find(entry => entry.stage === 'workspace.index')!.count).toBe((MAX_PROFILE_ACTIONS + 5) * 40);
  });

  it('rejects free-form input, invalid numbers and extra fields when recording and reloading', () => {
    const { profile, storage, values } = fixture();
    profile.record('view.select', 12, { scanned: 2, bytes: Infinity, title: 'PRIVATE TITLE', token: 'SECRET' } as never);
    profile.record('SECRET' as never, 12);
    profile.cache('calendar.day', false, 'PRIVATE TITLE' as never);
    profile.record('view.sort', NaN);
    profile.flush();
    const saved = JSON.parse(values.get(PERFORMANCE_PROFILE_KEY)!) as Record<string, unknown>[];
    saved[0]!.title = 'PRIVATE TITLE';
    (saved[0]!.aggregates as Record<string, unknown>[])[0]!.error = 'SECRET';
    storage.setItem(PERFORMANCE_PROFILE_KEY, JSON.stringify(saved));
    const restored = createPerformanceProfiler({ storage });
    const report = JSON.stringify(restored.read());
    expect(report).not.toMatch(/PRIVATE TITLE|SECRET|Infinity|NaN/);
    expect(restored.read()[0]!.aggregates).toHaveLength(1);
    expect(restored.read()[0]!.aggregates[0]!.metrics).toEqual({ scanned: 2 });
  });

  it('retains one previous run, respects disabled diagnostics and clears pending data', () => {
    const { profile, storage } = fixture();
    profile.record('view.select', 5); profile.flush();
    const next = createPerformanceProfiler({ storage });
    next.record('view.sort', 10); next.flush();
    const third = createPerformanceProfiler({ storage });
    third.record('calendar.evaluate', 20);
    expect(third.read()).toHaveLength(2);
    third.setEnabled(false); third.record('calendar.evaluate', 30);
    expect(third.read().at(-1)!.aggregates[0]!.count).toBe(1);
    expect(third.startAction('click', 0)).toBeUndefined();
    third.clear(); third.flush();
    expect(third.read()).toEqual([]);
    expect(storage.getItem(PERFORMANCE_PROFILE_KEY)).toBeNull();
  });

  it('retains bounded memory data when storage throws', () => {
    const profile = createPerformanceProfiler({ storage: { getItem() { throw new Error('unavailable'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('unavailable'); } } });
    profile.record('save.write', 80);
    expect(() => profile.flush()).not.toThrow();
    expect(profile.read()[0]!.aggregates[0]!.maxMs).toBe(80);
    expect(() => profile.clear()).not.toThrow();
  });
});
