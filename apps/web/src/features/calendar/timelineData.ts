import { compileQuery, createOccurrence, effectiveItemDurationMs, googleCalendarProjection, plannedDateForDisplay, projectOccurrences, type UniversalItem, type WorkspaceDocument } from '@utm/core';
import { getWorkspaceIndex } from '../../services/workspaceIndex';
import { itemDeletionTime } from '@utm/core';
import { isItemTemplate } from '../items/fieldDisplay';
import { viewItemForEvaluation } from '../views/viewSelectors';
import { dayBounds, hiddenIntervals, intersects, itemInterval, travelInterval, type TimelineEvent } from './timelineLayout';
import { planUndatedTasks } from './timelinePlanning';
import { isCompletelyUndated, showUndatedItem, showOverdueToday } from './calendarVisibility';

export function timelineData(workspace: WorkspaceDocument, key: string, now: Date) {
  const preferences = workspace.calendarPreferences;
  const day = dayBounds(key, preferences.timezone);
  const mapped = { ...workspace, items: Object.fromEntries(Object.values(workspace.items).map(item => [item.id, googleCalendarProjection(item)])) };
  const items = Object.values(mapped.items).filter(item => !itemDeletionTime(mapped, item));
  // A finite padded projection catches overnight and long Duration occurrences.
  // Extremely long recurring spans are explicitly reported, never expanded unboundedly.
  const desiredPadding = Math.max(86_400_000, ...items.filter(item => item.role === 'series_template').map(item => Math.max(effectiveItemDurationMs(item), Math.max(0, Date.parse(item.schedule?.dueAt ?? '') - Date.parse(item.schedule?.startAt ?? '')) || 0)));
  const padding = Math.min(desiredPadding, 366 * 86_400_000);
  const projected = projectOccurrences(mapped, new Date(day.start - padding), new Date(day.end + padding));
  const candidates = new Map<string, UniversalItem>();
  for (const row of projected) {
    const source = mapped.items[row.materializedItemId ?? row.sourceItemId];
    if (!source) continue;
    const item = row.virtual && row.recurrenceId ? createOccurrence(source, new Date(row.recurrenceId), 0) : source;
    candidates.set(row.id, { ...item, id: row.id, schedule: { ...row.schedule }, state: row.state });
  }
  // Includes end-only, undated and moved materialized instances omitted by the
  // legacy date-range projector, without generating duplicate series templates.
  for (const item of items) if (item.role !== 'series_template' || (!item.schedule?.plannedDate && !itemInterval(item))) candidates.set(item.id, item);
  // Legacy documents can contain an occurrence promoted to a nested series.
  // Keep its stored history intact, but render one identity per original cycle.
  const identity = (item: UniversalItem) => {
    let root = item, depth = 0;
    const seen = new Set([item.id]);
    while (root.occurrence && root.recurrenceOverride?.kind !== 'future_split') {
      const parent = mapped.items[root.occurrence.seriesId];
      if (!parent || seen.has(parent.id)) break;
      seen.add(parent.id); root = parent; depth += 1;
    }
    return { rootId: root.id, key: item.occurrence && depth ? `${root.id}:${item.occurrence.recurrenceId}` : item.id, depth };
  };
  const unique = new Map<string, { item: UniversalItem; depth: number }>();
  const closedCycles = new Set<string>();
  for (const item of items) {
    const { rootId } = identity(item);
    for (const entry of item.cycleHistory ?? []) closedCycles.add(`${rootId}:${entry.recurrenceId}`);
    for (const entry of item.completionEntries ?? []) if (entry.recurrenceId && !entry.revokedAt) closedCycles.add(`${rootId}:${entry.recurrenceId}`);
  }
  for (const item of candidates.values()) {
    const { key, depth } = identity(item);
    if (item.state !== 'open') closedCycles.add(key);
    const prior = unique.get(key);
    if (!prior || depth > prior.depth || (depth === prior.depth && !mapped.items[prior.item.id] && mapped.items[item.id])) unique.set(key, { item, depth });
  }
  const index = getWorkspaceIndex(mapped);
  const source = preferences.dayView.filter.source.trim() || 'true';
  let filter: ReturnType<typeof compileQuery> | undefined;
  try { filter = compileQuery(source, (item, at) => index.queryContextFor(item, at), { timeZone: preferences.timezone, weekStartsOn: preferences.weekStartsOn }); } catch { /* Match existing Calendar's invalid-filter behavior. */ }
  const accepted = (item: UniversalItem) => {
    if (!filter || (!/\bisTemplate\b/.test(source) && isItemTemplate(item))) return false;
    return filter(index.queryItemFor(viewItemForEvaluation(item)), now);
  };
  const events: TimelineEvent[] = [], allDay: UniversalItem[] = [], undated: UniversalItem[] = [], activeRange: UniversalItem[] = [];
  const sleep: TimelineEvent[] = [];
  const overdue: UniversalItem[] = [];
  const sleepId = preferences.timeline?.sleepItemId;
  const isSleep = (item: UniversalItem) => item.id === sleepId || item.occurrence?.seriesId === sleepId;
  const sources = preferences.dayView.scheduleSources;
  for (const [cycleKey, { item }] of unique) {
    const interval = itemInterval(item);
    if (interval && isSleep(item) && !item.schedule?.allDay && item.state !== 'cancelled' && item.state !== 'archived' && !interval.invalid && !interval.point && intersects(interval, day)) sleep.push(interval);
    if (!accepted(item)) continue;
    const schedule = item.schedule;
    const completelyUndated = isCompletelyUndated(item);
    if (completelyUndated && !showUndatedItem(item, now, preferences.timezone)) continue;
    if (completelyUndated && preferences.timeline?.showUndated !== true) continue;
    if (showOverdueToday(item, key, now, preferences.timezone, item.occurrence ? mapped.items[item.occurrence.seriesId] : undefined) && (!interval || !intersects(interval, day)) && !item.schedule?.plannedDate) { overdue.push(item); continue; }
    if (item.schedule?.plannedDate && plannedDateForDisplay(item, now, preferences.timezone) !== key) {
      if (showOverdueToday(item, key, now, preferences.timezone, item.occurrence ? mapped.items[item.occurrence.seriesId] : undefined)) overdue.push(item);
      continue;
    }
    if (item.schedule?.plannedDate && !item.schedule.startAt && !item.schedule.endAt) { undated.push(item); continue; }
    const series = item.occurrence ? mapped.items[item.occurrence.seriesId] : item;
    const rule = series?.recurrence;
    if (rule?.autoRenew && rule.closeAt === 'due' && (!rule.activationOffset || /^PT0[MS]$/.test(rule.activationOffset))) {
      const start = Date.parse(item.schedule?.startAt ?? item.schedule?.availableFrom ?? '');
      const end = Date.parse(item.schedule?.dueAt ?? '');
      const completed = closedCycles.has(cycleKey) || (item.completionEntries ?? []).some(entry => !entry.revokedAt && entry.recurrenceId === item.occurrence?.recurrenceId)
        || (series?.cycleHistory ?? []).some(entry => entry.recurrenceId === item.occurrence?.recurrenceId);
      if (!completed && end > start && intersects({ start, end }, day)) activeRange.push(item);
      continue;
    }
    if (!interval) { undated.push(item); continue; }
    const scheduledBy = item.schedule?.startAt || item.schedule?.endAt ? ['event_open', 'event', 'active'] : item.schedule?.dueAt ? ['due', 'active'] : ['active'];
    if (!sources.some(value => scheduledBy.includes(value))) continue;
    const travel = travelInterval(item);
    if (travel && intersects(travel, day)) events.push(travel);
    if (!intersects(interval, day)) continue;
    if (item.schedule?.allDay) allDay.push(item);
    else events.push(interval);
  }
  const hiding = preferences.timeline?.hideSleep === true && sleep.length > 0;
  const visible = hiding ? events.filter(event => !isSleep(event.item)) : events;
  const planning = planUndatedTasks(undated, events, sleep, day, now);
  const placedIds = new Set(planning.proposals.map(event => event.item.id));
  return {
    day, events: [...visible, ...planning.proposals], allDay, undated: undated.filter(item => !placedIds.has(item.id) && !item.schedule?.plannedDate),
    plannedTasks: undated.filter(item => !placedIds.has(item.id) && item.schedule?.plannedDate), activeRange, overdue, planning,
    hidden: hiding ? hiddenIntervals(sleep, visible, day) : [],
    sleepMissing: Boolean(preferences.timeline?.hideSleep && (!sleepId || !sleep.length)),
    projectionLimited: desiredPadding > padding,
  };
}
