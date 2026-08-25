import { compileQuery, compileSort, type SavedView, type UniversalItem, type WorkspaceDocument } from '@utm/core';
import { isItemTemplate, relationContext } from '../items/fieldDisplay';

const recentlyDoneUntil = new Map<string, number>();

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
    const predicate = compileQuery(view.query.source || 'true', (item) => relationContext(workspace, item));
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
  if (sortSource.trim()) items.sort((left, right) => compileSort(sortSource)(left, right, now));
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
