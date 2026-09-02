import { ACTIVE_ITEM_VIEW_QUERY, LEGACY_ACTIVE_ITEM_VIEW_QUERY, createId } from '@utm/core';

export type VisualConditionRow = { id: string; join: 'and' | 'or'; field: string; operator: string; value: string };
export type SchedulePeriodValue = {
  period: 'today' | 'tomorrow' | 'this_week' | 'next_week' | 'next_days' | 'custom';
  sources: Array<'event_open' | 'event' | 'active' | 'due'>;
  includeOverdue: boolean;
  nextDays: number;
  customStart: string;
  customEnd: string;
};
export type ReminderPeriodValue = {
  period: SchedulePeriodValue['period'];
  relation: 'before' | 'in' | 'after';
  nextDays: number;
  customStart: string;
  customEnd: string;
};
export const schedulePeriodField = 'schedulePeriod';
export const reminderPeriodField = 'reminderPeriod';
export const defaultSchedulePeriodValue = (): SchedulePeriodValue => ({ period: 'today', sources: ['event_open', 'active', 'due'], includeOverdue: false, nextDays: 7, customStart: '', customEnd: '' });
export const defaultReminderPeriodValue = (): ReminderPeriodValue => ({ period: 'today', relation: 'in', nextDays: 7, customStart: '', customEnd: '' });
export const parseSchedulePeriodValue = (value: string): SchedulePeriodValue => {
  try {
    const parsed = JSON.parse(value) as Partial<SchedulePeriodValue>;
    const allowedPeriods = ['today', 'tomorrow', 'this_week', 'next_week', 'next_days', 'custom'] as const;
    const allowedSources = ['event_open', 'event', 'active', 'due'] as const;
    return {
      period: allowedPeriods.includes(parsed.period as typeof allowedPeriods[number]) ? parsed.period as SchedulePeriodValue['period'] : 'today',
      sources: Array.isArray(parsed.sources) ? parsed.sources.filter((source): source is SchedulePeriodValue['sources'][number] => allowedSources.includes(source as typeof allowedSources[number])) : ['event_open', 'active', 'due'],
      includeOverdue: parsed.includeOverdue === true,
      nextDays: Math.max(1, Math.floor(Number(parsed.nextDays) || 7)),
      customStart: typeof parsed.customStart === 'string' ? parsed.customStart : '',
      customEnd: typeof parsed.customEnd === 'string' ? parsed.customEnd : '',
    };
  } catch { return defaultSchedulePeriodValue(); }
};
export const parseReminderPeriodValue = (value: string): ReminderPeriodValue => {
  try {
    const parsed = JSON.parse(value) as Partial<ReminderPeriodValue>;
    const allowedPeriods = ['today', 'tomorrow', 'this_week', 'next_week', 'next_days', 'custom'] as const;
    const allowedRelations = ['before', 'in', 'after'] as const;
    return {
      period: allowedPeriods.includes(parsed.period as typeof allowedPeriods[number]) ? parsed.period as ReminderPeriodValue['period'] : 'today',
      relation: allowedRelations.includes(parsed.relation as typeof allowedRelations[number]) ? parsed.relation as ReminderPeriodValue['relation'] : 'in',
      nextDays: Math.max(1, Math.floor(Number(parsed.nextDays) || 7)),
      customStart: typeof parsed.customStart === 'string' ? parsed.customStart : '',
      customEnd: typeof parsed.customEnd === 'string' ? parsed.customEnd : '',
    };
  } catch { return defaultReminderPeriodValue(); }
};
export const visualOptions: Record<string, string[]> = {
  state: ['open', 'done', 'auto_closed', 'cancelled', 'archived'], preset: ['task', 'event', 'habit', 'blank'],
  isHabit: ['true', 'false'], isTemplate: ['true', 'false'], isSubtask: ['true', 'false'], isParent: ['true', 'false'], activeRange: ['true', 'false'], activeDuration: ['true', 'false'], hasActiveReminders: ['true', 'false'], eventToday: ['true', 'false'], eventThisWeek: ['true', 'false'], dueTodayOrOverdue: ['true', 'false'], dueThisWeekOrOverdue: ['true', 'false'], 'schedule.allDay': ['true', 'false'], role: ['standalone', 'series_template', 'occurrence'], priority: ['0', '1', '2', '3', '4'], 'external.provider': ['google_calendar'],
};
export const visualFieldKinds: Record<string, 'enum' | 'boolean' | 'number' | 'date' | 'text' | 'multi'> = {
  state: 'enum', preset: 'enum', role: 'enum', isHabit: 'boolean', isTemplate: 'boolean', isSubtask: 'boolean', isParent: 'boolean', activeRange: 'boolean', activeDuration: 'boolean', hasActiveReminders: 'boolean', eventToday: 'boolean', eventThisWeek: 'boolean', dueTodayOrOverdue: 'boolean', dueThisWeekOrOverdue: 'boolean', 'schedule.allDay': 'boolean', priority: 'number', 'external.provider': 'enum',
  'schedule.startAt': 'date', 'schedule.endAt': 'date', 'schedule.dueAt': 'date', 'schedule.availableFrom': 'date', nextReminderAt: 'date', title: 'text', description: 'text', area: 'text', project: 'text', list: 'text', tags: 'multi', contexts: 'multi', reminders: 'multi', subtasks: 'multi', parent: 'text',
};
export const visualOperators = (field: string): string[] => {
  if (field === schedulePeriodField || field === reminderPeriodField) return ['matches'];
  if (field === 'reminders') return ['is set', 'is not set'];
  const kind = visualFieldKinds[field] ?? 'text'; const presence = ['is set', 'is not set'];
  if (kind === 'number' || kind === 'date') return [...presence, '==', '!=', '>', '>=', '<', '<='];
  if (kind === 'boolean' || kind === 'enum') return [...presence, '==', '!=', 'in'];
  if (kind === 'multi') return [...presence, 'has any', 'has all', 'has none'];
  return [...presence, '==', '!=', 'contains'];
};

