import type { GoogleCalendarEvent, UniversalItem } from '@utm/core';
import { googleJson } from './googleCalendar';
import { createSingleGoogleEvent, googleCreationId, googleEventBody, writableGoogleCalendars, type GoogleCreateOperation, type GoogleEventDraft } from './googleCalendarCreate';
import { canEditGoogleEvent, googleEventChanges, GoogleEditConflict, updateSingleGoogleEvent, type GoogleEditOperation } from './googleCalendarEdit';

export const GOOGLE_SAVE_EXTENSION = 'utm:googleSave';
export interface GoogleSaveOperation {
  kind: 'create' | 'edit' | 'move';
  calendarId: string;
  destination: string;
  eventId: string;
  accountEmail: string;
  draft: GoogleEventDraft;
  baseline?: GoogleCalendarEvent;
  attempted?: boolean;
  blocked?: string;
}
export interface GoogleSaveOptions { calendarId: string; busy: boolean; baseline: UniversalItem; rebased?: boolean }
const eventUrl = (calendar: string, id: string) => `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar)}/events/${encodeURIComponent(id)}`;

export function itemGoogleDraft(item: UniversalItem, busy: boolean): GoogleEventDraft {
  const schedule = item.schedule;
  const zone = schedule?.timezone ?? 'UTC';
  const date = (value: string) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value)).map((p) => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  if (!schedule?.startAt || !schedule.endAt) throw new Error('Event opens and Event ends are required.');
  return { title: item.title, description: item.bodyMarkdown, location: item.location ?? '', start: schedule.allDay ? date(schedule.startAt) : schedule.startAt, end: schedule.allDay ? date(schedule.endAt) : schedule.endAt, allDay: schedule.allDay === true, timeZone: zone, busy, travelDuration: schedule.travelDuration ?? '' };
}
export function itemGoogleBaseline(item: UniversalItem): GoogleCalendarEvent {
  const link = item.external!;
  const projected = { ...item, schedule: { ...item.schedule, startAt: link.startAt ?? item.schedule?.startAt ?? '', endAt: link.endAt ?? item.schedule?.endAt ?? '', allDay: link.allDay ?? item.schedule?.allDay ?? false, timezone: link.timezone ?? item.schedule?.timezone ?? 'UTC' } };
  const body = googleEventBody({ eventId: 'utm00000', calendarId: link.calendarId, accountEmail: '', draft: itemGoogleDraft(projected, link.transparency !== 'transparent') });
  return { ...body, transparency: link.transparency ?? 'opaque', id: link.eventId, ...(link.etag ? { etag: link.etag } : {}) };
}
export function needsGoogleSave(item: UniversalItem, options: GoogleSaveOptions): boolean {
  if (item.extensions?.[GOOGLE_SAVE_EXTENSION]) return true;
  if (!item.schedule?.startAt || !item.schedule.endAt) return false;
  if (!options.baseline.external) return true;
  if (options.calendarId !== options.baseline.external.calendarId) return true;
  return Object.keys(googleEventChanges({ calendarId: options.calendarId, eventId: options.baseline.external.eventId, accountEmail: '', baseline: itemGoogleBaseline(options.baseline), draft: itemGoogleDraft(item, options.busy) })).length > 0;
}

/** Persist every attempted stage before writing; recover uncertain responses by reading back. */
export async function prepareGoogleSave(args: { workspaceId: string; accountEmail: string; item: UniversalItem; options: GoogleSaveOptions }): Promise<GoogleSaveOperation> {
  const { item, options } = args;
  const pending = item.extensions?.[GOOGLE_SAVE_EXTENSION] as unknown as GoogleSaveOperation | undefined;
  if (pending) return pending;
  const link = options.baseline.external;
  const operation: GoogleSaveOperation = {
    kind: link ? 'edit' : 'create', calendarId: link?.calendarId ?? options.calendarId, destination: options.calendarId,
    eventId: link?.eventId ?? await googleCreationId(args.workspaceId, item.occurrence ? `${item.id}:${item.occurrence.recurrenceId}` : item.id),
    accountEmail: args.accountEmail, draft: itemGoogleDraft(item, options.busy), ...(link ? { baseline: itemGoogleBaseline(options.baseline) } : {}),
  };
  googleEventBody(operation);
  return operation;
}

