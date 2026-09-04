import { calculateViewTimeMetrics, compileQuery, compileSort, effectiveItemDurationMs, effectiveWorkspaceNow, expressionContinuouslyDependsOnCurrentTime, expressionDependsOnCurrentTime, itemAreas, itemProjects, parseSortSource, participatesInTimeStatistics, serializeSortRules, type SavedView, type UniversalItem, type ViewSortRule, type ViewTimeMetrics, type WorkspaceDocument } from '@utm/core';
import { getWorkspaceIndex } from '../../services/workspaceIndex';
import { isItemTemplate } from '../items/fieldDisplay';

export const COMPLETION_EXIT_MS = 200;
export type CompletionHold = { previous: UniversalItem; undoUntil: number; removeAt: number };
const completionHolds = new Map<string, CompletionHold>();
const completionHoldListeners = new Set<() => void>();
let completionHoldVersion = 0;
export const MANUAL_ORDER_EXTENSION = 'utm:manualOrder';

export const subscribeCompletionHolds = (listener: () => void) => { completionHoldListeners.add(listener); return () => completionHoldListeners.delete(listener); };
export const completionHoldsSnapshot = () => completionHoldVersion;
const notifyCompletionHolds = () => { completionHoldVersion += 1; completionHoldListeners.forEach((listener) => listener()); };

export function manualOrderFor(view: SavedView): string[] {
  const value = view.extensions?.[MANUAL_ORDER_EXTENSION];
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))] : [];
}

export function mergeManualOrder(view: SavedView, visibleItemIds: string[], validItemIds?: ReadonlySet<string>): string[] {
  const visible = [...new Set(visibleItemIds)];
  const visibleSet = new Set(visible);
  return [...visible, ...manualOrderFor(view).filter((id) => !visibleSet.has(id) && (!validItemIds || validItemIds.has(id)))];
}

export function moveManualItem(itemIds: string[], draggedId: string, targetId: string, after = false): string[] {
  if (draggedId === targetId || !itemIds.includes(draggedId) || !itemIds.includes(targetId)) return itemIds;
  const next = itemIds.filter((id) => id !== draggedId);
  const targetIndex = next.indexOf(targetId);
  next.splice(targetIndex + (after ? 1 : 0), 0, draggedId);
  return next;
}

export function setCompletionHold(itemId: string, hold?: CompletionHold): void {
  if (hold === undefined) completionHolds.delete(itemId);
  else completionHolds.set(itemId, hold);
  notifyCompletionHolds();
}

function completionHoldFor(itemId: string, at = Date.now()): CompletionHold | undefined {
  const hold = completionHolds.get(itemId);
  if (!hold) return undefined;
  if (hold.removeAt <= at) {
    completionHolds.delete(itemId);
    return undefined;
  }
  return hold;
}

export const viewItemForEvaluation = (item: UniversalItem): UniversalItem => completionHoldFor(item.id)?.previous ?? item;

export function completionPhase(itemId: string, at = Date.now()): 'held' | 'exiting' | undefined {
  const hold = completionHoldFor(itemId, at);
  if (!hold) return undefined;
  return at < hold.undoUntil ? 'held' : 'exiting';
}

export type AttentionSortValues = { bucket: number; at?: number; durationMs: number };
export type ViewEvaluation = { items: UniversalItem[]; metrics: ViewTimeMetrics | null; now: Date };

const displayedTimeFields = new Set(['activeRange', 'activeRangeWhenSet', 'eventToday', 'eventThisWeek', 'dueTodayOrOverdue', 'dueThisWeekOrOverdue']);

function safeExpressionDependsOnTime(source: string): boolean {
  try { return expressionDependsOnCurrentTime(source); }
  catch { return false; }
}

function safeExpressionContinuouslyDependsOnTime(source: string): boolean {
  try { return expressionContinuouslyDependsOnCurrentTime(source); }
  catch { return false; }
}

function visibleViewScripts(view: SavedView) {
  return view.fields.includes('view_scripts')
    ? view.scripts ?? []
    : (view.scripts ?? []).filter((script) => view.fields.includes(`view_script.${script.key}`));
}

function visibleItemScripts(workspace: WorkspaceDocument, view: SavedView) {
  const itemScriptKeys = new Set(view.fields.filter((field) => field.startsWith('script.')).map((field) => field.slice(7)));
  if (!view.fields.includes('scripts') && !itemScriptKeys.size) return [];
  return getWorkspaceIndex(workspace).scripts.allItemDefinitions.filter((script) => view.fields.includes('scripts') || itemScriptKeys.has(script.key));
}

