import {
  APP_VERSION,
  dueDateBuckets,
  type ItemPreset,
  type ItemScriptField,
  type UniversalItem,
  type WorkspaceDocument,
  type WorkspaceLanguage,
} from '@utm/core';
import { calendarDurationMs, parseFriendlyDuration, toIsoDuration } from '../../utils/durations';
import { formatViewDate } from '../../utils/dates';
import { getWorkspaceIndex } from '../../services/workspaceIndex';

export const priorityNames: Record<NonNullable<UniversalItem['priority']>, string> = { 0: 'None', 1: 'Low', 2: 'Medium', 3: 'High', 4: 'Urgent' };
export const stateNames: Record<UniversalItem['state'], string> = { open: 'Active', done: 'Completed', auto_closed: 'Auto closed', cancelled: 'Cancelled', archived: 'Archived' };

export type ViewFieldOption = { path: string; label: string; group: string };

const builtInViewFields: ViewFieldOption[] = [
  { path: 'title', label: 'Title', group: 'Core' }, { path: 'bodyMarkdown', label: 'Description', group: 'Core' }, { path: 'location', label: 'Location', group: 'Core' },
  { path: 'state', label: 'State', group: 'Core' }, { path: 'preset', label: 'Preset', group: 'Core' },
  { path: 'isHabit', label: 'Habit', group: 'Core' }, { path: 'activeRange', label: 'Inside active range now', group: 'Core' }, { path: 'activeRangeWhenSet', label: 'Inside active range now (if set)', group: 'Core' }, { path: 'activeRangeWhenSetOrOverdue', label: 'Inside active range now (if set), or overdue', group: 'Core' },
  { path: 'activeDuration', label: 'Has active range dates', group: 'Core' },
  { path: 'eventToday', label: 'Event overlaps today', group: 'Schedule' },
  { path: 'eventThisWeek', label: 'Event overlaps this week', group: 'Schedule' },
  { path: 'dueTodayOrOverdue', label: 'Due today or overdue', group: 'Schedule' },
  { path: 'dueThisWeekOrOverdue', label: 'Due this week or overdue', group: 'Schedule' },
  { path: 'role', label: 'Role', group: 'Core' }, { path: 'priority', label: 'Priority', group: 'Core' },
  { path: 'tags', label: 'Tags', group: 'Core' }, { path: 'contexts', label: 'Contexts', group: 'Core' },
  { path: 'area', label: 'Areas', group: 'Organization' }, { path: 'project', label: 'Projects', group: 'Organization' }, { path: 'list', label: 'Task list', group: 'Organization' },
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
  { path: 'reminders', label: 'Active reminders', group: 'Reminders' }, { path: 'hasActiveReminders', label: 'Has active reminders', group: 'Reminders' },
  { path: 'nextReminderAt', label: 'Next resolved active reminder', group: 'Reminders' }, { path: 'relations', label: 'Relations', group: 'Connections' },
  { path: 'subtasks', label: 'Subtasks', group: 'Connections' }, { path: 'parent', label: 'Parent item', group: 'Connections' },
  { path: 'isSubtask', label: 'Subtask', group: 'Connections' }, { path: 'isParent', label: 'Parent item', group: 'Connections' },
  { path: 'parentDepth', label: 'Parent depth', group: 'Connections' }, { path: 'childDepth', label: 'Child depth', group: 'Connections' },
  { path: 'attachments', label: 'Links', group: 'Connections' },
  { path: 'external.provider', label: 'External source', group: 'Google Calendar' },
  { path: 'external.calendarId', label: 'Google calendar ID', group: 'Google Calendar' },
  { path: 'external.connectionId', label: 'Google connection ID', group: 'Google Calendar' },
  { path: 'external.eventId', label: 'Google event ID', group: 'Google Calendar' },
  { path: 'external.transparency', label: 'Google event availability', group: 'Google Calendar' },
  { path: 'external.sourceUrl', label: 'Google event link', group: 'Google Calendar' },
  { path: 'external.readOnly', label: 'External read-only item', group: 'Google Calendar' },
  { path: 'external.syncedAt', label: 'Last Google sync', group: 'Google Calendar' },
  { path: 'scripts', label: 'Script results', group: 'Scripts' },
  { path: 'closure.at', label: 'Closed at', group: 'History' }, { path: 'closure.actor', label: 'Closed by', group: 'History' },
  { path: 'closure.reason', label: 'Closure reason', group: 'History' }, { path: 'closure.automationId', label: 'Closing automation ID', group: 'History' },
  { path: 'occurrence.seriesId', label: 'Series ID', group: 'History' }, { path: 'occurrence.recurrenceId', label: 'Occurrence date', group: 'History' },
  { path: 'occurrence.sequence', label: 'Occurrence sequence', group: 'History' }, { path: 'occurrence.templateRevision', label: 'Occurrence template revision', group: 'History' },
  { path: 'recurrenceOverride.kind', label: 'Recurrence override kind', group: 'History' }, { path: 'recurrenceOverride.sourceSeriesId', label: 'Override source series ID', group: 'History' },
  { path: 'recurrenceOverride.recurrenceId', label: 'Override occurrence date', group: 'History' },
  { path: 'cycleHistory', label: 'Cycle history', group: 'History' },
  { path: 'timerHistory', label: 'Timer history', group: 'History' },
  { path: 'createdAt', label: 'Created at', group: 'System' }, { path: 'updatedAt', label: 'Last modified', group: 'System' },
  { path: 'deletedAt', label: 'Deleted at', group: 'System' },
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

export function createRelationContextResolver(workspace: WorkspaceDocument) {
  const index = getWorkspaceIndex(workspace);
  return (item: UniversalItem) => index.relationFor(item);
}

export function relationContext(workspace: WorkspaceDocument, item: UniversalItem) {
  return createRelationContextResolver(workspace)(item);
}

export const viewFieldOptions = (workspace: WorkspaceDocument, viewScripts: readonly ItemScriptField[] = []): ViewFieldOption[] => {
  const scriptFields = new Map<string, ViewFieldOption>();
  getWorkspaceIndex(workspace).scripts.allItemDefinitions.forEach((script) => {
    if (!scriptFields.has(script.key)) scriptFields.set(script.key, { path: `script.${script.key}`, label: script.label, group: 'Scripts' });
  });
  return [
    ...builtInViewFields,
    ...Object.values(workspace.customFields).map((field) => ({ path: `custom.${field.key}`, label: field.label, group: 'Custom fields' })),
    ...scriptFields.values(),
    ...(viewScripts.length ? [{ path: 'view_scripts', label: 'View script results', group: 'View scripts' }] : []),
    ...viewScripts.map((script) => ({ path: `view_script.${script.key}`, label: script.label, group: 'View scripts' })),
  ];
};

export const viewFieldLabel = (workspace: WorkspaceDocument, path: string, viewScripts: readonly ItemScriptField[] = []) => viewFieldOptions(workspace, viewScripts).find((field) => field.path === path)?.label ?? path;

export const exampleViewFieldValue = (path: string): string => {
  if (path.startsWith('custom.')) return 'Example value';
  if (path === 'scripts') return 'Remaining: 2h 14m · Finish: Aug 28, 18:00';
  if (path.startsWith('script.')) return '2h 14m';
  if (path === 'view_scripts') return 'Capacity: 6h · Remaining: 45min';
  if (path.startsWith('view_script.')) return '6h';
  return ({
    title: 'Prepare quarterly review', bodyMarkdown: 'Outline, research and final draft', state: 'Active', preset: 'Task', role: 'Standalone', priority: 'High',
    tags: 'work, writing', contexts: 'office, laptop', area: 'Work', project: 'Vehicle repair', list: 'This week', 'schedule.availableFrom': 'Aug 24, 09:00', 'schedule.startAt': 'Aug 24, 10:00',
    'schedule.endAt': 'Aug 24, 11:30', 'schedule.dueAt': 'Aug 28, 18:00', 'schedule.estimatedDuration': '1 hour 30 min',
    'schedule.actualDuration': '1 hour 20 min', 'schedule.timezone': 'Europe/Moscow', 'schedule.allDay': 'No',
    'recurrence.rrule': 'Every week on Monday', 'recurrence.rdates': 'Sep 1, 10:00', 'recurrence.exdates': 'Sep 8, 10:00',
    'recurrence.timezone': 'Europe/Moscow', 'recurrence.activationOffset': '7 days before', 'recurrence.dueOffset': '8 hours after start',
    'recurrence.closeAt': 'Next activation', 'recurrence.anchor': 'Scheduled time', 'recurrence.autoRenew': 'Yes',
    'progress.mode': 'Counter', 'progress.current': '2', 'progress.target': '4', 'progress.unit': 'chapters',
    'habit.target': '1', 'habit.unit': 'time', 'habit.streakMode': 'Manual only', 'habit.completedDates': 'Aug 18, Aug 19',
    reminders: 'Mon 09:00 · normal, Thu 17:00 · urgent', hasActiveReminders: 'Yes', nextReminderAt: 'Mon 09:00', relations: 'Related: Project brief', attachments: 'Research link',
    'external.provider': 'Google Calendar', 'external.calendarId': 'Primary calendar', 'external.connectionId': 'Google account', 'external.eventId': 'event_123',
    'external.transparency': 'Busy', 'external.sourceUrl': 'Open in Google Calendar', 'external.readOnly': 'Yes', 'external.syncedAt': 'Today, 09:45',
    'closure.at': 'Aug 28, 17:42', 'closure.actor': 'You', 'closure.reason': 'Completed', 'occurrence.seriesId': 'Weekly review',
    'occurrence.recurrenceId': 'Aug 24, 10:00', 'occurrence.sequence': '12', cycleHistory: '4 finished cycles', subtasks: 'Draft outline, Review notes', parent: 'Quarterly review',
    isSubtask: 'Yes', isParent: 'Yes', parentDepth: '1', childDepth: '2', createdAt: 'Aug 12, 14:20', updatedAt: 'Today, 09:45',
    createdWithAppName: 'Universal Task Manager', createdWithVersion: APP_VERSION, createdWithAppId: 'dev.universal-task-manager',
    schemaVersion: '1.17.0', revision: '7', id: 'itm_example_20260824',
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

const reminderLabels = (language: WorkspaceLanguage = 'en') => ({
  en: { available: 'Available from', start: 'Event opens', due: 'Due', end: 'Event ends', before: 'before', after: 'after', at: 'At', unresolved: 'Unresolved time', normal: 'normal', urgent: 'urgent', critical: 'critical' },
  ru: { available: 'Доступно с', start: 'Начало события', due: 'Срок', end: 'Конец события', before: 'до', after: 'после', at: 'В', unresolved: 'Время не определено', normal: 'обычное', urgent: 'срочное', critical: 'критическое' },
  es: { available: 'Disponible desde', start: 'Inicio del evento', due: 'Fecha límite', end: 'Fin del evento', before: 'antes de', after: 'después de', at: 'En', unresolved: 'Hora sin resolver', normal: 'normal', urgent: 'urgente', critical: 'crítico' },
  de: { available: 'Verfügbar ab', start: 'Ereignisbeginn', due: 'Fällig', end: 'Ereignisende', before: 'vor', after: 'nach', at: 'Um', unresolved: 'Zeit nicht bestimmbar', normal: 'normal', urgent: 'dringend', critical: 'kritisch' },
  fr: { available: 'Disponible à partir de', start: 'Début de l’événement', due: 'Échéance', end: 'Fin de l’événement', before: 'avant', after: 'après', at: 'À', unresolved: 'Heure non résolue', normal: 'normal', urgent: 'urgent', critical: 'critique' },
  ko: { available: '사용 가능', start: '이벤트 시작', due: '마감', end: '이벤트 종료', before: '전', after: '후', at: '시간', unresolved: '시간 미확정', normal: '일반', urgent: '긴급', critical: '매우 긴급' },
}[language]);

export const readItemField = (item: UniversalItem, field: string, workspace?: WorkspaceDocument, now = new Date(), viewScripts: readonly ItemScriptField[] = []): unknown => {
  const index = workspace ? getWorkspaceIndex(workspace) : undefined;
  if (field === 'description') field = 'bodyMarkdown';
  if (field === 'area' || field === 'areas') return [...new Set([...(item.areas ?? []), ...(item.area ? [item.area] : [])])];
  if (field === 'project' || field === 'projects') return [...new Set([...(item.projects ?? []), ...(item.project ? [item.project] : [])])];
  if (field === 'eventToday' || field === 'eventThisWeek' || field === 'dueTodayOrOverdue' || field === 'dueThisWeekOrOverdue') return dueDateBuckets(item, now, { timeZone: workspace?.calendarPreferences.timezone, weekStartsOn: workspace?.calendarPreferences.weekStartsOn })[field];
  if (field === 'schedule.estimatedDuration') {
    if (item.schedule?.estimatedDuration) return item.schedule.estimatedDuration;
    if (item.schedule?.startAt && item.schedule?.endAt) {
      const milliseconds = new Date(item.schedule.endAt).getTime() - new Date(item.schedule.startAt).getTime();
      if (Number.isFinite(milliseconds) && milliseconds >= 0) return toIsoDuration(milliseconds / 60_000, 'minutes');
    }
    return undefined;
  }
  if (field === 'hasActiveReminders') return (index?.remindersFor(item).length ?? item.reminders.filter((reminder) => !reminder.acknowledgedAt).length) > 0;
  if (field === 'nextReminderAt') return index?.remindersFor(item).find((entry) => entry.resolvedAt)?.resolvedAt;
  if (field === 'reminders') {
    const labels = reminderLabels(workspace?.calendarPreferences.language);
    const unitLabels = { seconds: 'sec', minutes: 'min', hours: 'h', days: 'd', weeks: 'wk', months: 'mo', years: 'y' } as const;
    return (index?.remindersFor(item) ?? []).map(({ reminder, resolvedAt: resolved }) => {
      if (resolved) return { reminder, resolved, label: `${formatViewDate(resolved, true, workspace?.calendarPreferences.language)} · ${labels[reminder.urgency]}` };
      if (reminder.mode === 'absolute') return { reminder, label: `${labels.unresolved} · ${labels[reminder.urgency]}` };
      const before = reminder.offset?.startsWith('-') === true;
      const normalized = reminder.offset?.replace(/^-/, '');
      const match = /^(?:P(\d+)([DWMY])|PT(\d+)([HMS]))$/.exec(normalized ?? '');
      const amount = Number(match?.[1] ?? match?.[3] ?? 0);
      const code = match?.[2] ?? match?.[4];
      const unit = code === 'S' ? 'seconds' : code === 'M' ? (match?.[3] ? 'minutes' : 'months') : code === 'H' ? 'hours' : code === 'W' ? 'weeks' : code === 'Y' ? 'years' : 'days';
      const relation = reminder.relativeTo ?? 'due';
      const timing = amount ? `${amount}${unitLabels[unit]} ${before ? labels.before : labels.after} ${labels[relation]}` : `${labels.at} ${labels[relation]}`;
      return { reminder, label: `${timing} · ${labels[reminder.urgency]}` };
    }).sort((left, right) => left.resolved && right.resolved ? Date.parse(left.resolved) - Date.parse(right.resolved) : left.resolved ? -1 : right.resolved ? 1 : 0).map((entry) => entry.label);
  }
  if (workspace && field === 'subtasks') return (index?.childIdsByItemId.get(item.id) ?? []).map((id) => workspace.items[id]?.title ?? id);
  if (workspace && field === 'parent') return index?.parentFor(item)?.title;
  if (workspace && ['isTemplate', 'isSubtask', 'isParent', 'parentDepth', 'childDepth'].includes(field)) {
    if (field === 'isTemplate') return isItemTemplate(item);
    const relation = index!.relationFor(item);
    return relation[field as keyof typeof relation];
  }
  if (field.startsWith('custom.') && workspace) {
    const key = field.slice(7);
    const definition = Object.values(workspace.customFields).find((candidate) => candidate.key === key);
    if (definition?.kind === 'formula') return index!.formulasFor(item, now).values[key];
  }
  if (field === 'scripts' && workspace) {
    const result = index!.itemScriptsFor(item, now);
    return (item.scripts ?? []).map((script) => {
      const value = result.errors[script.key] ?? formatScriptResult(result.values[script.key], script.resultKind);
      return `${script.label}: ${value}`;
    }).join(' · ');
  }
  if (field.startsWith('script.') && workspace) {
    const key = field.slice(7);
    const definition = item.scripts?.find((script) => script.key === key);
    const result = index!.itemScriptsFor(item, now).values[key];
    if (definition?.resultKind === 'duration' && typeof result === 'number') return formatComputedDuration(result);
    return result;
  }
  if (field === 'view_scripts' && workspace) {
    const result = index!.viewScriptsFor(item, viewScripts, now);
    return viewScripts.map((script) => {
      const value = result.errors[script.key] ?? formatScriptResult(result.values[script.key], script.resultKind);
      return `${script.label}: ${value}`;
    }).join(' · ');
  }
  if (field.startsWith('view_script.') && workspace) {
    const key = field.slice(12);
    const definition = viewScripts.find((script) => script.key === key);
    const result = index!.viewScriptsFor(item, viewScripts, now).values[key];
    if (definition?.resultKind === 'duration' && typeof result === 'number') return formatComputedDuration(result);
    return result;
  }
  return field.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, item);
};

export const displayViewValue = (value: unknown, field: string, language?: WorkspaceLanguage): string => {
  if (value === undefined || value === null || value === '') return '';
  if (field === 'external.provider' && value === 'google_calendar') return 'Google Calendar';
  if (field === 'external.transparency' && value === 'opaque') return 'Busy';
  if (field === 'external.transparency' && value === 'transparent') return 'Free';
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
  if ((field.startsWith('script.') || field.startsWith('view_script.')) && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const date = new Date(value); if (!Number.isNaN(date.getTime())) return formatViewDate(date, true, language);
  }
  if (Array.isArray(value)) return value.length ? value.map((entry) => typeof entry === 'object' ? JSON.stringify(entry) : String(entry)).join(', ') : '';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
};
