import { projectOccurrences } from './calendar.js';
import { calendarDateKey } from './dsl.js';
import { googleCalendarProjection } from './google-calendar.js';
import { effectiveItemDurationMs } from './organization.js';
import { zonedDateStart } from './view-statistics.js';
import type { UniversalItem, WorkspaceDocument } from './types.js';
import { canManuallyComplete } from './item-event.js';
import { seriesReferenceIds, seriesReferenceOwner, seriesReferenceAncestors } from './series-references.js';

export const withinTargets = (item: UniversalItem) => [...new Set(item.relations.filter(r => r.type === 'scheduled_within').map(r => r.targetId))];
export const withinTargetsFor = (workspace: WorkspaceDocument, item: UniversalItem) => [...new Set(withinTargets(item).map(id => seriesReferenceAncestors(workspace, seriesReferenceOwner(workspace, id)).at(-1)!))];
/** A completable task's opening bound is availability, not a fixed event slot. */
export const hasWithinAvailabilityStart = (item: UniversalItem) => canManuallyComplete(item) && withinTargets(item).length > 0 && Boolean(item.schedule?.startAt) && !item.schedule?.endAt && !item.external?.endAt;
type Interval = { start: number; end: number; target: string };
const blockCache = new Map<string, Interval[]>();
function blocks(workspace: WorkspaceDocument, ids: string[], start: Date, end: Date): Interval[] {
  const roots = new Set(ids);
  const targets = new Map<string, string>();
  for (const root of roots) for (const id of seriesReferenceIds(workspace, [root])) if (!targets.has(id)) targets.set(id, root);
  for (const root of roots) targets.set(root, root);
  const items = Object.fromEntries(Object.values(workspace.items).filter(i => targets.has(i.id) || (i.occurrence && targets.has(i.occurrence.seriesId))).map(i => [i.id, googleCalendarProjection(i)]));
  const key = JSON.stringify([workspace.workspaceId, items, workspace.tombstones, +start, +end]);
  const cached = blockCache.get(key);
  if (cached) return cached;
  let rows: ReturnType<typeof projectOccurrences>;
  try { rows = projectOccurrences({ ...workspace, items }, start, end); } catch { return []; }
  const result = rows.flatMap(row => {
    const source = items[row.materializedItemId ?? row.sourceItemId];
    if (!source || source.deletedAt || ['cancelled', 'archived'].includes(row.state)) return [];
    const from = Date.parse(row.schedule.startAt ?? '');
    const to = Date.parse(row.schedule.endAt ?? '') || from + effectiveItemDurationMs(source);
    return Number.isFinite(from) && to > from ? [{ start: from, end: to, target: targets.get(row.sourceItemId) ?? row.materializedItemId ?? row.sourceItemId }] : [];
  });
  if (blockCache.size >= 128) blockCache.delete(blockCache.keys().next().value!);
  blockCache.set(key, result);
  return result;
}

/** Undated captures resolve once against their creation time, never drift with the clock. */
export function withinDay(workspace: WorkspaceDocument, item: UniversalItem, referenceNow = new Date(item.createdAt)): string | undefined {
  if (item.schedule?.plannedDate) return item.schedule.plannedDate;
  const explicit = item.schedule?.startAt ?? item.schedule?.endAt ?? item.schedule?.dueAt;
  if (explicit && !hasWithinAvailabilityStart(item)) return calendarDateKey(new Date(explicit), workspace.calendarPreferences.timezone);
  const first = withinTargetsFor(workspace, item)[0];
  if (!first) return undefined;
  const now = hasWithinAvailabilityStart(item) ? new Date(Math.max(+referenceNow, Date.parse(item.schedule!.startAt!))) : new Date(item.createdAt);
  const next = blocks(workspace, [first], new Date(+now - 86400000), new Date(+now + 366 * 86400000))
    .filter(i => i.end > +now).sort((a, b) => a.start - b.start)[0];
  return next ? calendarDateKey(new Date(Math.max(next.start, +now)), workspace.calendarPreferences.timezone) : explicit ? calendarDateKey(new Date(explicit), workspace.calendarPreferences.timezone) : undefined;
}

