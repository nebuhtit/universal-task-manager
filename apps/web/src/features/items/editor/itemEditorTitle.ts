import { withinDay, withinTargets, type UniversalItem, type WorkspaceDocument } from '@utm/core';
import { applyQuickEntryEditorText, quickEntrySource, syncQuickEntrySource } from '../quickEntry';
import { clearCreationDefaultBounds, withoutCreationDefaultBounds } from '../creationDefaultBounds';
import { extractWithinRelations } from '../../../../quick-entry-lab/relations';

const commaList = (value: string) => value.split(',').map((part) => part.trim()).filter(Boolean);

/**
 * Interpret the title draft only when the field is committed. Keeping this pure
 * lets the textarea remain responsive without rebuilding the complete editor on
 * every keystroke, while Save still applies the exact latest text synchronously.
 */
export function applyEditorTitleDraft(current: UniversalItem, initial: UniversalItem, text: string, tags: string, now: Date, workspace?: WorkspaceDocument): UniversalItem {
  // Use the same editor parser for validation and application: it restores
  // compact dates and hidden reminders before checking existing event bounds.
  const fromSource = Boolean(quickEntrySource(initial));
  const { item: interpreted, draft: parsed } = applyQuickEntryEditorText(fromSource ? { ...current, tags: commaList(tags) } : current, text, now);
  const anchor = (item: UniversalItem): UniversalItem => {
    // Resolve a newly selected undated relation now, not at the old item's creation.
    if (!workspace || !withinTargets(item).length || item.schedule?.plannedDate || item.schedule?.startAt || item.schedule?.endAt || item.schedule?.dueAt) return item;
    const day = withinDay(workspace, { ...item, createdAt: now.toISOString() });
    if (!day) return item;
    const source = quickEntrySource(item);
    return { ...item, schedule: { timezone: workspace.calendarPreferences.timezone, ...item.schedule, plannedDate: day }, extensions: { ...item.extensions, 'utm:withinNotBefore': now.toISOString(), ...(source ? { 'utm:quickEntrySource': { ...source, text: `${source.text} ${day.split('-').reverse().join('.')}` } } : {}) } };
  };
  if (fromSource) return anchor(interpreted);
  const hasWithinCommand = extractWithinRelations(text).ids.length > 0;
  const base = hasWithinCommand ? withoutCreationDefaultBounds(current) : current;
  // Plain-title drafts retain fields that were edited elsewhere in the form.
  // Commands explicitly present in the draft still update their own fields.
  const schedule = { ...interpreted.schedule!, ...base.schedule };
  if (parsed.plannedDate) { schedule.plannedDate = parsed.plannedDate; delete schedule.startAt; delete schedule.endAt; }
  if (parsed.start) {
    const previousSpan = current.schedule?.startAt && current.schedule?.endAt
      ? Date.parse(current.schedule.endAt) - Date.parse(current.schedule.startAt) : 0;
    schedule.startAt = parsed.start;
    const nextEnd = previousSpan > 0 && !/(?:конец|ends?|event ends|по|to|длительность|duration)\s+/i.test(text)
      ? new Date(Date.parse(parsed.start) + previousSpan).toISOString() : parsed.end;
    if (nextEnd) schedule.endAt = nextEnd;
  } else if (parsed.end) schedule.endAt = parsed.end;
  if (parsed.due) schedule.dueAt = parsed.due;
  if (parsed.travelMinutes !== null && interpreted.schedule?.travelDuration) schedule.travelDuration = interpreted.schedule.travelDuration;
  if (parsed.travelBackMinutes !== undefined && interpreted.schedule?.travelBackDuration) schedule.travelBackDuration = interpreted.schedule.travelBackDuration;
  if (parsed.durationMinutes !== null && interpreted.schedule?.estimatedDuration) {
    schedule.estimatedDuration = interpreted.schedule.estimatedDuration;
    if (!parsed.end && schedule.startAt && schedule.endAt) {
      schedule.endAt = new Date(Date.parse(schedule.startAt) + parsed.durationMinutes * 60_000).toISOString();
    }
  } else if (parsed.end && schedule.startAt) {
    const span = Date.parse(parsed.end) - Date.parse(schedule.startAt);
    if (Number.isFinite(span) && span > 0) schedule.estimatedDuration = `PT${span / 60_000}M`;
  }
  let result = { ...base, title: parsed.title, schedule, relations: interpreted.relations, ...(interpreted.canBeCompleted !== undefined ? { canBeCompleted: interpreted.canBeCompleted } : {}), reminders: parsed.reminders.length ? interpreted.reminders : current.reminders };
  if (parsed.start || parsed.end) result = clearCreationDefaultBounds(result) as typeof result;
  // Keep selected IDs in the canonical source too, so reopening restores chips
  // and removing one can remove its relation instead of leaving a hidden link.
  return anchor(hasWithinCommand ? { ...result, extensions: interpreted.extensions ?? {} } : syncQuickEntrySource(current, result));
}
