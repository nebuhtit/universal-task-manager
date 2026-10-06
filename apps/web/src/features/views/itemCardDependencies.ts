import type { WorkspaceDocument } from '@utm/core';

// Explicit allow-list: relationships, reminders, formulas and scripts may
// consume other items. New/unknown fields must keep the normal render path.
const localFields = new Set(['title', 'bodyMarkdown', 'description', 'state', 'preset', 'priority', 'tags', 'contexts', 'area', 'areas', 'project', 'projects',
  'schedule.startAt', 'schedule.endAt', 'schedule.dueAt', 'schedule.availableFrom', 'schedule.plannedDate', 'schedule.estimatedDuration', 'external.provider', 'external.transparency']);

export function cardWorkspaceUnchanged(before: WorkspaceDocument | undefined, after: WorkspaceDocument | undefined, fields?: string[]) {
  if (before === after) return true;
  if (!before || !after || fields?.some(field => !localFields.has(field))) return false;
  // Only ignore the item collection and document save timestamp. Preferences,
  // organization colors, custom definitions, etc. still invalidate cards.
  const keys = Object.keys(before) as Array<keyof WorkspaceDocument>;
  return keys.length === Object.keys(after).length && keys.every(key => key === 'items' || key === 'updatedAt' || before[key] === after[key]);
}
