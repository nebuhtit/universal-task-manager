import { VIEW_CREATION_DUE_PERIOD_EXTENSION, calendarDateKey, createId, organizationDefinitionFor, shiftCalendarDateKey, zonedDateTime, type SavedView, type UniversalItem, type WorkspaceDocument } from '@utm/core';
import { inferredPreset } from '../items';

const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const setDefaultPath = (target: Record<string, unknown>, path: string, value: unknown) => {
  const parts = path.split('.'); let cursor = target;
  for (const part of parts.slice(0, -1)) {
    const existing = cursor[part];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts.at(-1)!] = clean(value);
};

export const applyViewCreationDefaults = (item: UniversalItem, view: SavedView, workspace?: WorkspaceDocument): UniversalItem => {
  const defaults = view.creationDefaults ?? {};
  const next = clean(item) as unknown as Record<string, unknown>;
  for (const [path, value] of Object.entries(defaults)) setDefaultPath(next, path, value);
  const nextItem = next as unknown as UniversalItem;
  const duePeriod = view.extensions?.[VIEW_CREATION_DUE_PERIOD_EXTENSION];
  if ((duePeriod === 'today' || duePeriod === 'tomorrow') && !Object.hasOwn(defaults, 'schedule.dueAt')) {
    const timezone = workspace?.calendarPreferences.timezone ?? nextItem.schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const today = calendarDateKey(new Date(nextItem.createdAt), timezone);
    const dueDate = duePeriod === 'tomorrow' ? shiftCalendarDateKey(today, 1) : today;
    nextItem.schedule = { ...nextItem.schedule, timezone, dueAt: zonedDateTime(dueDate, 12, 0, timezone).toISOString() };
    if (!Object.hasOwn(defaults, 'schedule.startAt')) delete nextItem.schedule.startAt;
    if (!Object.hasOwn(defaults, 'schedule.endAt')) delete nextItem.schedule.endAt;
  }
  if (Object.keys(defaults).some((path) => path.startsWith('recurrence.'))) {
    nextItem.role = 'series_template';
    nextItem.recurrence = {
      rrule: 'FREQ=WEEKLY;INTERVAL=1', rdates: [], exdates: [], timezone: nextItem.schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      closeAt: 'next_activation', anchor: 'schedule', autoRenew: false, ...nextItem.recurrence,
    };
  }
  if (Object.keys(defaults).some((path) => path.startsWith('habit.'))) nextItem.habit = { target: 1, unit: 'times', streakMode: 'manual_only', ...nextItem.habit, completedDates: [] };
  if (Array.isArray(nextItem.reminders)) nextItem.reminders = nextItem.reminders.map((reminder) => { const { acknowledgedAt: _acknowledgedAt, ...freshReminder } = reminder; return { ...freshReminder, id: createId() }; });
  // Explicit View organization always wins over a conflicting generic default.
  if (view.list) nextItem.list = view.list;
  const defaultProjects = [...new Set([...(Array.isArray(nextItem.projects) ? nextItem.projects : []), ...(nextItem.project ? [nextItem.project] : [])])];
  const selectedProjects = view.project ? [view.project] : defaultProjects;
  const inheritedAreas = workspace ? selectedProjects.flatMap((project) => {
    const definition = organizationDefinitionFor(workspace, 'project', project);
    return definition && 'areas' in definition ? definition.areas : [];
  }) : [];
  const defaultAreas = [...new Set([...(Array.isArray(nextItem.areas) ? nextItem.areas : []), ...(nextItem.area ? [nextItem.area] : []), ...inheritedAreas])];
  nextItem.areas = view.area ? [view.area] : defaultAreas;
  nextItem.projects = selectedProjects;
  delete nextItem.area;
  delete nextItem.project;
  nextItem.preset = inferredPreset(nextItem);
  return nextItem;
};