/** Conservatively detects whether a View can change while the workspace stays unchanged. */
export function viewDependsOnCurrentTime(workspace: WorkspaceDocument, view: SavedView): boolean {
  if (workspace.calendarPreferences.appearance.overdueAgeIndicator && getWorkspaceIndex(workspace).visibleItems.some((item) => item.state === 'open'
    && Boolean(item.schedule?.dueAt)
    && (!item.schedule?.startAt || !Number.isFinite(Date.parse(item.schedule.startAt))))) return true;
  if (safeExpressionDependsOnTime(view.query.source || 'true')) return true;
  const sortSource = view.sortSource ?? (view.sort ?? []).map((sort) => `${sort.field} ${sort.direction} nulls ${sort.nulls ?? 'last'}`).join('\n');
  if (/^\s*attentionOrder\b/m.test(sortSource)) return true;
  try { if (parseSortSource(sortSource).some((rule) => safeExpressionDependsOnTime(rule.expression))) return true; }
  catch { /* An invalid sort already produces an empty/error state and needs no live clock. */ }
  if (view.fields.some((field) => displayedTimeFields.has(field))) return true;

  if (visibleViewScripts(view).some((script) => safeExpressionDependsOnTime(script.source))) return true;

  if (visibleItemScripts(workspace, view).some((script) => safeExpressionDependsOnTime(script.source))) return true;
  return false;
}

/** Continuous clocks are reserved for expressions whose displayed value changes without crossing a date or schedule boundary. */
export function viewContinuouslyDependsOnCurrentTime(workspace: WorkspaceDocument, view: SavedView): boolean {
  if (safeExpressionContinuouslyDependsOnTime(view.query.source || 'true')) return true;
  const sortSource = view.sortSource ?? (view.sort ?? []).map((sort) => `${sort.field} ${sort.direction} nulls ${sort.nulls ?? 'last'}`).join('\n');
  try { if (parseSortSource(sortSource).some((rule) => safeExpressionContinuouslyDependsOnTime(rule.expression))) return true; }
  catch { return false; }
  if (visibleViewScripts(view).some((script) => safeExpressionContinuouslyDependsOnTime(script.source))) return true;
  return visibleItemScripts(workspace, view).some((script) => safeExpressionContinuouslyDependsOnTime(script.source));
}

export function evaluateView(workspace: WorkspaceDocument, view: SavedView, now = effectiveWorkspaceNow(workspace)): ViewEvaluation {
  const items = selectViewItems(workspace, view, now);
  const metrics = view.statistics?.showTime === false ? null : calculateViewTimeMetrics(workspace, view, items, now);
  return { items, metrics, now };
}

/** Stable time-attention tuple used by standard Views. Lower buckets are more urgent. */
export function attentionSortValues(item: UniversalItem, now = new Date()): AttentionSortValues {
  const current = now.getTime();
  const timestamp = (value?: string) => value ? Date.parse(value) : Number.NaN;
  const start = timestamp(item.schedule?.startAt);
  const end = timestamp(item.schedule?.endAt);
  const due = timestamp(item.schedule?.dueAt);
  const durationMs = participatesInTimeStatistics(item) ? effectiveItemDurationMs(item) : 0;
  if (item.state !== 'open') return { bucket: 4, durationMs };
  if (Number.isFinite(due) && due < current) return { bucket: 0, at: due, durationMs };
  if (Number.isFinite(start) && start <= current) {
    const closing = [end, due].filter((value) => Number.isFinite(value) && value >= current);
    if (closing.length) return { bucket: 1, at: Math.min(...closing), durationMs };
  }
  const upcoming = [start, due].filter((value) => Number.isFinite(value) && value >= current);
  if (upcoming.length) return { bucket: 2, at: Math.min(...upcoming), durationMs };
  return { bucket: 3, durationMs };
}

