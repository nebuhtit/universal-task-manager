import { createId } from './types.js';
import { buildRecurrenceRule, createOccurrence, deterministicOccurrenceId } from './recurrence.js';
import type { ProjectedOccurrence, Schedule, UniversalItem, WorkspaceDocument } from './types.js';

const clone = <T>(value: T): T => structuredClone(value);
const at = (value?: string) => value ? new Date(value).getTime() : Number.NaN;
const shifted = (value: string | undefined, deltaMs: number) => value ? new Date(at(value) + deltaMs).toISOString() : undefined;

function scheduleOverlaps(schedule: Schedule | undefined, rangeStart: Date, rangeEnd: Date): boolean {
  if (!schedule) return false;
  const start = at(schedule.startAt ?? schedule.dueAt ?? schedule.availableFrom);
  if (Number.isNaN(start)) return false;
  const end = at(schedule.endAt ?? schedule.startAt ?? schedule.dueAt ?? schedule.availableFrom);
  return start < rangeEnd.getTime() && end >= rangeStart.getTime();
}

function projection(item: UniversalItem, sourceItemId = item.id, virtual = false): ProjectedOccurrence {
  const result: ProjectedOccurrence = {
    id: virtual && item.occurrence ? `projected:${item.occurrence.seriesId}:${item.occurrence.recurrenceId}` : item.id,
    sourceItemId, virtual, title: item.title, state: item.state, preset: item.preset,
    schedule: clone(item.schedule!), dueOnly: Boolean(item.schedule?.dueAt && !item.schedule?.startAt),
    ...(item.priority !== undefined ? { priority: item.priority } : {}),
  };
  if (item.occurrence) {
    result.seriesId = item.occurrence.seriesId; result.recurrenceId = item.occurrence.recurrenceId;
    if (!virtual) result.materializedItemId = item.id;
  } else if (!virtual) result.materializedItemId = item.id;
  return result;
}

/** Produces calendar rows for a visible range without persisting future occurrences. */
export function projectOccurrences(workspace: WorkspaceDocument, rangeStart: Date, rangeEnd: Date): ProjectedOccurrence[] {
  if (!(rangeStart < rangeEnd)) throw new Error('Calendar range end must be after its start');
  const output: ProjectedOccurrence[] = [];
  const templates = Object.values(workspace.items).filter((item) => item.role === 'series_template' && item.recurrence && item.schedule?.startAt && !item.deletedAt);
  const knownSeries = new Set(templates.map((item) => item.id));

  for (const item of Object.values(workspace.items)) {
    if (item.deletedAt || item.role === 'series_template' || !scheduleOverlaps(item.schedule, rangeStart, rangeEnd)) continue;
    if (item.role === 'occurrence' && item.occurrence && knownSeries.has(item.occurrence.seriesId)) continue;
    output.push(projection(item));
  }

  for (const series of templates) {
    const rule = buildRecurrenceRule(series);
    const anchors = rule.between(new Date(rangeStart.getTime() - 86_400_000), rangeEnd, true)
      .filter((anchor) => anchor < rangeEnd);
    const materialized = new Map(Object.values(workspace.items)
      .filter((item) => item.occurrence?.seriesId === series.id && !item.deletedAt)
      .map((item) => [item.occurrence!.recurrenceId, item]));
    anchors.forEach((anchor, index) => {
      const recurrenceId = anchor.toISOString();
      const existing = materialized.get(recurrenceId);
      const item = existing ?? createOccurrence(series, anchor, index);
      if (!scheduleOverlaps(item.schedule, rangeStart, rangeEnd)) return;
      output.push(projection(item, series.id, !existing));
    });
  }
  return output.sort((left, right) => at(left.schedule.startAt ?? left.schedule.dueAt) - at(right.schedule.startAt ?? right.schedule.dueAt) || left.id.localeCompare(right.id));
}

export function materializeProjectedOccurrence(workspace: WorkspaceDocument, projected: ProjectedOccurrence, now = new Date()): UniversalItem {
  if (!projected.virtual) {
    const existing = workspace.items[projected.materializedItemId ?? projected.id];
    if (!existing) throw new Error(`Calendar item ${projected.id} no longer exists`);
    return existing;
  }
  if (!projected.seriesId || !projected.recurrenceId) throw new Error('Projected occurrence is missing series identity');
  const series = workspace.items[projected.seriesId];
  if (!series?.recurrence) throw new Error('Recurring series no longer exists');
  const id = deterministicOccurrenceId(series.id, projected.recurrenceId);
  if (workspace.items[id]) return workspace.items[id]!;
  const sequence = buildRecurrenceRule(series).between(new Date(at(series.schedule!.startAt!) - 1), new Date(projected.recurrenceId), true).length - 1;
  const item = createOccurrence(series, new Date(projected.recurrenceId), Math.max(0, sequence));
  item.createdAt = now.toISOString(); item.updatedAt = now.toISOString();
  workspace.items[item.id] = item;
  return item;
}

export interface CalendarMutationResult { before: Record<string, Schedule | undefined>; changedIds: string[] }

