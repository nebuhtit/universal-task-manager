import { expect, it } from 'vitest';
import { createCalendarEvaluator, evaluateCalendarRange } from '../features/calendar/calendarEvaluation';
import { createPerformanceWorkspace, PERFORMANCE_NOW } from './performanceFixture';

const extended = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env?.UTM_PERF_BASELINE === '1';
it.skipIf(!extended)('compares incremental calendar with uncached results at 100/1000/10000 items', () => {
  for (const size of [100, 1000, 10000]) {
    const workspace = createPerformanceWorkspace(size);
    const cache = createCalendarEvaluator();
    const settings = workspace.calendarPreferences.dayView;
    const start = '2026-08-31', end = '2026-09-07';
    const measure = <T,>(fn: () => T) => { const at = performance.now(); const value = fn(); return { value, ms: +(performance.now() - at).toFixed(2) }; };
    const cold = measure(() => cache.evaluate(workspace, start, end, settings, PERFORMANCE_NOW));
    const later = new Date(+PERFORMANCE_NOW + 60_000);
    const warm = measure(() => cache.evaluate(workspace, start, end, settings, later));
    const reference = measure(() => evaluateCalendarRange(workspace, start, end, settings, later));
    expect(warm.value).toEqual(reference.value);
    const before = { ...cache.counters };
    const changed = structuredClone(workspace);
    const target = Object.values(changed.items).find(item => item.role !== 'series_template' && !item.occurrence && Object.values(warm.value.days).some(day => day.evaluation.items.some(row => row.id === item.id)))!;
    target.title += ' edited';
    const edit = measure(() => cache.evaluate(changed, start, end, settings, later));
    expect(edit.value).toEqual(evaluateCalendarRange(changed, start, end, settings, later));
    console.info('[calendar-cache]', JSON.stringify({ size, coldMs: cold.ms, repeatedEvaluationMs: warm.ms, uncachedMs: reference.ms, oneEditMs: edit.ms, before, after: cache.counters, projections: cache.projections.counters }));
  }
}, 120_000);