export const visualFilterFieldLabel = (field: string, fallback: string): string => {
  if (field === 'reminders') return 'Any reminders';
  if (field === 'nextReminderAt') return 'Next resolved active reminder';
  return fallback;
};

export const isReminderVisualField = (field: string): boolean =>
  field === 'reminders' || field === 'hasActiveReminders' || field === 'nextReminderAt' || field === reminderPeriodField;
const commaList = (value: string) => value.split(',').map((part) => part.trim()).filter(Boolean);
const literal = (value: string) => ['true', 'false', 'null'].includes(value) || (!Number.isNaN(Number(value)) && value.trim() !== '') ? value : JSON.stringify(value);
const visualClause = (row: Pick<VisualConditionRow, 'field' | 'operator' | 'value'>) => {
  if (row.field === schedulePeriodField) {
    const value = parseSchedulePeriodValue(row.value);
    return `scheduleInPeriod(${JSON.stringify(value.period)}, ${JSON.stringify(value.sources.join(','))}, ${value.includeOverdue}, ${value.nextDays}, ${JSON.stringify(value.customStart)}, ${JSON.stringify(value.customEnd)})`;
  }
  if (row.field === reminderPeriodField) {
    const value = parseReminderPeriodValue(row.value);
    return `nextReminderInPeriod(${JSON.stringify(value.period)}, ${JSON.stringify(value.relation)}, ${value.nextDays}, ${JSON.stringify(value.customStart)}, ${JSON.stringify(value.customEnd)})`;
  }
  const presenceExpression = visualFieldKinds[row.field] === 'multi' || visualFieldKinds[row.field] === 'text' ? `length(${row.field}) > 0` : `${row.field} != null`;
  if (row.operator === 'is set') return presenceExpression;
  if (row.operator === 'is not set') return visualFieldKinds[row.field] === 'multi' || visualFieldKinds[row.field] === 'text' ? `length(${row.field}) == 0` : `${row.field} == null`;
  if (row.field === 'tags' || row.field === 'contexts') {
    const values = commaList(row.value); if (!values.length) return 'true';
    const checks = values.map((value) => `includes(${row.field}, ${JSON.stringify(value)})`);
    if (row.operator === 'has all') return checks.join(' && ');
    if (row.operator === 'has none') return `!(${checks.join(' || ')})`;
    return `(${checks.join(' || ')})`;
  }
  return `${row.field} ${row.operator === 'contains' ? 'in' : row.operator} ${literal(row.value)}`;
};
export const serializeVisualRows = (rows: VisualConditionRow[]) => rows.reduce((source, row, index) => index === 0 ? visualClause(row) : `(${source} ${row.join === 'or' ? '||' : '&&'} ${visualClause(row)})`, '');
export const parseVisualRows = (source: string): VisualConditionRow[] | null => {
  const legacyPeriodSources: Record<string, string> = {
    [`${LEGACY_ACTIVE_ITEM_VIEW_QUERY} && (eventToday == true || dueTodayOrOverdue == true)`]: `(((${ACTIVE_ITEM_VIEW_QUERY}) && scheduleInPeriod("today", "event,due", true, 7, "", "")))`,
    [`${LEGACY_ACTIVE_ITEM_VIEW_QUERY} && (eventThisWeek == true || dueThisWeekOrOverdue == true)`]: `(((${ACTIVE_ITEM_VIEW_QUERY}) && scheduleInPeriod("this_week", "event,due", true, 7, "", "")))`,
    [`${ACTIVE_ITEM_VIEW_QUERY} && (eventToday == true || dueTodayOrOverdue == true)`]: `(((${ACTIVE_ITEM_VIEW_QUERY}) && scheduleInPeriod("today", "event,due", true, 7, "", "")))`,
    [`${ACTIVE_ITEM_VIEW_QUERY} && (eventThisWeek == true || dueThisWeekOrOverdue == true)`]: `(((${ACTIVE_ITEM_VIEW_QUERY}) && scheduleInPeriod("this_week", "event,due", true, 7, "", "")))`,
  };
  source = legacyPeriodSources[source.trim()] ?? source;
  const strip = (value: string) => { let result = value.trim(); while (result.startsWith('(') && result.endsWith(')')) { let depth = 0, quoted = false, escaped = false, whole = true; for (let index = 0; index < result.length; index += 1) { const character = result[index]!; if (escaped) { escaped = false; continue; } if (character === '\\' && quoted) { escaped = true; continue; } if (character === '"') { quoted = !quoted; continue; } if (quoted) continue; if (character === '(') depth += 1; if (character === ')') depth -= 1; if (depth === 0 && index < result.length - 1) { whole = false; break; } } if (!whole || depth !== 0) break; result = result.slice(1, -1).trim(); } return result; };
  const split = (value: string): { left: string; join: 'and' | 'or'; right: string } | null => { let depth = 0, quoted = false, escaped = false; let match: { index: number; join: 'and' | 'or' } | null = null; for (let index = 0; index < value.length - 1; index += 1) { const character = value[index]!; if (escaped) { escaped = false; continue; } if (character === '\\' && quoted) { escaped = true; continue; } if (character === '"') { quoted = !quoted; continue; } if (quoted) continue; if (character === '(') depth += 1; else if (character === ')') depth -= 1; else if (depth === 0 && value.slice(index, index + 2) === '&&') { match = { index, join: 'and' }; index += 1; } else if (depth === 0 && value.slice(index, index + 2) === '||') { match = { index, join: 'or' }; index += 1; } } return match ? { left: value.slice(0, match.index).trim(), join: match.join, right: value.slice(match.index + 2).trim() } : null; };
  const clause = (value: string, join: 'and' | 'or'): VisualConditionRow | null => { const text = strip(value); const schedule = /^scheduleInPeriod\("(today|tomorrow|this_week|next_week|next_days|custom)",\s*"([a-z_,]*)",\s*(true|false),\s*(\d+),\s*"(\d{4}-\d{2}-\d{2}|)",\s*"(\d{4}-\d{2}-\d{2}|)"\)$/.exec(text); if (schedule) return { id: createId(), join, field: schedulePeriodField, operator: 'matches', value: JSON.stringify({ period: schedule[1], sources: schedule[2]!.split(',').filter(Boolean), includeOverdue: schedule[3] === 'true', nextDays: Number(schedule[4]), customStart: schedule[5], customEnd: schedule[6] }) }; const reminder = /^nextReminderInPeriod\("(today|tomorrow|this_week|next_week|next_days|custom)",\s*"(before|in|after)",\s*(\d+),\s*"(\d{4}-\d{2}-\d{2}|)",\s*"(\d{4}-\d{2}-\d{2}|)"\)$/.exec(text); if (reminder) return { id: createId(), join, field: reminderPeriodField, operator: 'matches', value: JSON.stringify({ period: reminder[1], relation: reminder[2], nextDays: Number(reminder[3]), customStart: reminder[4], customEnd: reminder[5] }) }; const lengthPresence = /^length\(([\w.]+)\)\s*(>|==)\s*0$/.exec(text); if (lengthPresence) return { id: createId(), join, field: lengthPresence[1]!, operator: lengthPresence[2] === '>' ? 'is set' : 'is not set', value: '' }; const presence = /^([\w.]+)\s*(==|!=)\s*null$/.exec(text); const normal = /^([\w.]+)\s*(==|!=|>=|<=|>|<|in)\s*("(?:[^"\\]|\\.)*"|true|false|null|-?\d+(?:\.\d+)?)$/.exec(text); const match = presence ?? normal; if (!match) return null; let operator = match[2]!, parsed = ''; if (presence) operator = presence[2] === '!=' ? 'is set' : 'is not set'; else if (normal?.[3]) { try { parsed = String(JSON.parse(normal[3])); } catch { parsed = normal[3]; } } return { id: createId(), join, field: match[1]!, operator, value: parsed }; };
  const expression = (value: string): VisualConditionRow[] | null => { const text = strip(value); const parts = split(text); if (!parts) { const row = clause(text, 'and'); return row ? [row] : null; } const left = expression(parts.left); const right = clause(parts.right, parts.join); return left && right ? [...left, right] : null; };
  return source.trim() ? expression(source.trim()) : [];
};
export const toSqlExpression = (source: string): string => source.trim() ? source.trim().replace(/\bactiveRange\b/g, 'active_range').replace(/==/g, '=').replace(/!=/g, '<>').replace(/&&/g, ' AND ').replace(/\|\|/g, ' OR ').replace(/\btrue\b/gi, 'TRUE').replace(/\bfalse\b/gi, 'FALSE').replace(/\bnull\b/gi, 'NULL').replace(/includes\(([^,]+),\s*([^\)]+)\)/g, '$2 = ANY($1)').replace(/\s+/g, ' ').trim() : 'TRUE';
