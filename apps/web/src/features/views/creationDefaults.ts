import type { WorkspaceDocument } from '@utm/core';
import { viewFieldOptions } from './fieldCatalog';

const paths = new Set(['title', 'bodyMarkdown', 'state', 'priority', 'tags', 'contexts', 'list', 'area', 'project', 'schedule.availableFrom', 'schedule.startAt', 'schedule.endAt', 'schedule.dueAt', 'schedule.estimatedDuration', 'schedule.timezone', 'schedule.allDay', 'recurrence.rrule', 'recurrence.rdates', 'recurrence.exdates', 'recurrence.timezone', 'recurrence.activationOffset', 'recurrence.dueOffset', 'recurrence.closeAt', 'recurrence.anchor', 'recurrence.autoRenew', 'progress.mode', 'progress.current', 'progress.target', 'progress.unit', 'habit.target', 'habit.unit', 'habit.streakMode', 'reminders', 'attachments']);
export const creationDefaultFieldOptions = (workspace: WorkspaceDocument) => viewFieldOptions(workspace).filter((field) => paths.has(field.path) || field.path.startsWith('custom.'));
export const defaultValueForPath = (workspace: WorkspaceDocument, path: string): unknown => {
  const custom = path.startsWith('custom.') ? workspace.customFields[path.slice(7)] : undefined;
  if (custom) return custom.kind === 'boolean' ? false : custom.kind === 'number' ? 0 : custom.kind === 'multi_enum' ? [] : '';
  if (path === 'state') return 'open'; if (path === 'priority') return 0;
  if (['tags', 'contexts', 'recurrence.rdates', 'recurrence.exdates', 'reminders', 'attachments'].includes(path)) return [];
  if (['schedule.allDay', 'recurrence.autoRenew'].includes(path)) return false;
  if (path === 'progress.mode') return 'boolean'; if (['progress.current', 'progress.target', 'habit.target'].includes(path)) return 0;
  if (path === 'habit.unit') return 'times'; if (path === 'habit.streakMode') return 'manual_only'; if (path === 'recurrence.closeAt') return 'next_activation'; if (path === 'recurrence.anchor') return 'schedule';
  if (path === 'recurrence.rrule') return 'FREQ=WEEKLY;INTERVAL=1'; if (path === 'schedule.timezone' || path === 'recurrence.timezone') return Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (path === 'schedule.estimatedDuration') return 'PT10M'; if (path.startsWith('schedule.') && path.endsWith('At') || path === 'schedule.availableFrom') return new Date().toISOString(); return '';
};
