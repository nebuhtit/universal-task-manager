import {
  APP_VERSION,
  dueDateBuckets,
  evaluateFormulas,
  evaluateItemScripts,
  type ItemPreset,
  type ItemScriptField,
  type UniversalItem,
  type WorkspaceDocument,
  type WorkspaceLanguage,
} from '@utm/core';
import { calendarDurationMs, parseFriendlyDuration, toIsoDuration } from '../../utils/durations';
import { formatViewDate } from '../../utils/dates';

export const priorityNames: Record<NonNullable<UniversalItem['priority']>, string> = { 0: 'None', 1: 'Low', 2: 'Medium', 3: 'High', 4: 'Urgent' };
export const stateNames: Record<UniversalItem['state'], string> = { open: 'Active', done: 'Completed', auto_closed: 'Auto closed', cancelled: 'Cancelled', archived: 'Archived' };

export type ViewFieldOption = { path: string; label: string; group: string };

const builtInViewFields: ViewFieldOption[] = [
  { path: 'title', label: 'Title', group: 'Core' }, { path: 'bodyMarkdown', label: 'Description', group: 'Core' },
  { path: 'state', label: 'State', group: 'Core' }, { path: 'preset', label: 'Preset', group: 'Core' },
  { path: 'isHabit', label: 'Habit', group: 'Core' }, { path: 'activeRange', label: 'Inside active range now', group: 'Core' },
  { path: 'activeDuration', label: 'Has active range dates', group: 'Core' },
  { path: 'dueTodayOrOverdue', label: 'Due today or overdue', group: 'Schedule' },
  { path: 'dueThisWeekOrOverdue', label: 'Due this week or overdue', group: 'Schedule' },
  { path: 'role', label: 'Role', group: 'Core' }, { path: 'priority', label: 'Priority', group: 'Core' },
  { path: 'tags', label: 'Tags', group: 'Core' }, { path: 'contexts', label: 'Contexts', group: 'Core' }, { path: 'list', label: 'Task list', group: 'Core' },
  { path: 'schedule.availableFrom', label: 'Available to work from', group: 'Schedule' }, { path: 'schedule.startAt', label: 'Event opens', group: 'Schedule' },
  { path: 'schedule.endAt', label: 'Event ends', group: 'Schedule' }, { path: 'schedule.dueAt', label: 'Due / Active range ends', group: 'Schedule' },
  { path: 'schedule.estimatedDuration', label: 'Estimated duration', group: 'Schedule' }, { path: 'schedule.actualDuration', label: 'Actual duration', group: 'Schedule' },
  { path: 'schedule.timezone', label: 'Timezone', group: 'Schedule' }, { path: 'schedule.allDay', label: 'All day', group: 'Schedule' },
  { path: 'recurrence.rrule', label: 'RRULE', group: 'Recurrence' }, { path: 'recurrence.rdates', label: 'Additional dates', group: 'Recurrence' },
  { path: 'recurrence.exdates', label: 'Excluded dates', group: 'Recurrence' }, { path: 'recurrence.timezone', label: 'Recurrence timezone', group: 'Recurrence' },
  { path: 'recurrence.activationOffset', label: 'Activation offset', group: 'Recurrence' }, { path: 'recurrence.dueOffset', label: 'Due offset', group: 'Recurrence' },
  { path: 'recurrence.closeAt', label: 'Auto-close boundary', group: 'Recurrence' }, { path: 'recurrence.anchor', label: 'Next cycle anchor', group: 'Recurrence' },
  { path: 'recurrence.autoRenew', label: 'Auto-renew', group: 'Recurrence' },
  { path: 'progress.mode', label: 'Progress mode', group: 'Progress & habit' }, { path: 'progress.current', label: 'Progress current', group: 'Progress & habit' },
  { path: 'progress.target', label: 'Progress target', group: 'Progress & habit' }, { path: 'progress.unit', label: 'Progress unit', group: 'Progress & habit' },
  { path: 'habit.target', label: 'Habit target', group: 'Progress & habit' }, { path: 'habit.unit', label: 'Habit unit', group: 'Progress & habit' },
  { path: 'habit.streakMode', label: 'Habit streak mode', group: 'Progress & habit' }, { path: 'habit.completedDates', label: 'Habit completed dates', group: 'Progress & habit' },
  { path: 'reminders', label: 'Reminders', group: 'Connections' }, { path: 'relations', label: 'Relations', group: 'Connections' },
  { path: 'subtasks', label: 'Subtasks', group: 'Connections' }, { path: 'parent', label: 'Parent item', group: 'Connections' },
  { path: 'isSubtask', label: 'Subtask', group: 'Connections' }, { path: 'isParent', label: 'Parent item', group: 'Connections' },
  { path: 'parentDepth', label: 'Parent depth', group: 'Connections' }, { path: 'childDepth', label: 'Child depth', group: 'Connections' },
  { path: 'attachments', label: 'Links', group: 'Connections' },
  { path: 'closure.at', label: 'Closed at', group: 'History' }, { path: 'closure.actor', label: 'Closed by', group: 'History' },
  { path: 'closure.reason', label: 'Closure reason', group: 'History' }, { path: 'occurrence.seriesId', label: 'Series ID', group: 'History' },
  { path: 'occurrence.recurrenceId', label: 'Occurrence date', group: 'History' }, { path: 'occurrence.sequence', label: 'Occurrence sequence', group: 'History' },
  { path: 'cycleHistory', label: 'Cycle history', group: 'History' },
  { path: 'createdAt', label: 'Created at', group: 'System' }, { path: 'updatedAt', label: 'Last modified', group: 'System' },
  { path: 'createdWithAppName', label: 'Created with app', group: 'System' }, { path: 'createdWithVersion', label: 'Created with version', group: 'System' },
  { path: 'createdWithAppId', label: 'Application ID', group: 'System' }, { path: 'schemaVersion', label: 'Schema version', group: 'System' },
  { path: 'revision', label: 'Revision', group: 'System' }, { path: 'id', label: 'Item ID', group: 'System' },
  { path: 'isTemplate', label: 'Template', group: 'System' },
];

