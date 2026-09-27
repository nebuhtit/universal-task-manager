import { buildRecurrenceRule, createOccurrence, mergeGoogleCalendarCopies, googleCalendarEventToItem, zonedDateTime, type GoogleCalendarEvent, type UniversalItem, type WorkspaceDocument } from '@utm/core';

/** Preserve every supported Google exception; never silently simplify a rule. */
export function googleRecurrence(event: GoogleCalendarEvent, zone: string): NonNullable<UniversalItem['recurrence']> {
  const rules = event.recurrence ?? [];
  const rr = rules.filter(line => line.startsWith('RRULE:'));
  if (rr.length !== 1) throw new Error('This Google recurrence cannot yet be edited as a UTM series.');
  const result: NonNullable<UniversalItem['recurrence']> = { rrule: rr[0]!.slice(6), timezone: zone, anchor: 'schedule', closeAt: 'next_activation', activationOffset: 'PT0M', autoRenew: true, rdates: [], exdates: [] };
  for (const line of rules.filter(line => !line.startsWith('RRULE:'))) {
    const separator = line.indexOf(':'); const header = line.slice(0, separator); const key = header.split(';')[0];
    if (key !== 'RDATE' && key !== 'EXDATE') throw new Error('Unsupported Google recurrence property. No series was changed.');
    const timezone = header.match(/TZID=([^;]+)/)?.[1] ?? zone;
    for (const value of line.slice(separator + 1).split(',')) {
      const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value);
      if (!match) throw new Error('Unsupported Google recurrence date. No series was changed.');
      const date = `${match[1]}-${match[2]}-${match[3]}`;
      const instant = match[7] ? new Date(`${date}T${match[4]}:${match[5]}:${match[6]}Z`) : new Date(zonedDateTime(date, Number(match[4] ?? 0), Number(match[5] ?? 0), timezone).getTime() + Number(match[6] ?? 0) * 1000);
      result[key === 'RDATE' ? 'rdates' : 'exdates'].push(instant.toISOString());
    }
  }
  return result;
}

/** Local adoption only: retain the selected item ID and all UTM-only fields. */
export function adoptGoogleUniversalItem(workspace: WorkspaceDocument, itemId: string, event: GoogleCalendarEvent, master?: GoogleCalendarEvent): UniversalItem {
  const item = workspace.items[itemId];
  if (!item?.external) throw new Error('Google item is no longer available.');
  if (!item.external.readOnly) return item;
  const link = item.external;
  if (event.id !== link.eventId || event.status === 'cancelled') throw new Error('Google event is no longer available.');
  const latest = googleCalendarEventToItem(event, link.calendarId, link.connectionId, link.syncedAt, item.schedule?.timezone);
  if (!latest?.schedule) throw new Error('Google event has no valid dates.');
  let series: UniversalItem | undefined;
  if (event.recurringEventId) {
    if (!master || master.id !== event.recurringEventId || master.status === 'cancelled') throw new Error('Could not load the Google series. Try opening the item again when online.');
    const remote = googleCalendarEventToItem(master, link.calendarId, link.connectionId, link.syncedAt, item.schedule?.timezone);
    if (!remote?.schedule || !remote.external) throw new Error('Google series has no valid dates.');
    const recurrence = googleRecurrence(master, remote.schedule.timezone ?? 'UTC');
    series = Object.values(workspace.items).find(candidate => candidate.role === 'series_template' && !candidate.deletedAt && candidate.external?.calendarId === link.calendarId && candidate.external.eventId === master.id);
    if (!series) {
      series = { ...remote, id: `google-series:${encodeURIComponent(link.calendarId)}:${master.id}`, role: 'series_template', recurrence, canBeCompleted: false, external: { ...remote.external, readOnly: false } };
      buildRecurrenceRule(series); // Validate before mutating the workspace.
    }
    const original = event.originalStartTime?.dateTime ?? (event.originalStartTime?.date ? zonedDateTime(event.originalStartTime.date, 0, 0, recurrence.timezone).toISOString() : undefined);
    if (!original || !Number.isFinite(Date.parse(original))) throw new Error('Google recurrence has no original occurrence date.');
    workspace.items[series.id] = series;
    const recurrenceId = new Date(original).toISOString();
    item.role = 'occurrence'; item.occurrence = { seriesId: series.id, recurrenceId, sequence: 0, templateRevision: series.revision };
    const expected = createOccurrence(series, new Date(original), 0);
    if (item.title !== expected.title || item.schedule?.startAt !== expected.schedule?.startAt || item.schedule?.endAt !== expected.schedule?.endAt) item.recurrenceOverride = { kind: 'this_occurrence', sourceSeriesId: series.id, recurrenceId };
  }
  item.external = { ...link, readOnly: false, ...(event.etag ? { etag: event.etag } : {}) };
  item.title = latest.title; item.bodyMarkdown = latest.bodyMarkdown;
  if (latest.location) item.location = latest.location; else delete item.location;
  item.schedule = { ...item.schedule, startAt: latest.schedule.startAt!, endAt: latest.schedule.endAt!, timezone: latest.schedule.timezone!, allDay: latest.schedule.allDay === true };
  item.canBeCompleted ??= false;
  item.extensions ??= {};
  item.extensions['utm:googleCreate'] = { calendarId: link.calendarId, eventId: event.id, accountEmail: workspace.calendarPreferences.googleCalendar?.accountEmail ?? '' };
  mergeGoogleCalendarCopies(workspace);
  return item;
}
