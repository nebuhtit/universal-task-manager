import * as Automerge from '@automerge/automerge';
import {
  calculateViewTimeMetrics,
  compileQuery,
  createOccurrence,
  fromCanonicalJSON,
  orderedOrganizationPriorityEntries,
  projectOccurrences,
  reconcileRecurrences,
  reminderTime,
  toCanonicalJSON,
  type ProjectedOccurrence,
  type SavedView,
  type UniversalItem,
  type WorkspaceDocument,
} from '@utm/core';
import { describe, expect, it } from 'vitest';
import { evaluateView, selectViewItems } from '../features/views/viewSelectors';
import { attentionSortValues } from '../features/views/viewSelectors';
import { evaluateCalendarRange } from '../features/calendar/calendarEvaluation';
import { commitWorkspaceDocument } from '../services/workspaceLifecycle';
import { getWorkspaceIndex } from '../services/workspaceIndex';
import { createPerformanceWorkspace, PERFORMANCE_NOW } from './performanceFixture';

const DAY_MS = 86_400_000;
const extended = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env?.UTM_PERF_BASELINE === '1';

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  const source = stable(value);
  let result = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    result ^= source.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(16).padStart(8, '0');
}

const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const dayView = (key: string): SavedView => ({
  id: `calendar:${key}`, name: key, renderer: 'list', fields: ['title'], sort: [
    { field: 'schedule.startAt', direction: 'asc', nulls: 'first' },
    { field: 'schedule.dueAt', direction: 'asc', nulls: 'first' },
  ], sortSource: 'schedule.startAt asc nulls first\nschedule.dueAt asc nulls first',
  query: { source: `scheduleInPeriod("custom", "event_open,event,active,due", false, 7, "${key}", "${key}") && (state == "open" || state == "done")` },
});

function projectedItem(workspace: WorkspaceDocument, row: ProjectedOccurrence): UniversalItem | null {
  const source = workspace.items[row.materializedItemId ?? row.sourceItemId];
  if (!source) return null;
  if (!row.virtual) return { ...source, schedule: structuredClone(row.schedule), state: row.state };
  if (!row.recurrenceId) return null;
  const item = createOccurrence(source, new Date(row.recurrenceId), 0);
  item.id = row.id; item.schedule = structuredClone(row.schedule); item.state = row.state;
  return item;
}

function calendarMembership(workspace: WorkspaceDocument) {
  const result = evaluateCalendarRange(workspace, '2026-08-31', '2026-09-07', {
    filter: { source: 'state == "open" || state == "done"' },
    scheduleSources: ['event_open', 'event', 'active', 'due'],
    fields: ['title'],
    sort: [
      { expression: 'schedule.startAt', direction: 'asc', nulls: 'first' },
      { expression: 'schedule.dueAt', direction: 'asc', nulls: 'first' },
    ],
    sortSource: 'schedule.startAt asc nulls first\nschedule.dueAt asc nulls first',
  }, PERFORMANCE_NOW);
  return Object.fromEntries(Object.entries(result.days).map(([key, day]) => [key, {
    ids: day.evaluation.items.map((item) => item.id),
    metrics: day.metrics,
  }]));
}

function referenceCalendarMembership(workspace: WorkspaceDocument) {
  const start = new Date('2026-08-31T00:00:00.000Z');
  const end = new Date(start.getTime() + 7 * DAY_MS);
  const items = projectOccurrences(workspace, start, end).map((row) => projectedItem(workspace, row)).filter((item): item is UniversalItem => Boolean(item));
  return Object.fromEntries(Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(start.getTime() + offset * DAY_MS);
    const key = dayKey(date); const view = dayView(key);
    const predicate = awaitCompileQuery(view.query.source, workspace);
    const selected = items.filter((item) => predicate(item, new Date(date.getTime() + 12 * 3_600_000))).sort((left, right) => {
      for (const field of ['startAt', 'dueAt'] as const) {
        const leftValue = left.schedule?.[field]; const rightValue = right.schedule?.[field];
        if (!leftValue && rightValue) return -1;
        if (leftValue && !rightValue) return 1;
        if (leftValue && rightValue) {
          const comparison = leftValue.localeCompare(rightValue);
          if (comparison) return comparison;
        }
      }
      return left.id.localeCompare(right.id);
    });
    const candidate = { ...workspace, items: Object.fromEntries(selected.map((item) => [item.id, item])) };
    return [key, { ids: selected.map((item) => item.id), metrics: calculateViewTimeMetrics(candidate, view, selected, PERFORMANCE_NOW) }];
  }));
}

