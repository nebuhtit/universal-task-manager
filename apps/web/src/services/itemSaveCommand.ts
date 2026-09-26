import { advanceCompletionAnchoredSeries, createId, ensureAreaDefinition, ensureProjectDefinition, ensureTagDefinition, ensureListDefinition, reconcileRecurrences, reconcileCalendarOrganization, runAutomationEvents, type UniversalItem, type WorkspaceDocument } from '@utm/core';
import { GOOGLE_SAVE_EXTENSION, type GoogleSaveOptions } from './googleItemSave';
import { googleActionItem } from '../features/items/editor/itemEditorSource';
import { recordCompletionTransition, syncCompletionCounter } from '@utm/core';

export interface ItemSaveIntent {
  /** Exact cycle selected before the editor resolved to its series settings. */
  completionOccurrenceId?: string;
  convertedProject?: string;
  google?: GoogleSaveOptions;
  /** Set only after the user confirms removing the remote event. */
  deleteGoogleEvent?: boolean;
}
const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Apply inside one workspace transaction. Network I/O follows durable persistence. */
export function saveItemInWorkspace(draft: WorkspaceDocument, item: UniversalItem, options: ItemSaveIntent | undefined, actionNow: Date) {
  const completion = options?.completionOccurrenceId ? draft.items[options.completionOccurrenceId] : undefined;
  if (options?.completionOccurrenceId && (!completion || completion.occurrence?.seriesId !== item.id || completion.deletedAt)) throw new Error('The selected recurrence is no longer available. Reopen the item.');
  const isNew = !draft.items[item.id];
  let recurrenceError = '';
  const before = draft.items[item.id];
  draft.items[item.id] = clean(item);
  const target = draft.items[item.id]!;
  // A draft opened before acknowledgement must not erase sync tombstones.
  if (before?.extensions?.['utm:googleDeletionReceipts']) {
    target.extensions ??= {};
    target.extensions['utm:googleDeletionReceipts'] = clean(before.extensions['utm:googleDeletionReceipts']);
  }
  if (before?.extensions?.[GOOGLE_SAVE_EXTENSION]) {
    target.extensions ??= {};
    target.extensions[GOOGLE_SAVE_EXTENSION] = clean(before.extensions[GOOGLE_SAVE_EXTENSION]);
  }
  if (before?.external?.readOnly === false) {
    target.external = clean(before.external);
    target.extensions ??= {};
    for (const key of ['utm:googleCreate', 'utm:googleEdit', 'utm:googleLinkKey']) {
      if (before.extensions?.[key] !== undefined) target.extensions[key] = clean(before.extensions[key]);
      else delete target.extensions[key];
    }
  }
  if (options?.deleteGoogleEvent && before?.external?.readOnly === false) {
    const link = before.external;
    target.extensions ??= {};
    target.extensions[GOOGLE_SAVE_EXTENSION] = {
      kind: 'delete', calendarId: link.calendarId, destination: link.calendarId, eventId: link.eventId,
      accountEmail: draft.calendarPreferences.googleCalendar?.accountEmail ?? '',
      draft: { title: '', description: '', location: '', start: '', end: '', allDay: false, timeZone: target.schedule?.timezone ?? 'UTC', busy: true },
    };
    delete target.external;
    delete target.extensions['utm:googleCreate'];
    delete target.extensions['utm:googleEdit'];
    delete target.extensions['utm:googleLinkKey'];
  }
  item.areas.forEach(area => ensureAreaDefinition(draft, area));
  item.projects.forEach(project => {
    const existing = draft.projectDefinitions[project];
    const converted = options?.convertedProject === project;
    ensureProjectDefinition(draft, project, !existing || converted ? { areas: [...new Set([...(existing?.areas ?? []), ...item.areas])] } : {});
  });
  item.tags.forEach(tag => ensureTagDefinition(draft, tag));
  if (item.list) ensureListDefinition(draft, item.list, { kind: 'list' });
  if (before?.state === 'open' && (item.state === 'done' || item.state === 'cancelled') && item.occurrence && item.closure?.at) {
    advanceCompletionAnchoredSeries(draft, item, item.closure.at);
  }
  if (completion && completion.state === 'open') {
    const beforeCompletion = clean(completion);
    completion.state = 'done';
    completion.closure = { at: actionNow.toISOString(), actor: 'user', reason: 'manual' };
    completion.updatedAt = actionNow.toISOString(); completion.revision += 1;
    recordCompletionTransition(completion, 'open', actionNow.toISOString());
    syncCompletionCounter(completion, actionNow.toISOString());
    advanceCompletionAnchoredSeries(draft, completion, actionNow.toISOString());
    runAutomationEvents(draft, [{ id: createId(), type: 'status.changed', at: actionNow.toISOString(), itemId: completion.id, before: beforeCompletion, after: clean(completion), causationId: createId(), depth: 0 }], { now: actionNow });
  }
  const event = {
    id: createId(), type: isNew ? 'item.created' as const : 'item.updated' as const,
    at: item.updatedAt, itemId: item.id, after: clean(item), causationId: createId(), depth: 0,
  };
  runAutomationEvents(draft, [event], { now: actionNow });
  if (item.role === 'series_template') {
    try { reconcileRecurrences(draft, actionNow); }
    catch (reason) { recurrenceError = reason instanceof Error ? reason.message : String(reason); }
  }
  reconcileCalendarOrganization(draft);
  const googleCandidate = clean(googleActionItem(draft, draft.items[item.id]!));
  return { recurrenceError, googleCandidate };
}