export async function saveGoogleItem(args: {
  token: string; workspaceId: string; accountEmail: string; item: UniversalItem; options: GoogleSaveOptions;
  allowPast?: boolean;
  persist: (operation: GoogleSaveOperation) => Promise<void>;
  apply: (calendarId: string, event: GoogleCalendarEvent, finished: boolean, nextOperation?: GoogleSaveOperation) => Promise<void>;
}): Promise<void> {
  const { token, item, options, persist, apply } = args;
  let pending = item.extensions?.[GOOGLE_SAVE_EXTENSION] as unknown as GoogleSaveOperation | undefined;
  const draft = itemGoogleDraft(item, options.busy);
  if (pending && options.rebased && pending.kind !== 'create' && pending.baseline?.etag !== options.baseline.external?.etag) pending = { ...pending, draft, baseline: itemGoogleBaseline(options.baseline), attempted: false };
  const newerDraft = Boolean(pending && ((Object.keys(draft) as Array<keyof GoogleEventDraft>).some((key) => key === 'travelDuration' ? (pending!.draft[key] ?? '') !== (draft[key] ?? '') : pending!.draft[key] !== draft[key]) || pending.destination !== options.calendarId));
  const finish = async (calendarId: string, event: GoogleCalendarEvent) => {
    if (!newerDraft || !pending) { await apply(calendarId, event, true); return; }
    // Atomically link the completed operation and queue the newer draft. A crash
    // between the two remote writes must never discard the user's latest edit.
    const next: GoogleSaveOperation = { kind: 'edit', calendarId, destination: options.calendarId, eventId: event.id, accountEmail: args.accountEmail, baseline: event, draft };
    await apply(calendarId, event, true, next);
    await saveGoogleItem({ ...args, item: { ...item, extensions: { ...item.extensions, [GOOGLE_SAVE_EXTENSION]: next } }, options: { ...options, rebased: false } });
  };
  const link = options.baseline.external;
  let operation: GoogleSaveOperation = pending ?? {
    kind: link ? 'edit' : 'create', calendarId: link?.calendarId ?? options.calendarId, destination: options.calendarId,
    eventId: link?.eventId ?? await googleCreationId(args.workspaceId, item.occurrence ? `${item.id}:${item.occurrence.recurrenceId}` : item.id),
    accountEmail: args.accountEmail, draft, ...(link ? { baseline: itemGoogleBaseline(options.baseline) } : {}),
  };
  googleEventBody(operation);
  if (operation.accountEmail !== args.accountEmail) throw new Error('Reconnect the original Google account to finish this save.');
  if (operation.kind === 'create') {
    await persist(operation);
    const event = await createSingleGoogleEvent(token, operation as GoogleCreateOperation);
    await finish(operation.calendarId, event); return;
  }
  if (operation.kind === 'edit') {
    const edit = operation as GoogleEditOperation;
    const retrying = operation.attempted === true;
    await persist({ ...operation, attempted: true });
    const event = await updateSingleGoogleEvent(token, { ...edit, attempted: retrying }, Date.now, args.allowPast);
    if (operation.destination === operation.calendarId) { await finish(operation.calendarId, event); return; }
    operation = { ...operation, kind: 'move', baseline: event, attempted: false };
    await persist(operation);
    await apply(operation.calendarId, event, false);
  }
  const calendars = await writableGoogleCalendars(token, args.accountEmail);
  if (!calendars.some((c) => c.id === operation.destination) || !calendars.some((c) => c.id === operation.calendarId)) throw new Error('Both calendars must be writable.');
  if (operation.attempted) {
    try {
      const moved = await googleJson<GoogleCalendarEvent>(eventUrl(operation.destination, operation.eventId), token);
      if (moved.status !== 'cancelled' && moved.iCalUID && moved.iCalUID === operation.baseline?.iCalUID) { await finish(operation.destination, moved); return; }
    } catch (error) { if ((error as { status?: number }).status !== 404) throw error; }
  }
  const current = await googleJson<GoogleCalendarEvent>(eventUrl(operation.calendarId, operation.eventId), token);
  if (current.eventType && current.eventType !== 'default') throw new Error('Google only allows moving ordinary calendar events.');
  if (!canEditGoogleEvent(current, item.schedule?.timezone ?? 'UTC', Date.now(), args.allowPast)) throw new Error('Editing is available until 3 hours after the event ends.');
  if (!operation.baseline?.etag || current.etag !== operation.baseline.etag) throw new GoogleEditConflict();
  operation = { ...operation, baseline: current, attempted: true };
  await persist(operation);
  let moved: GoogleCalendarEvent;
  try { moved = await googleJson<GoogleCalendarEvent>(`${eventUrl(operation.calendarId, operation.eventId)}/move?destination=${encodeURIComponent(operation.destination)}&sendUpdates=all`, token, {}, { method: 'POST', etag: current.etag }); }
  catch (reason) { if ((reason as { status?: number }).status === 412) throw new GoogleEditConflict(); throw reason; }
  await finish(operation.destination, moved);
}
