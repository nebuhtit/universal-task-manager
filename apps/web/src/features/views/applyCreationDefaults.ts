import { createId, organizationDefinitionFor, type SavedView, type UniversalItem, type WorkspaceDocument } from '@utm/core';
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
  const projectArea = view.project && workspace ? organizationDefinitionFor(workspace, 'project', view.project) : undefined;
  if (view.area) nextItem.area = view.area;
  else if (projectArea?.area) nextItem.area = projectArea.area;
  if (view.project) nextItem.project = view.project;
  nextItem.preset = inferredPreset(nextItem);
  return nextItem;
};
