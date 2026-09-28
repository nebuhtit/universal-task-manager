import type { UniversalItem } from '@utm/core';
import { parseLiveEntry as parseEntry } from '../../../../quick-entry-lab/parser';
import { applyQuickEntryEditorText as applyQuickEntryText, quickEntrySource, syncQuickEntrySource } from '../quickEntry';

const commaList = (value: string) => value.split(',').map((part) => part.trim()).filter(Boolean);

/**
 * Interpret the title draft only when the field is committed. Keeping this pure
 * lets the textarea remain responsive without rebuilding the complete editor on
 * every keystroke, while Save still applies the exact latest text synchronously.
 */
export function applyEditorTitleDraft(current: UniversalItem, initial: UniversalItem, text: string, tags: string, now: Date): UniversalItem {
  const parsed = parseEntry(text, now);
  if (parsed.errors.length) throw new Error(parsed.errors.join(' '));
  if (quickEntrySource(initial)) return applyQuickEntryText({ ...current, tags: commaList(tags) }, text, now).item;

  const interpreted = applyQuickEntryText(current, text, now).item;
  // Plain-title drafts retain fields that were edited elsewhere in the form.
  // Commands explicitly present in the draft still update their own fields.
  const schedule = { ...interpreted.schedule!, ...current.schedule };
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
  if (parsed.durationMinutes !== null && interpreted.schedule?.estimatedDuration) schedule.estimatedDuration = interpreted.schedule.estimatedDuration;
  return syncQuickEntrySource(current, { ...current, title: parsed.title, schedule, reminders: parsed.reminders.length ? interpreted.reminders : current.reminders });
}
