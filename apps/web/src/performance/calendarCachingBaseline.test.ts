import { expect, it } from 'vitest';
import { createCalendarEvaluator, evaluateCalendarRange } from '../features/calendar/calendarEvaluation';
import { createPerformanceWorkspace, PERFORMANCE_NOW } from './performanceFixture';
import { createCalendarPageCache, prepareCalendarSlides } from '../features/calendar/calendarPageCache';
import { createCalendarProjectionCache, prepareCalendarProjectionBoundaries } from '../features/calendar/calendarProjectionCache';
import { completionHoldsSnapshot } from '../features/views/viewSelectors';

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

it.skipIf(!extended)('avoids cold main-thread boundary projection when promoting a worker-prepared week', () => {
  for (const size of [1000, 10000]) {
    const workspace = createPerformanceWorkspace(size), main = createCalendarPageCache(workspace.workspaceId);
    const start = '2026-09-07', end = '2026-09-14', selected = '2026-09-10';
    const measure = <T,>(fn: () => T) => { const at = performance.now(); const value = fn(); return { value, ms: +(performance.now() - at).toFixed(3) }; };
    const cold = measure(() => prepareCalendarProjectionBoundaries(createCalendarProjectionCache(), workspace, start, end, [selected]));
    const worker = prepareCalendarSlides(createCalendarPageCache(workspace.workspaceId), structuredClone(workspace), { ranges: [{ start, end }], timelines: [], now: +PERFORMANCE_NOW, capacityNow: +PERFORMANCE_NOW, allDayOpen: true });
    main.acceptPrepared(workspace, PERFORMANCE_NOW, PERFORMANCE_NOW, true, completionHoldsSnapshot(), structuredClone(worker));
    const warmed = measure(() => main.peekProjectionBoundaries(workspace, start, end, selected));
    expect(warmed.value).toEqual([...cold.value.period, ...cold.value.days[selected]!]);
    expect(main.evaluator.projections.counters.projections).toBe(0);
    console.info('[calendar-cold-week-boundaries]', JSON.stringify({ size, oldMainThreadMs: cold.ms, preparedReadMs: warmed.ms }));
  }
}, 120_000);

it.skipIf(!extended)('reuses prepared neighbouring slide bundles without repeating domain calculations', () => {
  for (const size of [100, 1000, 10000]) {
    const workspace = createPerformanceWorkspace(size), cache = createCalendarPageCache(workspace.workspaceId);
    const measure = <T,>(fn: () => T) => { const at = performance.now(); const value = fn(); return { value, ms: +(performance.now() - at).toFixed(3) }; };
    const cold = measure(() => cache.rangeFor(workspace, '2026-08-31', '2026-09-07', PERFORMANCE_NOW, PERFORMANCE_NOW, true));
    const preparation = measure(() => {
      cache.rangeFor(workspace, '2026-09-07', '2026-09-14', PERFORMANCE_NOW, PERFORMANCE_NOW, true);
      cache.rangeFor(workspace, '2026-08-24', '2026-08-31', PERFORMANCE_NOW, PERFORMANCE_NOW, true);
      for (const key of ['2026-09-03', '2026-09-04', '2026-09-02']) cache.timelineFor(workspace, key, PERFORMANCE_NOW);
    });
    const before = { ...cache.evaluator.counters, ...cache.evaluator.projections.counters };
    const warm = measure(() => cache.rangeFor(workspace, '2026-08-31', '2026-09-07', PERFORMANCE_NOW, PERFORMANCE_NOW, true));
    expect(warm.value).toBe(cold.value);
    expect({ ...cache.evaluator.counters, ...cache.evaluator.projections.counters }).toEqual(before);
    console.info('[calendar-adjacent-slides]', JSON.stringify({ size, selectedRangeMs: cold.ms, twoIdleJobsMs: preparation.ms, preparedRangeReadMs: warm.ms }));
  }
}, 120_000);