export function inferredPreset(item: UniversalItem): ItemPreset {
  if (item.habit) return 'habit';
  if (item.schedule?.startAt && (item.schedule.endAt || item.schedule.allDay)) return 'event';
  if (!item.title.trim() && !item.bodyMarkdown.trim() && !item.schedule?.startAt && !item.schedule?.dueAt && !item.tags.length && !item.contexts.length) return 'blank';
  return 'task';
}

export function isHabitOccurrence(workspace: WorkspaceDocument, item: UniversalItem): boolean {
  return item.role === 'occurrence' && Boolean(item.occurrence?.seriesId && workspace.items[item.occurrence.seriesId]?.habit);
}

export function isItemTemplate(item: UniversalItem): boolean { return item.extensions?.['utm:template'] === true; }

export function relationContext(workspace: WorkspaceDocument, item: UniversalItem) {
  const parents = new Map<string, string[]>();
  Object.values(workspace.items).forEach((candidate) => candidate.relations.filter((relation) => relation.type === 'parent').forEach((relation) => parents.set(relation.targetId, [...(parents.get(relation.targetId) ?? []), candidate.id])));
  const children = (id: string) => (workspace.items[id]?.relations ?? [])
    .filter((relation) => relation.type === 'parent' && Boolean(workspace.items[relation.targetId]))
    .map((relation) => relation.targetId);
  const distance = (start: string, next: (id: string) => string[]) => { const seen = new Set([start]); let frontier = [start]; for (let depth = 1; depth <= 3; depth += 1) { frontier = frontier.flatMap(next).filter((id) => !seen.has(id)); frontier.forEach((id) => seen.add(id)); if (frontier.length) return depth; } return 0; };
  const parentDepth = distance(item.id, (id) => parents.get(id) ?? []); const childDepth = distance(item.id, children);
  return { isSubtask: parentDepth > 0, isParent: childDepth > 0, parentDepth, childDepth };
}

