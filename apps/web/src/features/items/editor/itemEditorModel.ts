import { buildRecurrenceRule, makeSeries, parseExpression, removeDuplicateReminders, type UniversalItem, type WorkspaceDocument } from '@utm/core';
import { inferredPreset } from '../fieldDisplay';

const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const commaList = (value: string) => value.split(',').map((part) => part.trim()).filter(Boolean);

export function withoutTemplateMarker(item: UniversalItem): UniversalItem {
  const next = clean(item);
  if (next.extensions) {
    delete next.extensions['utm:template'];
    if (Object.keys(next.extensions).length === 0) delete next.extensions;
  }
  return next;
}

export type NormalizeItemEditorInput = {
  item: UniversalItem; workspace: WorkspaceDocument; tags: string; contexts: string; isTemplate: boolean; recurring: boolean; activeRange: boolean;
  repeatFrequency: string; repeatIntervalDraft: string; repeatDays: string[]; now?: Date;
};

export function normalizeItemForSave(input: NormalizeItemEditorInput): UniversalItem {
  const { item, workspace, isTemplate, recurring, activeRange, repeatFrequency, repeatIntervalDraft, repeatDays } = input;
  const now = input.now ?? new Date();
  if (!item.title.trim()) throw new Error('Add a title before saving.');
  const scriptKeys = new Set<string>();
  for (const script of item.scripts ?? []) {
    if (!script.label.trim()) throw new Error('Every script needs a name.');
    if (!/^[a-z][a-z0-9_]*$/.test(script.key)) throw new Error(`Script key “${script.key}” must start with a letter and use lowercase letters, numbers or underscores.`);
    if (scriptKeys.has(script.key)) throw new Error(`Script key “${script.key}” is duplicated.`);
    scriptKeys.add(script.key); parseExpression(script.source);
  }
  let result = {
    ...clean(item), title: item.title.trim(), tags: commaList(input.tags), contexts: commaList(input.contexts),
    areas: [...new Set([...(item.areas ?? []), ...(item.area ? [item.area] : [])].map((value) => value.trim()).filter(Boolean))],
    projects: [...new Set([...(item.projects ?? []), ...(item.project ? [item.project] : [])].map((value) => value.trim()).filter(Boolean))],
    updatedAt: now.toISOString(), revision: item.revision + (workspace.items[item.id] ? 1 : 0),
  };
  delete result.area; delete result.project;
  const opensAt = result.schedule?.startAt ? Date.parse(result.schedule.startAt) : Number.NaN;
  const endsAt = result.schedule?.endAt ? Date.parse(result.schedule.endAt) : Number.NaN;
  const dueAt = result.schedule?.dueAt ? Date.parse(result.schedule.dueAt) : Number.NaN;
  if (Number.isFinite(opensAt) && Number.isFinite(endsAt) && endsAt < opensAt) throw new Error('Event ends cannot be earlier than Event opens.');
  if (Number.isFinite(opensAt) && Number.isFinite(dueAt) && dueAt < opensAt) throw new Error('Due / Active range ends cannot be earlier than Event opens.');
  result = withoutTemplateMarker(result); result.extensions = { ...result.extensions };
  if (isTemplate) result.extensions['utm:template'] = true;
  const existing = workspace.items[item.id];
  if (existing) { result.createdWithAppId = existing.createdWithAppId; result.createdWithAppName = existing.createdWithAppName; result.createdWithVersion = existing.createdWithVersion; }
  if (recurring) {
    const anchor = result.schedule?.startAt ?? result.schedule?.dueAt;
    if (!anchor) throw new Error('A recurring item needs a Scheduled start or Deadline.');
    if (activeRange && (!result.schedule?.startAt || !result.schedule?.dueAt)) throw new Error('Active range needs both Event opens and Due / Active range ends.');
    const recurrence = result.recurrence;
    const parts = new Map((recurrence?.rrule ?? 'FREQ=WEEKLY;INTERVAL=1').replace(/^RRULE:/i, '').split(';').filter(Boolean).map((part) => { const [key, ...rest] = part.split('='); return [key!.trim().toUpperCase(), rest.join('=').trim()]; }));
    parts.set('FREQ', repeatFrequency || 'WEEKLY'); parts.set('INTERVAL', String(Math.max(1, Number.parseInt(repeatIntervalDraft, 10) || 1)));
    if (activeRange || repeatFrequency !== 'WEEKLY' || !repeatDays.length) parts.delete('BYDAY'); else parts.set('BYDAY', repeatDays.join(','));
    const normalizedRecurrence: NonNullable<UniversalItem['recurrence']> = { rrule: [...parts].map(([key, value]) => `${key}=${value}`).join(';'), rdates: Array.isArray(recurrence?.rdates) ? [...recurrence.rdates] : [], exdates: Array.isArray(recurrence?.exdates) ? [...recurrence.exdates] : [], timezone: recurrence?.timezone ?? result.schedule?.timezone ?? 'UTC', activationOffset: recurrence?.activationOffset ?? 'P7D', closeAt: recurrence?.closeAt ?? 'next_activation', anchor: recurrence?.anchor ?? 'schedule', autoRenew: recurrence?.autoRenew !== false };
    result.recurrence = normalizedRecurrence;
    result = { ...result, schedule: { ...result.schedule!, startAt: anchor } }; buildRecurrenceRule(result);
    result = makeSeries(result, normalizedRecurrence.rrule, { ...normalizedRecurrence, activationOffset: normalizedRecurrence.activationOffset ?? 'P7D' });
  } else { result.role = 'standalone'; delete result.recurrence; }
  if (result.state === 'done' || result.state === 'cancelled') result.closure = { at: result.closure?.at ?? now.toISOString(), actor: result.closure?.actor ?? 'user', reason: result.state === 'cancelled' ? 'cancelled' : 'manual' };
  else if (result.state === 'open') delete result.closure;
  if (result.habit) result.habit = { target: result.habit.target ?? result.progress?.target ?? 1, unit: result.habit.unit ?? 'times', streakMode: result.habit.streakMode ?? 'manual_only', completedDates: result.habit.completedDates ?? [], ...(result.habit.activeTimerStartedAt ? { activeTimerStartedAt: result.habit.activeTimerStartedAt } : {}), ...(result.habit.timerSessions?.length ? { timerSessions: result.habit.timerSessions } : {}) };
  result.preset = inferredPreset(result); removeDuplicateReminders(result); return clean(result);
}