/** Sorts an already-filtered set without rescanning the workspace. */
export function sortViewItems(workspace: WorkspaceDocument, view: SavedView, sourceItems: Iterable<UniversalItem>, now = effectiveWorkspaceNow(workspace)): UniversalItem[] {
  const index = getWorkspaceIndex(workspace, true);
  const selectionSource = viewItemForEvaluation;
  const items = [...sourceItems];
  const sortSource = view.sortSource ?? (view.sort ?? []).map((sort) => `${sort.field} ${sort.direction} nulls ${sort.nulls ?? 'last'}`).join('\n');
  if (sortSource.trim()) {
    const rules = cachedSortRules(sortSource);
    const virtualSorts = new Set(rules.map((rule) => rule.expression).filter((expression) => ['listOrder', 'organizationOrder', 'areaOrder', 'projectOrder', 'tagOrder', 'attentionOrder', 'durationOrder'].includes(expression)));
    if (!virtualSorts.size) {
      const comparator = compileSort(sortSource);
      items.sort((left, right) => comparator(selectionSource(left), selectionSource(right), now));
    }
    else {
      const expanded = serializeSortRules(rules.flatMap((rule) => {
        if (!virtualSorts.has(rule.expression)) return [rule];
        if (rule.expression === 'organizationOrder') return [{ ...rule, expression: 'custom.__utm_organization_order' }];
        if (rule.expression === 'attentionOrder') return [
          { ...rule, expression: 'custom.__utm_attention_bucket' },
          { ...rule, expression: 'custom.__utm_attention_at' },
        ];
        if (rule.expression === 'durationOrder') return [{ ...rule, expression: 'custom.__utm_duration_order' }];
        const prefix = rule.expression === 'listOrder' ? 'list' : rule.expression === 'areaOrder' ? 'area' : rule.expression === 'projectOrder' ? 'project' : 'tag';
        if (prefix === 'tag') return [{ ...rule, expression: 'custom.__utm_tag_order' }];
        if (prefix === 'area' || prefix === 'project') return [{ ...rule, expression: `custom.__utm_${prefix}_order` }];
        return [
          { ...rule, expression: `custom.__utm_${prefix}_priority` },
          { ...rule, expression: `custom.__utm_${prefix}_order`, direction: 'asc' as const },
          { ...rule, expression: `custom.__utm_${prefix}_created_at` },
        ];
      }));
      const comparator = compileSort(expanded);
      const sortable = (item: UniversalItem): UniversalItem => {
        const list = index.listDefinitionFor(item.list, now);
        const tagRank = item.tags.length ? Math.max(...item.tags.map((tag) => index.rankFor('tag', tag))) : index.rankFor('tag', null);
        const attention = attentionSortValues(item, now);
        return { ...item, custom: {
          ...item.custom,
          ...(list ? { __utm_list_priority: list.priority, __utm_list_order: 0, __utm_list_created_at: list.createdAt } : {}),
          __utm_organization_order: index.organizationRankFor(item),
          __utm_attention_bucket: attention.bucket,
          __utm_attention_at: attention.at ?? null,
          __utm_duration_order: attention.durationMs,
          __utm_area_order: itemAreas(item).length ? Math.max(...itemAreas(item).map((area) => index.rankFor('area', area))) : index.rankFor('area', null),
          __utm_project_order: itemProjects(item).length ? Math.max(...itemProjects(item).map((project) => index.rankFor('project', project))) : index.rankFor('project', null),
          __utm_tag_order: tagRank,
        } };
      };
      const sortableItems = new Map(items.map((item) => [item.id, sortable(selectionSource(item))]));
      items.sort((left, right) => comparator(sortableItems.get(left.id)!, sortableItems.get(right.id)!, now));
    }
  }
  const manualOrder = manualOrderFor(view);
  if (manualOrder.length) {
    const positions = new Map(manualOrder.map((id, index) => [id, index]));
    items.sort((left, right) => {
      const leftPosition = positions.get(left.id);
      const rightPosition = positions.get(right.id);
      if (leftPosition === undefined && rightPosition === undefined) return 0;
      if (leftPosition === undefined) return 1;
      if (rightPosition === undefined) return -1;
      return leftPosition - rightPosition;
    });
  }
  return items;
}