export function moveCalendarItems(workspace: WorkspaceDocument, itemIds: string[], deltaMs: number, now = new Date()): CalendarMutationResult {
  const before: Record<string, Schedule | undefined> = {}; const changedIds: string[] = [];
  for (const id of [...new Set(itemIds)]) {
    const item = workspace.items[id]; if (!item || item.deletedAt) continue;
    before[id] = item.schedule ? clone(item.schedule) : undefined;
    const schedule = clone(item.schedule ?? { timezone: workspace.calendarPreferences.timezone });
    if (schedule.startAt) schedule.startAt = shifted(schedule.startAt, deltaMs)!;
    if (schedule.endAt) schedule.endAt = shifted(schedule.endAt, deltaMs)!;
    if (schedule.dueAt) schedule.dueAt = shifted(schedule.dueAt, deltaMs)!;
    if (schedule.availableFrom) schedule.availableFrom = shifted(schedule.availableFrom, deltaMs)!;
    item.schedule = schedule; item.updatedAt = now.toISOString(); item.revision += 1; changedIds.push(id);
  }
  workspace.updatedAt = now.toISOString();
  return { before, changedIds };
}

export function resizeCalendarItem(workspace: WorkspaceDocument, itemId: string, endAt: string, now = new Date()): CalendarMutationResult {
  const item = workspace.items[itemId]; if (!item) throw new Error('Calendar item no longer exists');
  const before = { [itemId]: item.schedule ? clone(item.schedule) : undefined };
  item.schedule = { timezone: workspace.calendarPreferences.timezone, ...item.schedule, endAt };
  item.updatedAt = now.toISOString(); item.revision += 1; workspace.updatedAt = now.toISOString();
  return { before, changedIds: [itemId] };
}

export function restoreCalendarSchedules(workspace: WorkspaceDocument, before: Record<string, Schedule | undefined>, now = new Date()): void {
  Object.entries(before).forEach(([id, schedule]) => {
    const item = workspace.items[id]; if (!item) return;
    if (schedule) item.schedule = clone(schedule); else delete item.schedule;
    item.updatedAt = now.toISOString(); item.revision += 1;
  });
  workspace.updatedAt = now.toISOString();
}

export type RecurrenceEditScope = 'this_occurrence' | 'this_and_future' | 'entire_series';

export function moveRecurringOccurrence(workspace: WorkspaceDocument, projected: ProjectedOccurrence, deltaMs: number, scope: RecurrenceEditScope, now = new Date()): string[] {
  if (!projected.seriesId || !projected.recurrenceId) {
    const item = materializeProjectedOccurrence(workspace, projected, now); return moveCalendarItems(workspace, [item.id], deltaMs, now).changedIds;
  }
  const series = workspace.items[projected.seriesId]; if (!series) throw new Error('Recurring series no longer exists');
  if (scope === 'this_occurrence') {
    const item = materializeProjectedOccurrence(workspace, projected, now);
    item.recurrenceOverride = { kind: 'this_occurrence', sourceSeriesId: series.id, recurrenceId: projected.recurrenceId };
    return moveCalendarItems(workspace, [item.id], deltaMs, now).changedIds;
  }
  if (scope === 'entire_series') {
    const future = Object.values(workspace.items).filter((item) => item.occurrence?.seriesId === series.id && item.state === 'open' && item.occurrence.recurrenceId >= projected.recurrenceId!);
    return moveCalendarItems(workspace, [series.id, ...future.map((item) => item.id)], deltaMs, now).changedIds;
  }
  const oldRule = series.recurrence!;
  const until = new Date(new Date(projected.recurrenceId).getTime() - 1_000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const originalParts = oldRule.rrule.split(';');
  const oldParts = originalParts.filter((part) => !part.startsWith('UNTIL=') && !part.startsWith('COUNT='));
  series.recurrence = { ...oldRule, rrule: [...oldParts, `UNTIL=${until}`].join(';') };
  const split = clone(series); split.id = createId(); split.title = series.title; split.createdAt = now.toISOString(); split.updatedAt = now.toISOString(); split.revision = 1;
  const countPart = originalParts.find((part) => part.startsWith('COUNT='));
  let futureParts = [...originalParts];
  if (countPart) {
    const total = Number(countPart.slice('COUNT='.length));
    const rule = buildRecurrenceRule({ ...series, recurrence: oldRule });
    const beforeCount = rule.between(new Date(at(series.schedule!.startAt!) - 1), new Date(projected.recurrenceId), false).length;
    futureParts = futureParts.map((part) => part.startsWith('COUNT=') ? `COUNT=${Math.max(1, total - beforeCount)}` : part);
  }
  split.recurrence = { ...oldRule, rrule: futureParts.join(';') };
  split.schedule = clone(projected.schedule);
  if (split.schedule.startAt) split.schedule.startAt = shifted(split.schedule.startAt, deltaMs)!;
  if (split.schedule.endAt) split.schedule.endAt = shifted(split.schedule.endAt, deltaMs)!;
  if (split.schedule.dueAt) split.schedule.dueAt = shifted(split.schedule.dueAt, deltaMs)!;
  if (split.schedule.availableFrom) split.schedule.availableFrom = shifted(split.schedule.availableFrom, deltaMs)!;
  split.recurrenceOverride = { kind: 'future_split', sourceSeriesId: series.id, recurrenceId: projected.recurrenceId };
  workspace.items[split.id] = split; series.updatedAt = now.toISOString(); series.revision += 1; workspace.updatedAt = now.toISOString();
  return [series.id, split.id];
}