const snapshots = new WeakMap<WorkspaceDocument, { result: WorkspaceDocument; from: number; until: number }>();
const originals = new WeakMap<WorkspaceDocument, WorkspaceDocument>();
const dayCache = new Map<string, { signature: string; items: UniversalItem[] }>();
const placementInfo = new WeakMap<UniversalItem, { targets: string[]; fallback: boolean }>();
export const withinPlacementInfo = (item: UniversalItem) => placementInfo.get(item);
/** Read-only display projection. Never pass this snapshot to persistence or Google writes. */
export function withinPlacementWorkspace(workspace: WorkspaceDocument, now = new Date(), options: { transient?: boolean } = {}): WorkspaceDocument {
  workspace = originals.get(workspace) ?? workspace;
  const cached = snapshots.get(workspace);
  if (cached && +now >= cached.from && +now < cached.until) return cached.result;
  const zone = workspace.calendarPreferences.timezone;
  const today = calendarDateKey(now, zone);
  const todayStart = zonedDateStart(today, zone);
  const tomorrow = new Date(Date.parse(today + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
  let until = +zonedDateStart(tomorrow, zone);
  const rolled = new Map<string, Interval>();
  const groups = new Map<string, UniversalItem[]>();
  for (const item of Object.values(workspace.items)) {
    if (item.deletedAt || item.role === 'series_template' || !withinTargets(item).length || item.state === 'cancelled' || item.state === 'archived') continue;
    let day = withinDay(workspace, item, now);
    // A missed day is a display placement, not a mutation of the user's date.
    // Explicit event times (including linked Google times) and closed tasks stay put.
    if (day && day < today && item.schedule?.plannedDate && item.state === 'open'
      && !item.schedule.startAt && !item.schedule.endAt && !item.external?.startAt && !item.external?.endAt) {
      const first = withinTargetsFor(workspace, item)[0]!;
      const upcoming = blocks(workspace, [first], new Date(+todayStart - 86400000), new Date(+todayStart + 366 * 86400000))
        .filter(block => block.end > +now).sort((a, b) => a.start - b.start);
      const next = upcoming[0];
      if (next) {
        day = calendarDateKey(new Date(Math.max(next.start, +todayStart)), zone);
        rolled.set(item.id, next);
        until = Math.min(until, next.end);
      }
    }
    if (day) groups.set(day, [...(groups.get(day) ?? []), item]);
  }
  if (!groups.size) { snapshots.set(workspace, { result: workspace, from: +now, until }); return workspace; }
  const items = { ...workspace.items };
  for (const [day, tasks] of groups) {
    tasks.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const ids = [...new Set(tasks.flatMap(item => withinTargetsFor(workspace, item)))];
    const sourceIds = new Set(seriesReferenceIds(workspace, ids));
    const sources = Object.values(workspace.items).filter(i => sourceIds.has(i.id) || (i.occurrence && sourceIds.has(i.occurrence.seriesId)));
    const key = `${workspace.workspaceId}:${day}`;
    const begin = zonedDateStart(day, workspace.calendarPreferences.timezone);
    const nextDay = new Date(Date.parse(day + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
    const end = zonedDateStart(nextDay, workspace.calendarPreferences.timezone);
    const intervals = blocks(workspace, ids, new Date(+begin - 86400000), end).filter(i => i.end > +begin && i.start < +end);
    const hasRollover = tasks.some(item => rolled.has(item.id));
    const remaining = hasRollover || tasks.some(hasWithinAvailabilityStart) ? intervals.filter(i => i.end > +now) : [];
    for (const interval of remaining) until = Math.min(until, interval.end);
    const signature = JSON.stringify([tasks, sources, workspace.tombstones, zone, tasks.map(item => rolled.get(item.id)), remaining]);
    const previous = dayCache.get(key);
    if (previous?.signature === signature) { for (const item of previous.items) items[item.id] = item; continue; }
    const occupied: Array<{ start: number; end: number; targets: string[] }> = tasks.flatMap(i => {
      const start = Date.parse(i.schedule?.startAt ?? '');
      return Number.isFinite(start) && !hasWithinAvailabilityStart(i) ? [{ start, end: Date.parse(i.schedule?.endAt ?? '') || start + effectiveItemDurationMs(i), targets: withinTargetsFor(workspace, i) }] : [];
    });
    const results = tasks.map(item => {
      const availability = hasWithinAvailabilityStart(item);
      if (!availability && (item.schedule?.startAt || item.schedule?.endAt || item.external?.startAt)) return item;
      const targets = withinTargetsFor(workspace, item);
      const notBefore = availability ? Date.parse(item.schedule!.startAt!) : -Infinity;
      const rollover = rolled.get(item.id);
      const available = targets.map(id => intervals.filter(i => i.target === id && i.end > notBefore && (!availability || i.end > +now) && (!rollover || i.end > rollover.start && i.end > +now)));
      let intersections = available[0] ?? [];
      for (const group of available.slice(1)) intersections = intersections.flatMap(a => group.flatMap(b => {
        const start = Math.max(a.start, b.start), end = Math.min(a.end, b.end);
        return end > start ? [{ ...a, start, end }] : [];
      }));
      const candidates = intersections.length ? intersections : available.find(group => group.length) ?? [];
      const chosen = candidates.sort((a, b) => a.start - b.start)[0];
      if (!chosen) return item;
      if (availability && chosen.end > +now) until = Math.min(until, chosen.end);
      let start = Math.max(chosen.start, +begin, notBefore);
      if (!item.schedule?.plannedDate && !item.schedule?.dueAt) start = Math.max(start, Date.parse(item.createdAt));
      const floor = item.extensions?.['utm:withinNotBefore'];
      if (typeof floor === 'string' && Number.isFinite(Date.parse(floor))) start = Math.max(start, Date.parse(floor));
      const duration = effectiveItemDurationMs(item);
      for (const taken of occupied.sort((a, b) => a.start - b.start)) if (taken.targets.some(id => targets.includes(id)) && start < taken.end && start + duration > taken.start) start = taken.end;
      occupied.push({ start, end: start + duration, targets });
      const result = { ...item, schedule: { timezone: workspace.calendarPreferences.timezone, ...item.schedule, plannedDate: day, startAt: new Date(start).toISOString(), endAt: new Date(start + duration).toISOString() } };
      placementInfo.set(result, { targets: intersections.length ? targets : [chosen.target], fallback: !intersections.length && targets.length > 1 });
      return result;
    });
    for (const item of results) items[item.id] = item;
    // Editor previews must not evict the full calendar's day result with a
    // temporary subset of items on every keystroke.
    if (!options.transient) {
      if (dayCache.size >= 90) dayCache.delete(dayCache.keys().next().value!);
      dayCache.set(key, { signature, items: results });
    }
  }
  const result = { ...workspace, items };
  snapshots.set(workspace, { result, from: +now, until });
  originals.set(result, workspace);
  return result;
}

/** No relevant hidden/reserved relation means this optional filter passes. */
export function withinReservedBlockWhenSet(workspace: WorkspaceDocument, item: UniversalItem, hiddenReservedIds: readonly string[], now: Date): boolean {
  const reserved = new Set(hiddenReservedIds);
  const targets = withinTargetsFor(workspace, item).filter(id => reserved.has(id));
  if (!targets.length) return true;
  const active = new Set(activeWithinBlockIds(workspace, targets, now));
  return targets.some(id => active.has(id));
}

/** Uses the same recurrence/block cache as placement, including overnight blocks. */
export function activeWithinBlockIds(workspace: WorkspaceDocument, targets: string[], now: Date): string[] {
  if (!targets.length) return [];
  const day = calendarDateKey(now, workspace.calendarPreferences.timezone);
  const start = zonedDateStart(day, workspace.calendarPreferences.timezone);
  const end = new Date(+start + 2 * 86400000);
  return [...new Set(blocks(workspace, targets, new Date(+start - 86400000), end).filter(block => block.start <= +now && +now < block.end).map(block => block.target))].sort();
}