function behaviorSnapshot(workspace: WorkspaceDocument, timings?: Record<string, number>) {
  const timed = <T,>(name: string, operation: () => T): T => {
    const started = performance.now(); const result = operation();
    if (timings) timings[name] = Math.round((performance.now() - started) * 100) / 100;
    return result;
  };
  const workspaceIndex = timed('workspaceIndexMs', () => getWorkspaceIndex(workspace));
  const views = timed('viewsAndStatisticsMs', () => Object.fromEntries(workspace.viewOrder.map((id) => {
    const view = workspace.views[id]!;
    const evaluation = evaluateView(workspace, view, PERFORMANCE_NOW);
    return [id, { ids: evaluation.items.map((item) => item.id), metrics: evaluation.metrics }];
  })));
  const calendar = timed('calendarWeekMs', () => calendarMembership(workspace));
  const reminderTimes = timed('remindersMs', () => Object.values(workspace.items).flatMap((item) => item.reminders.map((reminder) => [reminder.id, reminderTime(item, reminder)])));
  const priority = timed('unifiedPriorityMs', () => {
    return Object.values(workspace.items).map((item) => [item.id, workspaceIndex.organizationRankFor(item)]);
  });
  const recurrence = timed('recurrenceTickMs', () => reconcileRecurrences(structuredClone(workspace), PERFORMANCE_NOW));
  const portability = timed('exportImportMs', () => {
    const canonical = toCanonicalJSON(workspace, false);
    const imported = fromCanonicalJSON(canonical);
    return { bytes: canonical.length, itemCount: Object.keys(imported.items).length, viewOrder: imported.viewOrder };
  });
  return {
    views,
    calendar,
    reminders: reminderTimes,
    priority,
    recurrence: { created: recurrence.created.map((item) => item.id), updated: recurrence.updated.map((item) => item.id), autoClosed: recurrence.autoClosed.map((item) => item.id), removedIds: recurrence.removedIds },
    portability,
  };
}

function referenceOrganizationRanks(workspace: WorkspaceDocument): Map<string, number> {
  const order = orderedOrganizationPriorityEntries(workspace);
  const result = new Map<string, number>();
  for (const item of Object.values(workspace.items)) {
    const areas = new Set(item.areas ?? []); const projects = new Set(item.projects ?? []); const tags = new Set(item.tags);
    const index = order.findIndex((entry) => entry.kind === 'area'
      ? entry.name === null ? areas.size === 0 : areas.has(entry.name)
      : entry.kind === 'project'
        ? entry.name === null ? projects.size === 0 : projects.has(entry.name)
        : entry.name === null ? tags.size === 0 : tags.has(entry.name));
    result.set(item.id, index < 0 ? 0 : order.length - index);
  }
  return result;
}

function referenceViewIds(workspace: WorkspaceDocument, view: SavedView, ranks: ReadonlyMap<string, number>): string[] {
  const predicate = (awaitCompileQuery(view.query.source, workspace));
  return Object.values(workspace.items).filter((item) => !item.deletedAt && predicate(item, PERFORMANCE_NOW)).sort((left, right) => {
    const organization = (ranks.get(right.id) ?? 0) - (ranks.get(left.id) ?? 0);
    if (organization) return organization;
    const leftAttention = attentionSortValues(left, PERFORMANCE_NOW); const rightAttention = attentionSortValues(right, PERFORMANCE_NOW);
    if (leftAttention.bucket !== rightAttention.bucket) return leftAttention.bucket - rightAttention.bucket;
    const leftAt = leftAttention.at ?? Number.POSITIVE_INFINITY; const rightAt = rightAttention.at ?? Number.POSITIVE_INFINITY;
    if (leftAt !== rightAt) return leftAt - rightAt;
    if (leftAttention.durationMs !== rightAttention.durationMs) return rightAttention.durationMs - leftAttention.durationMs;
    const created = right.createdAt.localeCompare(left.createdAt);
    return created || left.id.localeCompare(right.id);
  }).map((item) => item.id);
}

function awaitCompileQuery(source: string, workspace: WorkspaceDocument) {
  // Imported lazily in spirit only: keeping the reference independent from the
  // production View selector avoids reproducing its current quadratic indexes.
  return compileQuery(source || 'true', undefined, { timeZone: workspace.calendarPreferences.timezone, weekStartsOn: workspace.calendarPreferences.weekStartsOn });
}

function referenceBehaviorSnapshot(workspace: WorkspaceDocument) {
  const ranks = referenceOrganizationRanks(workspace);
  const views = Object.fromEntries(workspace.viewOrder.map((id) => {
    const view = workspace.views[id]!;
    const ids = referenceViewIds(workspace, view, ranks);
    const items = ids.map((itemId) => workspace.items[itemId]!).filter(Boolean);
    return [id, { ids, metrics: calculateViewTimeMetrics(workspace, view, items, PERFORMANCE_NOW) }];
  }));
  const reminderTimes = Object.values(workspace.items).flatMap((item) => item.reminders.map((reminder) => [reminder.id, reminderTime(item, reminder)]));
  const recurrenceWorkspace = structuredClone(workspace);
  const recurrence = reconcileRecurrences(recurrenceWorkspace, PERFORMANCE_NOW);
  const canonical = toCanonicalJSON(workspace, false);
  return {
    views,
    calendar: referenceCalendarMembership(workspace),
    reminders: reminderTimes,
    priority: Object.values(workspace.items).map((item) => [item.id, ranks.get(item.id)]),
    recurrence: { created: recurrence.created.map((item) => item.id), updated: recurrence.updated.map((item) => item.id), autoClosed: recurrence.autoClosed.map((item) => item.id), removedIds: recurrence.removedIds },
    portability: { bytes: canonical.length, itemCount: Object.keys(fromCanonicalJSON(canonical).items).length },
  };
}

