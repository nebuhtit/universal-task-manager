import { zonedDateStart, type GoogleCalendarEvent, type UniversalItem } from '@utm/core';
import { googleJson } from './googleCalendar';
import { createSingleGoogleEvent, googleCreationId, googleEventBody, writableGoogleCalendars, type GoogleCreateOperation, type GoogleEventDraft } from './googleCalendarCreate';
import { canEditGoogleEvent, googleEventChanges, rebaseGoogleEdit, GoogleEditConflict, updateSingleGoogleEvent, type GoogleEditOperation } from './googleCalendarEdit';

export const GOOGLE_SAVE_EXTENSION = 'utm:googleSave';
export interface GoogleSaveOperation {
  kind: 'create' | 'edit' | 'move' | 'delete';
  calendarId: string;
  destination: string;
  /** Latest user selection survives retrying an older, possibly accepted write. */
  desiredDestination?: string;
  desiredBusy?: boolean;
  eventId: string;
  accountEmail: string;
  draft: GoogleEventDraft;
  baseline?: GoogleCalendarEvent;
  attempted?: boolean;
  blocked?: string;
  instance?: { calendarId: string; masterId: string; originalStart: string; baseline?: GoogleCalendarEvent };
  split?: { seriesId: string; calendarId: string; eventId: string; baseline: GoogleCalendarEvent; recurrence: string[]; completedEvent?: GoogleCalendarEvent };
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
  if (item.role === 'series_template' && item.recurrence?.anchor === 'completion') throw new Error('Google Calendar cannot represent completion-anchored repeats. Use schedule-anchored recurrence.');
  const recurrence = item.role === 'series_template' && item.recurrence ? [
    `RRULE:${item.recurrence.rrule.replace(/^RRULE:/i, '')}`,
    ...(['rdates', 'exdates'] as const).flatMap(key => item.recurrence![key].length ? [`${key === 'rdates' ? 'RDATE' : 'EXDATE'}${schedule.allDay ? ';VALUE=DATE' : ''}:${item.recurrence![key].map(value => schedule.allDay ? date(value).replace(/-/g, '') : new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')).join(',')}`] : []),
  ] : undefined;
  return { title: item.title, description: item.bodyMarkdown, location: item.location ?? '', start: schedule.allDay ? date(schedule.startAt) : schedule.startAt, end: schedule.allDay ? date(schedule.endAt) : schedule.endAt, allDay: schedule.allDay === true, timeZone: zone, busy, travelDuration: schedule.travelDuration ?? '', ...(recurrence ? { recurrence } : {}) };
}
export function itemGoogleBaseline(item: UniversalItem): GoogleCalendarEvent {
  const seriesEvent = item.extensions?.['utm:googleSeriesEvent'] as GoogleCalendarEvent | undefined;
  if (seriesEvent && seriesEvent.id === item.external?.eventId) return seriesEvent;
  const link = item.external!;
  const projected = { ...item, schedule: { ...item.schedule, startAt: link.startAt ?? item.schedule?.startAt ?? '', endAt: link.endAt ?? item.schedule?.endAt ?? '', allDay: link.allDay ?? item.schedule?.allDay ?? false, timezone: link.timezone ?? item.schedule?.timezone ?? 'UTC' } };
  const body = googleEventBody({ eventId: 'utm00000', calendarId: link.calendarId, accountEmail: '', draft: itemGoogleDraft({ ...projected, role: 'standalone' }, link.transparency !== 'transparent') });
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
  if (pending) return { ...pending, desiredDestination: options.calendarId, desiredBusy: options.busy };
  const link = options.baseline.external;
  const operation: GoogleSaveOperation = {
    kind: link ? 'edit' : 'create', calendarId: link?.calendarId ?? options.calendarId, destination: options.calendarId,
    eventId: link?.eventId ?? await googleCreationId(args.workspaceId, item.occurrence ? `${item.id}:${item.occurrence.recurrenceId}` : item.id),
    accountEmail: args.accountEmail, draft: itemGoogleDraft(item, options.busy), ...(link ? { baseline: itemGoogleBaseline(options.baseline) } : {}),
  };
  if (item.extensions?.['utm:googleSplit']) operation.split = item.extensions['utm:googleSplit'] as NonNullable<GoogleSaveOperation['split']>;
  if (item.extensions?.['utm:googleInstance']) operation.instance = { ...item.extensions['utm:googleInstance'] as NonNullable<GoogleSaveOperation['instance']>, baseline: googleEventBody({ eventId: 'utm00000', calendarId: options.calendarId, accountEmail: args.accountEmail, draft: itemGoogleDraft(options.baseline, options.busy) }) };
  googleEventBody(operation.kind === 'create' && !operation.instance ? operation : { ...operation, eventId: 'utm00000' });
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
  if (pending?.kind === 'delete') {
    if (pending.accountEmail !== args.accountEmail) throw new Error('Reconnect the original Google account to delete this event.');
    await persist({ ...pending, attempted: true });
    try { await googleJson<void>(eventUrl(pending.calendarId, pending.eventId), token, undefined, { method: 'DELETE' }); }
    catch (reason) { if ((reason as { status?: number }).status !== 404 && (reason as { status?: number }).status !== 410) throw reason; }
    await apply(pending.calendarId, { id: pending.eventId, status: 'cancelled' }, true);
    return;
  }
  const draft = itemGoogleDraft(item, options.busy);
  if (pending && options.rebased && pending.kind !== 'create' && pending.baseline?.etag !== options.baseline.external?.etag) pending = { ...pending, draft, baseline: itemGoogleBaseline(options.baseline), attempted: false };
  const newerDraft = Boolean(pending && ((Object.keys(draft) as Array<keyof GoogleEventDraft>).some((key) => key === 'travelDuration' ? (pending!.draft[key] ?? '') !== (draft[key] ?? '') : JSON.stringify(pending!.draft[key]) !== JSON.stringify(draft[key])) || pending.destination !== options.calendarId));
  const finish = async (calendarId: string, event: GoogleCalendarEvent) => {
    if (!newerDraft || !pending) { await apply(calendarId, event, true); return; }
    // Atomically link the completed operation and queue the newer draft. A crash
    // between the two remote writes must never discard the user's latest edit.
    const next: GoogleSaveOperation = { kind: 'edit', calendarId, destination: options.calendarId, eventId: event.id, accountEmail: args.accountEmail, baseline: event, draft };
    await apply(calendarId, event, true, next);
    await saveGoogleItem({ ...args, item: { ...item, extensions: { ...item.extensions, [GOOGLE_SAVE_EXTENSION]: next } }, options: { ...options, rebased: false } });
  };
  let operation: GoogleSaveOperation = pending ?? await prepareGoogleSave(args);
  googleEventBody(operation.kind === 'create' && !operation.instance ? operation : { ...operation, eventId: 'utm00000' });
  if (operation.accountEmail !== args.accountEmail) throw new Error('Reconnect the original Google account to finish this save.');
  if (operation.instance) {
    const instance = operation.instance;
    let pageToken: string | undefined;
    let found: GoogleCalendarEvent | undefined;
    do {
      const query = new URLSearchParams({ originalStart: instance.originalStart, maxResults: '2500', ...(pageToken ? { pageToken } : {}) });
      const page = await googleJson<{ items?: GoogleCalendarEvent[]; nextPageToken?: string }>(`${eventUrl(instance.calendarId, instance.masterId)}/instances?${query}`, token);
      found = page.items?.find(event => (event.originalStartTime?.dateTime ? Date.parse(event.originalStartTime.dateTime) : event.originalStartTime?.date ? zonedDateStart(event.originalStartTime.date, operation.draft.timeZone).getTime() : NaN) === Date.parse(instance.originalStart));
      pageToken = page.nextPageToken;
    } while (!found && pageToken);
    if (!found || found.status === 'cancelled') throw new Error('The Google recurrence instance is unavailable. Sync and reopen it.');
    if (instance.baseline) {
      const intended = { ...operation, baseline: instance.baseline };
      // The explicit UTM edit owns its changed fields; retain unrelated Google
      // fields while applying the selected occurrence's draft to the fresh ID.
      operation.draft = rebaseGoogleEdit(intended, found, operation.draft.timeZone);
    }
    operation = { ...operation, kind: 'edit', calendarId: instance.calendarId, eventId: found.id, baseline: found };
    delete operation.instance;
    await persist(operation);
  }
  if (operation.split && !operation.split.completedEvent) {
    const split = operation.split;
    const writable = await writableGoogleCalendars(token, args.accountEmail);
    if (![split.calendarId, operation.calendarId].every(id => writable.some(calendar => calendar.id === id))) throw new Error('Both calendars must be writable.');
    await persist(operation);
    const current = await googleJson<GoogleCalendarEvent>(eventUrl(split.calendarId, split.eventId), token);
    if (current.status === 'cancelled') throw new Error('The original Google series was deleted.');
    let trimmed = current;
    if (JSON.stringify(current.recurrence ?? []) !== JSON.stringify(split.recurrence)) {
      if (!current.etag) throw new GoogleEditConflict();
      trimmed = await googleJson<GoogleCalendarEvent>(`${eventUrl(split.calendarId, split.eventId)}?sendUpdates=all`, token, { recurrence: split.recurrence }, { method: 'PATCH', etag: current.etag });
    }
    operation = { ...operation, split: { ...split, completedEvent: trimmed } };
    await persist(operation);
  }
  if (operation.kind === 'create') {
    await persist(operation);
    const event = await createSingleGoogleEvent(token, operation as GoogleCreateOperation);
    await finish(operation.calendarId, event); return;
  }
  if (operation.kind === 'edit') {
    const edit = operation as GoogleEditOperation;
    const retrying = operation.attempted === true;
    await persist({ ...operation, attempted: true });
    const event = await updateSingleGoogleEvent(token, { ...edit, attempted: retrying, preferLocalChanges: true }, Date.now, args.allowPast);
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
  if (!(current.recurrence?.length && current.status !== 'cancelled') && !canEditGoogleEvent(current, item.schedule?.timezone ?? 'UTC', Date.now(), args.allowPast)) throw new Error('Editing is available until 3 hours after the event ends.');
  if (!current.etag) throw new GoogleEditConflict();
  operation = { ...operation, baseline: current, attempted: true };
  await persist(operation);
  let moved: GoogleCalendarEvent;
  try { moved = await googleJson<GoogleCalendarEvent>(`${eventUrl(operation.calendarId, operation.eventId)}/move?destination=${encodeURIComponent(operation.destination)}&sendUpdates=all`, token, undefined, { method: 'POST', etag: current.etag }); }
  catch (reason) { if ((reason as { status?: number }).status === 412) throw new GoogleEditConflict(); throw reason; }
  await finish(operation.destination, moved);
}
