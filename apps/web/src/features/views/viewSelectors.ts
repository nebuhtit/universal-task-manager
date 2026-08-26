import { compileQuery, compileSort, listDefinitionFor, parseSortSource, serializeSortRules, type SavedView, type UniversalItem, type WorkspaceDocument } from '@utm/core';
import { isItemTemplate, relationContext } from '../items/fieldDisplay';

const recentlyDoneUntil = new Map<string, number>();
export const MANUAL_ORDER_EXTENSION = 'utm:manualOrder';

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

export function setRecentlyDone(itemId: string, until?: number): void {
  if (until === undefined) recentlyDoneUntil.delete(itemId);
  else recentlyDoneUntil.set(itemId, until);
}

export function effectiveWorkspaceNow(workspace: WorkspaceDocument, realNow = new Date()): Date {
  const clock = workspace.calendarPreferences.testClock;
  if (!clock?.enabled || !clock.secondsPerDay || !clock.startedAt || !clock.virtualAt) return realNow;
  const elapsed = Math.max(0, realNow.getTime() - new Date(clock.startedAt).getTime());
  return new Date(new Date(clock.virtualAt).getTime() + elapsed * 86_400_000 / clock.secondsPerDay);
}

export function selectViewItems(workspace: WorkspaceDocument, view?: SavedView, now = effectiveWorkspaceNow(workspace)): UniversalItem[] {
  const templateFilterRequested = Boolean(view && /\bisTemplate\b/.test(view.query.source));
  const available = Object.values(workspace.items).filter((item) => !item.deletedAt && (!view?.list || item.list === view.list) && (templateFilterRequested || !isItemTemplate(item)) && !(item.role === 'occurrence' && item.occurrence?.seriesId && workspace.items[item.occurrence.seriesId]?.habit));
  if (!view) return available.filter((item) => item.role !== 'series_template');

  let items: UniversalItem[];
  try {
    const predicate = compileQuery(view.query.source || 'true', (item) => relationContext(workspace, item), { timeZone: workspace.calendarPreferences.timezone, weekStartsOn: workspace.calendarPreferences.weekStartsOn });
    const matchingRows = available.filter((item) => {
      const visibleByQuery = item.role !== 'series_template' ? predicate(item, now) : Boolean(item.habit) && predicate({ ...item, role: 'standalone' }, now);
      const grace = item.state === 'done' && (recentlyDoneUntil.get(item.id) ?? 0) > now.getTime();
      return visibleByQuery || grace;
    });
    const matchingSeries = available.filter((item) => item.role === 'series_template' && !item.habit && predicate(item, now));
    const standalone = matchingRows.filter((item) => item.role !== 'occurrence');
    const occurrencesBySeries = new Map<string, UniversalItem[]>();
    matchingRows.filter((item) => item.role === 'occurrence').forEach((item) => {
      const seriesId = item.occurrence?.seriesId ?? item.id;
      occurrencesBySeries.set(seriesId, [...(occurrencesBySeries.get(seriesId) ?? []), item]);
    });
    const logicalOccurrences = [...occurrencesBySeries.values()].map((occurrences) => [...occurrences].sort((left, right) => {
      if (left.state === 'open' && right.state !== 'open') return -1;
      if (right.state === 'open' && left.state !== 'open') return 1;
      return new Date(right.occurrence?.recurrenceId ?? right.updatedAt).getTime() - new Date(left.occurrence?.recurrenceId ?? left.updatedAt).getTime();
    })[0]!);
    const combined = [...standalone, ...logicalOccurrences, ...matchingSeries.filter((series) => !logicalOccurrences.some((item) => item.occurrence?.seriesId === series.id))];
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
  const sortSource = view.sortSource ?? (view.sort ?? []).map((sort) => `${sort.field} ${sort.direction} nulls ${sort.nulls ?? 'last'}`).join('\n');
  if (sortSource.trim()) {
    const rules = parseSortSource(sortSource);
    const usesListOrder = rules.some((rule) => rule.expression === 'listOrder');
    if (!usesListOrder) items.sort((left, right) => compileSort(sortSource)(left, right, now));
    else {
      const expanded = serializeSortRules(rules.flatMap((rule) => rule.expression === 'listOrder' ? [
        { ...rule, expression: 'custom.__utm_list_priority' },
        { ...rule, expression: 'custom.__utm_list_created_at' },
      ] : [rule]));
      const comparator = compileSort(expanded);
      const sortable = (item: UniversalItem): UniversalItem => {
        const definition = listDefinitionFor(workspace, item.list, now);
        return definition ? { ...item, custom: { ...item.custom, __utm_list_priority: definition.priority, __utm_list_created_at: definition.createdAt } } : item;
      };
      items.sort((left, right) => comparator(sortable(left), sortable(right), now));
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

export const defaultBoardStates = ['open', 'done', 'auto_closed', 'cancelled', 'archived'] as const;
export type BoardSettings = { states: Array<(typeof defaultBoardStates)[number]>; showEmpty: boolean; groupBy: 'status' | 'tag' };

export const boardSettingsFor = (view: SavedView): BoardSettings => {
  const raw = view.extensions?.['utm:board'];
  const candidate = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const states = Array.isArray(candidate.states) ? candidate.states.filter((state): state is BoardSettings['states'][number] => typeof state === 'string' && defaultBoardStates.includes(state as BoardSettings['states'][number])) : [];
  return { states: states.length ? states : [...defaultBoardStates], showEmpty: candidate.showEmpty === true, groupBy: candidate.groupBy === 'tag' ? 'tag' : 'status' };
};
