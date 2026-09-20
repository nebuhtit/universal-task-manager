import { zonedDateStart, type GoogleCalendarEvent } from '@utm/core';
import { googleJson } from './googleCalendar';
import { googleEventBody, writableGoogleCalendars, type GoogleEventDraft } from './googleCalendarCreate';

export const GOOGLE_EDIT_EXTENSION = 'utm:googleEdit';
export const GOOGLE_EDIT_WINDOW_MS = 3 * 3600_000;
export interface GoogleEditOperation {
  calendarId: string;
  eventId: string;
  accountEmail: string;
  baseline: GoogleCalendarEvent;
  draft: GoogleEventDraft;
  attempted?: boolean;
}
export class GoogleEditConflict extends Error { constructor() { super('The event changed in Google. Load the current event and review your changes again.'); } }
const eventUrl = (calendarId: string, eventId: string) => `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
export function googleEventDraft(event: GoogleCalendarEvent, timeZone: string): GoogleEventDraft {
  return { title: event.summary ?? '', description: event.description ?? '', location: event.location ?? '', start: event.start?.dateTime ?? event.start?.date ?? '', end: event.end?.dateTime ?? event.end?.date ?? '', allDay: Boolean(event.start?.date), busy: event.transparency !== 'transparent', timeZone: event.start?.timeZone ?? event.end?.timeZone ?? timeZone };
}
export function canEditGoogleEvent(event: GoogleCalendarEvent, timeZone: string, now = Date.now(), allowPast = false): boolean {
  if (event.status === 'cancelled' || event.recurrence?.length) return false;
  const end = event.end?.dateTime ? Date.parse(event.end.dateTime) : event.end?.date ? zonedDateStart(event.end.date, event.end.timeZone ?? timeZone).getTime() : NaN;
  return Number.isFinite(end) && (allowPast || now <= end + GOOGLE_EDIT_WINDOW_MS);
}
export async function loadEditableGoogleEvent(token: string, calendarId: string, eventId: string, accountEmail: string): Promise<{ event: GoogleCalendarEvent; timeZone: string }> {
  const calendars = await writableGoogleCalendars(token, accountEmail);
  const calendar = calendars.find((entry) => entry.id === calendarId);
  if (!calendar) throw new Error('This calendar is not writable.');
  const event = await googleJson<GoogleCalendarEvent>(eventUrl(calendarId, eventId), token);
  if (event.id !== eventId) throw new Error('Google returned a different event.');
  const timeZone = (calendar as { timeZone?: string }).timeZone ?? event.start?.timeZone ?? event.end?.timeZone ?? 'UTC';
  return { event, timeZone };
}
export function googleEventChanges(operation: GoogleEditOperation): Record<string, unknown> {
  const body = googleEventBody({ ...operation, eventId: 'utm00000' });
  const before = googleEventDraft(operation.baseline, operation.draft.timeZone);
  const changes: Record<string, unknown> = {};
  if (before.title !== operation.draft.title.trim()) changes.summary = body.summary;
  if (before.description !== operation.draft.description) changes.description = body.description;
  if (before.location !== operation.draft.location) changes.location = body.location;
  if (before.busy !== operation.draft.busy) changes.transparency = body.transparency;
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
  const { event, timeZone } = await loadEditableGoogleEvent(token, operation.calendarId, operation.eventId, operation.accountEmail);
  // After an uncertain response, read back exactly the fields we attempted before sending again.
  const remaining = googleEventChanges({ ...operation, baseline: event });
  if (operation.attempted && Object.keys(changes).every((key) => !(key in remaining))) return event;
  if (!canEditGoogleEvent(event, timeZone, now(), allowPast)) throw new Error('Editing is available until 3 hours after the event ends.');
  if (!operation.baseline.etag || event.etag !== operation.baseline.etag) throw new GoogleEditConflict();
  if (!Object.keys(changes).length) return event;
  try { return await googleJson<GoogleCalendarEvent>(`${eventUrl(operation.calendarId, operation.eventId)}?sendUpdates=all`, token, changes, { method: 'PATCH', etag: event.etag }); }
  catch (reason) { if ((reason as { status?: number }).status === 412) throw new GoogleEditConflict(); throw reason; }
}
