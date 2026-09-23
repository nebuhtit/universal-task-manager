import { calendarDateKey, compileQuery, googleCalendarProjection, itemDeletionTime, zonedDateStart, type UniversalItem, type WorkspaceDocument } from '@utm/core';
import { getWorkspaceIndex } from '../../services/workspaceIndex';
import { isItemTemplate } from '../items/fieldDisplay';
import { viewItemForEvaluation } from '../views/viewSelectors';

export function isCompletelyUndated(item: UniversalItem) {
  const s = item.schedule;
  return !s?.plannedDate && !s?.startAt && !s?.endAt && !s?.dueAt && !s?.availableFrom;
}

export function showUndatedItem(item: UniversalItem, now: Date, zone: string) {
  if (item.deletedAt) return false;
  if (item.state === 'open') return true;
  const at = item.closure?.at;
  return item.state === 'done' && Boolean(at && Number.isFinite(Date.parse(at)) && calendarDateKey(new Date(at), zone) === calendarDateKey(now, zone));
}

/** List and Timeline share the same undated membership and day-view filter. */
export function calendarUndatedItems(workspace: WorkspaceDocument, now: Date): UniversalItem[] {
  const index = getWorkspaceIndex(workspace);
  const source = workspace.calendarPreferences.dayView.filter.source.trim() || 'true';
  let predicate: ReturnType<typeof compileQuery>;
  try { predicate = compileQuery(source, (item, at) => index.queryContextFor(item, at), { timeZone: workspace.calendarPreferences.timezone, weekStartsOn: workspace.calendarPreferences.weekStartsOn }); }
  catch { return []; }
  const templatesRequested = /\bisTemplate\b/.test(source);
  return Object.values(workspace.items).flatMap((raw) => {
    if (itemDeletionTime(workspace, raw)) return [];
    const item = googleCalendarProjection(raw);
    if (item.role === 'series_template' || (!templatesRequested && isItemTemplate(item)) || !isCompletelyUndated(item) || !showUndatedItem(item, now, workspace.calendarPreferences.timezone)) return [];
    return predicate(index.queryItemFor(viewItemForEvaluation(item)), now) ? [item] : [];
  });
}

/** Additional inclusion only; never moves or edits the original schedule. */
export function showOverdueToday(item: UniversalItem, key: string, now: Date, zone: string, series?: UniversalItem) {
  if (item.deletedAt || item.state !== 'open' || key !== calendarDateKey(now, zone)) return false;
  const due = Date.parse(item.schedule?.dueAt ?? '');
  const missedDue = Number.isFinite(due) && due < now.getTime();
  const missedPlannedDate = Boolean(item.schedule?.plannedDate && item.schedule.plannedDate < key);
  if (!missedDue && !missedPlannedDate) return false;
  const start = Date.parse(item.schedule?.startAt ?? '');
  const rule = (series ?? item).recurrence;
  const activeRange = rule?.autoRenew && rule.closeAt === 'due' && (!rule.activationOffset || /^PT0[MS]$/.test(rule.activationOffset));
  if (activeRange) {
    const dayStart = zonedDateStart(key, zone).getTime();
    // Due is already before now on this day; an active range must reach this day.
    if (!Number.isFinite(start) || !Number.isFinite(due) || start > due || due < dayStart) return false;
  }
  return true;
}
