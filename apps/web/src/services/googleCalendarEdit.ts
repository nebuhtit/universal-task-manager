import { GOOGLE_TRAVEL_DURATION_PROPERTY, zonedDateStart, type GoogleCalendarEvent } from '@utm/core';
import { googleJson } from './googleCalendar';
import { googleEventBody, writableGoogleCalendars, type GoogleEventDraft } from './googleCalendarCreate';

export const GOOGLE_EDIT_EXTENSION = 'utm:googleEdit';
export const GOOGLE_EDIT_WINDOW_MS = 3 * 3600_000;
export interface GoogleEditOperation {
  calendarId: string;
  destinationCalendarId?: string;
  eventId: string;
  accountEmail: string;
  baseline: GoogleCalendarEvent;
  draft: GoogleEventDraft;
  attempted?: boolean;
}
export class GoogleEditConflict extends Error { constructor() { super('The event changed in Google. Load the current event and review your changes again.'); } }
const eventUrl = (calendarId: string, eventId: string) => `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
export function googleEventDraft(event: GoogleCalendarEvent, timeZone: string): GoogleEventDraft {
  const travel = event.extendedProperties?.private?.[GOOGLE_TRAVEL_DURATION_PROPERTY];
  return { title: event.summary ?? '', description: event.description ?? '', location: event.location ?? '', start: event.start?.dateTime ?? event.start?.date ?? '', end: event.end?.dateTime ?? event.end?.date ?? '', allDay: Boolean(event.start?.date), busy: event.transparency !== 'transparent', timeZone: event.start?.timeZone ?? event.end?.timeZone ?? timeZone, ...(travel !== undefined ? { travelDuration: travel } : {}) };
}
export function canEditGoogleEvent(event: GoogleCalendarEvent, timeZone: string, now = Date.now(), allowPast = false): boolean {
  if (event.status === 'cancelled' || event.recurrence?.length) return false;
  const end = event.end?.dateTime ? Date.parse(event.end.dateTime) : event.end?.date ? zonedDateStart(event.end.date, event.end.timeZone ?? timeZone).getTime() : NaN;
  return Number.isFinite(end) && (allowPast || now <= end + GOOGLE_EDIT_WINDOW_MS);
}
export async function loadEditableGoogleEvent(token: string, calendarId: string, eventId: string, accountEmail: string) {
  const calendars = await writableGoogleCalendars(token, accountEmail);
  const calendar = calendars.find((entry) => entry.id === calendarId);
  if (!calendar) throw new Error('This calendar is not writable.');
  const event = await googleJson<GoogleCalendarEvent>(eventUrl(calendarId, eventId), token);
  if (event.id !== eventId) throw new Error('Google returned a different event.');
  const timeZone = (calendar as { timeZone?: string }).timeZone ?? event.start?.timeZone ?? event.end?.timeZone ?? 'UTC';
  return { event, timeZone, calendars };
}
/** Google moves a single default event; it does not create a second copy. */
export async function moveSingleGoogleEvent(token: string, operation: GoogleEditOperation, event: GoogleCalendarEvent): Promise<{ event: GoogleCalendarEvent; calendarId: string }> {
  const destination = operation.destinationCalendarId ?? operation.calendarId;
  if (destination === operation.calendarId) return { event, calendarId: operation.calendarId };
  const calendars = await writableGoogleCalendars(token, operation.accountEmail);
  if (!calendars.some((calendar) => calendar.id === destination)) throw new Error('The destination calendar is not writable.');
  if (event.eventType && event.eventType !== 'default') throw new Error('Google does not allow this event type to move to another calendar.');
  const url = `${eventUrl(operation.calendarId, operation.eventId)}/move?destination=${encodeURIComponent(destination)}&sendUpdates=all`;
  try { return { event: await googleJson<GoogleCalendarEvent>(url, token, undefined, { method: 'POST' }), calendarId: destination }; }
  catch (reason) {
    // A lost move response must not send a second move or create a duplicate.
    if (operation.attempted && (reason as { status?: number }).status === 404) {
      const moved = await googleJson<GoogleCalendarEvent>(eventUrl(destination, operation.eventId), token);
      if (moved.id === operation.eventId) return { event: moved, calendarId: destination };
    }
    throw reason;
  }
}
export function googleEventChanges(operation: GoogleEditOperation): Record<string, unknown> {
  const body = googleEventBody({ ...operation, eventId: 'utm00000' });
  const before = googleEventDraft(operation.baseline, operation.draft.timeZone);
  const changes: Record<string, unknown> = {};
  if (before.title !== operation.draft.title.trim()) changes.summary = body.summary;
  if (before.description !== operation.draft.description) changes.description = body.description;
  if (before.location !== operation.draft.location) changes.location = body.location;
  if (before.busy !== operation.draft.busy) changes.transparency = body.transparency;
  if ((before.travelDuration ?? '') !== (operation.draft.travelDuration ?? '')) changes.extendedProperties = { private: { ...(operation.baseline.extendedProperties?.private ?? {}), [GOOGLE_TRAVEL_DURATION_PROPERTY]: operation.draft.travelDuration ?? '' } };
  const sameTime = (a: string, b: string) => before.allDay ? a === b : Date.parse(a) === Date.parse(b);
  for (const key of ['start', 'end'] as const) {
    if (before.allDay !== operation.draft.allDay || !sameTime(before[key], operation.draft[key]) || before.timeZone !== operation.draft.timeZone) changes[key] = { ...body[key], ...(operation.draft.allDay ? { dateTime: null, timeZone: null } : { date: null }) };
  }
  return changes;
}
export function rebaseGoogleEdit(operation: GoogleEditOperation, event: GoogleCalendarEvent, timeZone: string): GoogleEventDraft {
  const next = googleEventDraft(event, timeZone);
  const changes = googleEventChanges(operation);
  if ('summary' in changes) next.title = operation.draft.title;
  if ('description' in changes) next.description = operation.draft.description;
  if ('location' in changes) next.location = operation.draft.location;
  if ('transparency' in changes) next.busy = operation.draft.busy;
  if ('start' in changes) next.start = operation.draft.start;
  if ('end' in changes) next.end = operation.draft.end;
  if ('start' in changes || 'end' in changes) { next.allDay = operation.draft.allDay; next.timeZone = operation.draft.timeZone; }
  return next;
}
export async function updateSingleGoogleEvent(token: string, operation: GoogleEditOperation, now: () => number = Date.now, allowPast = false): Promise<GoogleCalendarEvent> {
  const changes = googleEventChanges(operation);
  let loaded: Awaited<ReturnType<typeof loadEditableGoogleEvent>>;
  try { loaded = await loadEditableGoogleEvent(token, operation.calendarId, operation.eventId, operation.accountEmail); }
  catch (reason) {
    if (operation.attempted && operation.destinationCalendarId && operation.destinationCalendarId !== operation.calendarId && (reason as { status?: number }).status === 404) {
      const moved = await googleJson<GoogleCalendarEvent>(eventUrl(operation.destinationCalendarId, operation.eventId), token);
      if (moved.id === operation.eventId) return moved;
    }
    throw reason;
  }
  const { event, timeZone } = loaded;
  // After an uncertain response, read back exactly the fields we attempted before sending again.
  const remaining = googleEventChanges({ ...operation, baseline: event });
  if (operation.attempted && Object.keys(changes).every((key) => !(key in remaining))) return event;
  if (!canEditGoogleEvent(event, timeZone, now(), allowPast)) throw new Error('Editing is available until 3 hours after the event ends.');
  if (!operation.baseline.etag || event.etag !== operation.baseline.etag) throw new GoogleEditConflict();
  if (!Object.keys(changes).length) return event;
  try { return await googleJson<GoogleCalendarEvent>(`${eventUrl(operation.calendarId, operation.eventId)}?sendUpdates=all`, token, changes, { method: 'PATCH', etag: event.etag }); }
  catch (reason) { if ((reason as { status?: number }).status === 412) throw new GoogleEditConflict(); throw reason; }
}
