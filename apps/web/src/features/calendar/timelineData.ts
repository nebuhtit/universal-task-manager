import { compileQuery, createOccurrence, effectiveItemDurationMs, googleCalendarProjection, projectOccurrences, type UniversalItem, type WorkspaceDocument } from '@utm/core';
import { getWorkspaceIndex } from '../../services/workspaceIndex';
import { isItemTemplate } from '../items/fieldDisplay';
import { viewItemForEvaluation } from '../views/viewSelectors';
import { dayBounds, hiddenIntervals, intersects, itemInterval, type TimelineEvent } from './timelineLayout';

export function timelineData(workspace: WorkspaceDocument, key: string, now: Date) {
  const preferences = workspace.calendarPreferences;
  const day = dayBounds(key, preferences.timezone);
  const mapped = { ...workspace, items: Object.fromEntries(Object.values(workspace.items).map(item => [item.id, googleCalendarProjection(item)])) };
  const items = Object.values(mapped.items).filter(item => !item.deletedAt);
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
  for (const item of items) if (item.role !== 'series_template' || !itemInterval(item)) candidates.set(item.id, item);
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
  const sleepId = preferences.timeline?.sleepItemId;
  const isSleep = (item: UniversalItem) => item.id === sleepId || item.occurrence?.seriesId === sleepId;
  const sources = preferences.dayView.scheduleSources;
  for (const item of candidates.values()) {
    const interval = itemInterval(item);
    if (interval && isSleep(item) && !item.schedule?.allDay && item.state !== 'cancelled' && item.state !== 'archived' && !interval.invalid && !interval.point && intersects(interval, day)) sleep.push(interval);
    if (!accepted(item)) continue;
    const series = item.occurrence ? mapped.items[item.occurrence.seriesId] : item;
    const rule = series?.recurrence;
    if (rule?.autoRenew && rule.closeAt === 'due' && (!rule.activationOffset || /^PT0[MS]$/.test(rule.activationOffset))) {
      const start = Date.parse(item.schedule?.startAt ?? item.schedule?.availableFrom ?? '');
      const end = Date.parse(item.schedule?.dueAt ?? '');
      const completed = item.state !== 'open' || (item.completionEntries ?? []).some(entry => !entry.revokedAt && entry.recurrenceId === item.occurrence?.recurrenceId)
        || (series?.cycleHistory ?? []).some(entry => entry.recurrenceId === item.occurrence?.recurrenceId);
      if (!completed && end > start && intersects({ start, end }, day)) activeRange.push(item);
      continue;
    }
    if (!interval) { undated.push(item); continue; }
    if (!intersects(interval, day)) continue;
    const scheduledBy = item.schedule?.startAt || item.schedule?.endAt ? ['event_open', 'event', 'active'] : item.schedule?.dueAt ? ['due', 'active'] : ['active'];
    if (!sources.some(value => scheduledBy.includes(value))) continue;
    if (item.schedule?.allDay) allDay.push(item);
    else events.push(interval);
  }
  const hiding = preferences.timeline?.hideSleep === true && sleep.length > 0;
  const visible = hiding ? events.filter(event => !isSleep(event.item)) : events;
  return {
    day, events: visible, allDay, undated, activeRange,
    hidden: hiding ? hiddenIntervals(sleep, visible, day) : [],
    sleepMissing: Boolean(preferences.timeline?.hideSleep && (!sleepId || !sleep.length)),
    projectionLimited: desiredPadding > padding,
  };
}