function expectSelectionMembershipToMatch(
  production: ReturnType<typeof behaviorSnapshot>,
  reference: ReturnType<typeof referenceBehaviorSnapshot>,
) {
  for (const [viewId, result] of Object.entries(production.views)) expect(result).toEqual(reference.views[viewId]);
  for (const [key, result] of Object.entries(production.calendar)) expect(result).toEqual(reference.calendar[key]);
}

const measure = async <T,>(operation: () => T | Promise<T>) => {
  const started = performance.now();
  const value = await operation();
  return { value, milliseconds: Math.round((performance.now() - started) * 100) / 100 };
};

const expectedBehaviorHashes: Record<number, string> = {
  100: 'a983a621',
  1_000: '9493f8f4',
  10_000: '3f8bf015',
};

const expectedReferenceHashes: Record<number, string> = {
  100: '51d0eea2',
  1_000: 'd8c705d0',
  10_000: '05656545',
};

describe('performance behavior baseline', () => {
  it('keeps the deterministic 100-item behavior contract', () => {
    const workspace = createPerformanceWorkspace(100);
    const snapshot = behaviorSnapshot(workspace);
    if (expectedBehaviorHashes[100] !== 'pending') expect(hash(snapshot)).toBe(expectedBehaviorHashes[100]);

    const ranks = referenceOrganizationRanks(workspace);
    for (const viewId of workspace.viewOrder) {
      const view = workspace.views[viewId]!;
      expect(selectViewItems(workspace, view, PERFORMANCE_NOW).map((item) => item.id)).toEqual(referenceViewIds(workspace, view, ranks));
    }

    const productionCalendar = calendarMembership(workspace);
    const referenceCalendar = referenceCalendarMembership(workspace);
    for (const key of Object.keys(productionCalendar)) {
      expect(productionCalendar[key]).toEqual(referenceCalendar[key]);
    }
  });

  it.skipIf(!extended)('records behavior and timing at 100, 1,000 and 10,000 items', async () => {
    let productionOverBudget = false;
    for (const itemCount of [100, 1_000, 10_000]) {
      const fixture = await measure(() => createPerformanceWorkspace(itemCount));
      const stages: Record<string, number> = {};
      const behavior = productionOverBudget ? null : await measure(() => behaviorSnapshot(fixture.value, stages));
      const reference = await measure(() => referenceBehaviorSnapshot(fixture.value));
      const automerge = await measure(() => Automerge.from(fixture.value as unknown as Record<string, unknown>) as Automerge.Doc<WorkspaceDocument>);
      const tickTargetId = Object.keys(fixture.value.items).find((id) => fixture.value.items[id]?.state === 'open' && fixture.value.items[id]?.role === 'standalone')!;
      const tick = await measure(() => commitWorkspaceDocument(automerge.value, 'Performance baseline item tick', (draft) => {
        const item = draft.items[tickTargetId]!;
        item.state = 'done'; item.updatedAt = PERFORMANCE_NOW.toISOString(); item.revision += 1;
        item.closure = { at: PERFORMANCE_NOW.toISOString(), actor: 'user', reason: 'manual' };
      }, PERFORMANCE_NOW));
      const save = await measure(() => Automerge.save(tick.value));
      const load = await measure(() => Automerge.load(save.value));
      const report = {
        itemCount,
        behaviorHash: behavior ? hash(behavior.value) : null,
        referenceHash: hash(reference.value),
        fixtureMs: fixture.milliseconds,
        behaviorMs: behavior?.milliseconds ?? null,
        behaviorStatus: behavior ? 'measured' : 'skipped-after-1000-over-budget',
        stages: behavior ? stages : null,
        referenceMs: reference.milliseconds,
        automergeFromMs: automerge.milliseconds,
        itemTickMs: tick.milliseconds,
        automergeSaveMs: save.milliseconds,
        automergeLoadMs: load.milliseconds,
        automergeBytes: save.value.byteLength,
      };
      console.info(`[utm-performance] ${JSON.stringify(report)}`);
      if (behavior && expectedBehaviorHashes[itemCount] !== 'pending') expect(report.behaviorHash).toBe(expectedBehaviorHashes[itemCount]);
      if (expectedReferenceHashes[itemCount] !== 'pending') expect(report.referenceHash).toBe(expectedReferenceHashes[itemCount]);
      if (behavior) expectSelectionMembershipToMatch(behavior.value, reference.value);
      expect(Object.keys(load.value as object).length).toBeGreaterThan(0);
      if (itemCount === 1_000 && behavior && behavior.milliseconds > 10_000) productionOverBudget = true;
    }
  }, 600_000);
});