export const viewFieldOptions = (workspace: WorkspaceDocument): ViewFieldOption[] => {
  const scriptFields = new Map<string, ViewFieldOption>();
  Object.values(workspace.items).flatMap((item) => item.scripts ?? []).forEach((script) => {
    if (!scriptFields.has(script.key)) scriptFields.set(script.key, { path: `script.${script.key}`, label: script.label, group: 'Scripts' });
  });
  return [
    ...builtInViewFields,
    ...Object.values(workspace.customFields).map((field) => ({ path: `custom.${field.key}`, label: field.label, group: 'Custom fields' })),
    ...scriptFields.values(),
  ];
};

export const viewFieldLabel = (workspace: WorkspaceDocument, path: string) => viewFieldOptions(workspace).find((field) => field.path === path)?.label ?? path;

export const exampleViewFieldValue = (path: string): string => {
  if (path.startsWith('custom.')) return 'Example value';
  return ({
    title: 'Prepare quarterly review', bodyMarkdown: 'Outline, research and final draft', state: 'Active', preset: 'Task', role: 'Standalone', priority: 'High',
    tags: 'work, writing', contexts: 'office, laptop', 'schedule.availableFrom': 'Aug 24, 09:00', 'schedule.startAt': 'Aug 24, 10:00',
    'schedule.endAt': 'Aug 24, 11:30', 'schedule.dueAt': 'Aug 28, 18:00', 'schedule.estimatedDuration': '1 hour 30 min',
    'schedule.actualDuration': '1 hour 20 min', 'schedule.timezone': 'Europe/Moscow', 'schedule.allDay': 'No',
    'recurrence.rrule': 'Every week on Monday', 'recurrence.rdates': 'Sep 1, 10:00', 'recurrence.exdates': 'Sep 8, 10:00',
    'recurrence.timezone': 'Europe/Moscow', 'recurrence.activationOffset': '7 days before', 'recurrence.dueOffset': '8 hours after start',
    'recurrence.closeAt': 'Next activation', 'recurrence.anchor': 'Scheduled time', 'recurrence.autoRenew': 'Yes',
    'progress.mode': 'Counter', 'progress.current': '2', 'progress.target': '4', 'progress.unit': 'chapters',
    'habit.target': '1', 'habit.unit': 'time', 'habit.streakMode': 'Manual only', 'habit.completedDates': 'Aug 18, Aug 19',
    reminders: 'Mon 09:00 · Thu 17:00', relations: 'Related: Project brief', attachments: 'Research link',
    'closure.at': 'Aug 28, 17:42', 'closure.actor': 'You', 'closure.reason': 'Completed', 'occurrence.seriesId': 'Weekly review',
    'occurrence.recurrenceId': 'Aug 24, 10:00', 'occurrence.sequence': '12', cycleHistory: '4 finished cycles', subtasks: 'Draft outline, Review notes', parent: 'Quarterly review',
    isSubtask: 'Yes', isParent: 'Yes', parentDepth: '1', childDepth: '2', createdAt: 'Aug 12, 14:20', updatedAt: 'Today, 09:45',
    createdWithAppName: 'Universal Task Manager', createdWithVersion: APP_VERSION, createdWithAppId: 'dev.universal-task-manager',
    schemaVersion: '1.9.0', revision: '7', id: 'itm_example_20260824',
  } as Record<string, string>)[path] ?? 'Example value';
};

