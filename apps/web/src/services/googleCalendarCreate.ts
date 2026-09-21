import { GOOGLE_TRAVEL_DURATION_PROPERTY, type GoogleCalendarEvent } from '@utm/core';
import { googleJson, listCalendars } from './googleCalendar';

export const GOOGLE_CREATE_EXTENSION = 'utm:googleCreate';
export interface GoogleEventDraft {
  title: string;
  description: string;
  location: string;
  start: string;
  end: string;
  allDay: boolean;
  busy: boolean;
  timeZone: string;
  travelDuration?: string;
}
export interface GoogleCreateOperation {
  eventId: string;
  calendarId: string;
  accountEmail: string;
  draft: GoogleEventDraft;
}

export async function googleCreationId(workspaceId: string, itemId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([workspaceId, itemId])));
  return `utm${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function googleEventBody(operation: GoogleCreateOperation) {
  const { draft } = operation;
  if (!/^[0-9a-v]{5,1024}$/.test(operation.eventId)) throw new Error('Invalid event identifier.');
  if (!draft.title.trim()) throw new Error('Enter an event title.');
  new Intl.DateTimeFormat('en', { timeZone: draft.timeZone });
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (draft.allDay && (!validDate(draft.start) || !validDate(draft.end))) throw new Error('Enter valid dates.');
  const start = Date.parse(draft.start); const end = Date.parse(draft.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('Event ends must be after Event opens.');
  return {
    id: operation.eventId, summary: draft.title.trim(), description: draft.description, location: draft.location,
    start: draft.allDay ? { date: draft.start } : { dateTime: new Date(start).toISOString(), timeZone: draft.timeZone },
    end: draft.allDay ? { date: draft.end } : { dateTime: new Date(end).toISOString(), timeZone: draft.timeZone },
    transparency: draft.busy ? 'opaque' : 'transparent',
    extendedProperties: { private: { utmCreateOperation: operation.eventId, ...(draft.travelDuration !== undefined ? { [GOOGLE_TRAVEL_DURATION_PROPERTY]: draft.travelDuration } : {}) } },
  };
}

export async function writableGoogleCalendars(token: string, expectedAccount: string) {
  const calendars = await listCalendars(token);
  const account = calendars.find((calendar) => calendar.primary)?.id;
  if (!account || account.toLowerCase() !== expectedAccount.toLowerCase()) throw new Error('Sign in to the Google account connected to this workspace.');
  return calendars.filter((calendar) => calendar.id && (calendar.accessRole === 'owner' || calendar.accessRole === 'writer'));
}

/** A stable ID survives lost responses. A conflict is read back, never overwritten. */
export async function createSingleGoogleEvent(token: string, operation: GoogleCreateOperation): Promise<GoogleCalendarEvent> {
  const body = googleEventBody(operation);
  const calendars = await writableGoogleCalendars(token, operation.accountEmail);
  if (!calendars.some((calendar) => calendar.id === operation.calendarId)) throw new Error('This calendar is not writable.');
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(operation.calendarId)}/events`;
  try { return await googleJson<GoogleCalendarEvent>(`${base}?sendUpdates=none`, token, body); }
  catch (error) {
    if ((error as { status?: number }).status !== 409) throw error;
    const existing = await googleJson<GoogleCalendarEvent & { extendedProperties?: { private?: Record<string, string> } }>(`${base}/${operation.eventId}`, token);
    if (existing.status === 'cancelled' || existing.extendedProperties?.private?.utmCreateOperation !== operation.eventId) throw new Error('The event identifier is already in use. No event was changed.');
    return existing;
  }
}