export function selectViewItems(workspace: WorkspaceDocument, view?: SavedView, now = effectiveWorkspaceNow(workspace)): UniversalItem[] {
  const index = getWorkspaceIndex(workspace, true);
  const templateFilterRequested = Boolean(view && /\bisTemplate\b/.test(view.query.source));
  const selectionSource = viewItemForEvaluation;
  const available = index.visibleItems.filter((item) => {
    const source = selectionSource(item);
    return (!view?.list || source.list === view.list)
      && (!view?.area || itemAreas(source).includes(view.area))
      && (!view?.project || itemProjects(source).includes(view.project))
      && (templateFilterRequested || !isItemTemplate(source))
      && !(source.role === 'occurrence' && source.occurrence?.seriesId && index.itemById.get(source.occurrence.seriesId)?.habit);
  });
  if (!view) return available.filter((item) => item.role !== 'series_template');

  let items: UniversalItem[];
  try {
    const predicate = compileQuery(view.query.source || 'true', (item) => index.queryContextFor(item, now), { timeZone: workspace.calendarPreferences.timezone, weekStartsOn: workspace.calendarPreferences.weekStartsOn });
    const matchingRows = available.filter((item) => {
      const source = selectionSource(item);
      const queryItem = index.queryItemFor(source);
      return source.role !== 'series_template' ? predicate(queryItem, now) : Boolean(source.habit) && predicate({ ...queryItem, role: 'standalone' }, now);
    });
    const matchingSeries = available.filter((item) => {
      const source = selectionSource(item);
      if (source.role !== 'series_template' || source.habit) return false;
      // A source series is the fallback row before its live occurrence has
      // materialized. Evaluate it with the same stable series identity as an
      // occurrence, so an explicit `occurrence.seriesId != ...` exclusion
      // cannot disappear merely because reconciliation has not run yet.
      const queryItem = index.queryItemFor(source);
      return predicate({
        ...queryItem,
        occurrence: {
          seriesId: source.id,
          recurrenceId: source.schedule?.startAt ?? source.schedule?.dueAt ?? source.createdAt,
          sequence: 0,
          templateRevision: source.revision,
        },
      }, now);
    });
    const standalone = matchingRows.filter((item) => item.role !== 'occurrence');
    const occurrencesBySeries = new Map<string, UniversalItem[]>();
    matchingRows.filter((item) => item.role === 'occurrence').forEach((item) => {
      const seriesId = index.recurrence.seriesIdByOccurrenceId.get(item.id) ?? item.occurrence?.seriesId ?? item.id;
      occurrencesBySeries.set(seriesId, [...(occurrencesBySeries.get(seriesId) ?? []), item]);
    });
    const logicalOccurrences = [...occurrencesBySeries.values()].map((occurrences) => [...occurrences].sort((left, right) => {
      if (left.state === 'open' && right.state !== 'open') return -1;
      if (right.state === 'open' && left.state !== 'open') return 1;
      return new Date(right.occurrence?.recurrenceId ?? right.updatedAt).getTime() - new Date(left.occurrence?.recurrenceId ?? left.updatedAt).getTime();
    })[0]!);
    const representedSeries = new Set(logicalOccurrences.map((item) => item.occurrence?.seriesId).filter((id): id is string => Boolean(id)));
    const combined = [...standalone, ...logicalOccurrences, ...matchingSeries.filter((series) => !representedSeries.has(series.id))];
    const seenLogical = new Set<string>();
    items = combined.filter((item) => {
      const key = item.role === 'occurrence' && item.occurrence?.seriesId
        ? `occurrence:${item.occurrence.seriesId}:${item.occurrence.recurrenceId ?? item.schedule?.startAt ?? item.id}`
        : `item:${item.id}`;
      if (seenLogical.has(key)) return false;
      seenLogical.add(key);
      return true;
    });
  } catch {
    return [];
  }
  return sortViewItems(workspace, view, items, now);
}

const sortRulesCache = new Map<string, ViewSortRule[]>();
function cachedSortRules(source: string): ViewSortRule[] {
  const cached = sortRulesCache.get(source);
  if (cached) return cached;
  const rules = parseSortSource(source);
  if (sortRulesCache.size >= 256) sortRulesCache.delete(sortRulesCache.keys().next().value!);
  sortRulesCache.set(source, rules);
  return rules;
}

export const defaultBoardStates = ['open', 'done', 'auto_closed', 'cancelled', 'archived'] as const;
export type BoardSettings = { states: Array<(typeof defaultBoardStates)[number]>; showEmpty: boolean; groupBy: 'status' | 'tag' };

export const boardSettingsFor = (view: SavedView): BoardSettings => {
  const raw = view.extensions?.['utm:board'];
  const candidate = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const states = Array.isArray(candidate.states) ? candidate.states.filter((state): state is BoardSettings['states'][number] => typeof state === 'string' && defaultBoardStates.includes(state as BoardSettings['states'][number])) : [];
  return { states: states.length ? states : [...defaultBoardStates], showEmpty: candidate.showEmpty === true, groupBy: candidate.groupBy === 'tag' ? 'tag' : 'status' };
};