export const formatComputedDuration = (milliseconds: number): string => {
  const sign = milliseconds < 0 ? '−' : '';
  const totalSeconds = Math.round(Math.abs(milliseconds) / 1_000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [days ? `${days} d` : '', hours ? `${hours} h` : '', minutes ? `${minutes} min` : '', seconds ? `${seconds} s` : ''].filter(Boolean).slice(0, 3);
  return `${sign}${parts.join(' ') || '0 s'}`;
};

export const formatScriptResult = (value: unknown, kind: ItemScriptField['resultKind']): string => kind === 'duration' && typeof value === 'number' ? formatComputedDuration(value) : String(value ?? '—');

export const readItemField = (item: UniversalItem, field: string, workspace?: WorkspaceDocument, now = new Date()): unknown => {
  if (field === 'description') field = 'bodyMarkdown';
  if (field === 'dueTodayOrOverdue' || field === 'dueThisWeekOrOverdue') return dueDateBuckets(item, now, { timeZone: workspace?.calendarPreferences.timezone, weekStartsOn: workspace?.calendarPreferences.weekStartsOn })[field];
  if (field === 'schedule.estimatedDuration') {
    if (item.schedule?.estimatedDuration) return item.schedule.estimatedDuration;
    if (item.schedule?.startAt && item.schedule?.endAt) {
      const milliseconds = new Date(item.schedule.endAt).getTime() - new Date(item.schedule.startAt).getTime();
      if (Number.isFinite(milliseconds) && milliseconds >= 0) return toIsoDuration(milliseconds / 60_000, 'minutes');
    }
    return undefined;
  }
  if (workspace && field === 'subtasks') return item.relations.filter((relation) => relation.type === 'parent').map((relation) => workspace.items[relation.targetId]?.title ?? relation.targetId);
  if (workspace && field === 'parent') {
    const parent = Object.values(workspace.items).find((candidate) => candidate.relations.some((relation) => relation.type === 'parent' && relation.targetId === item.id));
    return parent?.title;
  }
  if (workspace && ['isTemplate', 'isSubtask', 'isParent', 'parentDepth', 'childDepth'].includes(field)) {
    if (field === 'isTemplate') return isItemTemplate(item);
    const relation = relationContext(workspace, item);
    return relation[field as keyof typeof relation];
  }
  if (field.startsWith('custom.') && workspace) {
    const key = field.slice(7);
    const definition = Object.values(workspace.customFields).find((candidate) => candidate.key === key);
    if (definition?.kind === 'formula') return evaluateFormulas(item, Object.values(workspace.customFields), now).values[key];
  }
  if (field.startsWith('script.') && workspace) {
    const key = field.slice(7);
    const definition = item.scripts?.find((script) => script.key === key);
    const result = evaluateItemScripts(item, (id) => workspace.items[id], now).values[key];
    if (definition?.resultKind === 'duration' && typeof result === 'number') return formatComputedDuration(result);
    return result;
  }
  return field.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, item);
};

export const displayViewValue = (value: unknown, field: string, language?: WorkspaceLanguage): string => {
  if (value === undefined || value === null || value === '') return '';
  if ((field.endsWith('Duration') || field.endsWith('Offset')) && typeof value === 'string' && /^P/.test(value)) {
    const parsed = parseFriendlyDuration(value);
    const totalMinutes = Math.round(calendarDurationMs(parsed.amount, parsed.unit) / 60_000);
    if (totalMinutes < 60) return `${totalMinutes} min`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours} h${minutes ? ` ${minutes} min` : ''}`;
  }
  if ((field.endsWith('At') || field.endsWith('Date') || field === 'createdAt' || field === 'updatedAt') && typeof value === 'string') {
    const date = new Date(value); if (!Number.isNaN(date.getTime())) return formatViewDate(date, true, language);
  }
  if (field.startsWith('script.') && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const date = new Date(value); if (!Number.isNaN(date.getTime())) return formatViewDate(date, true, language);
  }
  if (Array.isArray(value)) return value.length ? value.map((entry) => typeof entry === 'object' ? JSON.stringify(entry) : String(entry)).join(', ') : '';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
};
