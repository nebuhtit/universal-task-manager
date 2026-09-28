import { buildRecurrenceRule, createOccurrence, recurrenceAnchor, softDeleteItemTree, zonedDateStart, type WorkspaceDocument, type UniversalItem, type GoogleCalendarEvent, googleCalendarEventToItem } from '@utm/core';
import { googleJson } from './googleCalendar';
import { googleRecurrence } from './googleUniversalItem';
import { itemGoogleDraft } from './googleItemSave';
import { ensureRecurrenceEditOccurrence, type RecurrenceItemEdit } from './recurrenceItemEdit';

export const ITEM_DELETE_EXTENSION = 'utm:itemDelete';
export interface ItemDeleteIntent { itemId: string; scope?: RecurrenceItemEdit; accountEmail: string }

export function restrictRecurrence(item: UniversalItem, anchor: string, onlyOne: boolean): void {
  if (!item.recurrence) throw new Error('The recurrence is unavailable.');
  if (onlyOne) item.recurrence.exdates = [...new Set([...item.recurrence.exdates, anchor])];
  else {
    // Never extend an already finished COUNT/UNTIL series while retrying.
    if (!buildRecurrenceRule(item).after(new Date(Date.parse(anchor) - 1), true)) return;
    const before = new Date(Date.parse(anchor) - 1000);
    const until = item.schedule?.allDay
      ? new Intl.DateTimeFormat('sv-SE', { timeZone: item.schedule.timezone ?? item.recurrence.timezone ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(before).replace(/-/g, '')
      : before.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const previous = item.recurrence.rrule.match(/(?:^|;)UNTIL=([^;]+)/i)?.[1];
    item.recurrence.rrule = [...item.recurrence.rrule.split(';').filter(p => !/^(COUNT|UNTIL)=/i.test(p)), `UNTIL=${previous && previous < until ? previous : until}`].join(';');
    item.recurrence.rdates = item.recurrence.rdates.filter(date => Date.parse(date) < Date.parse(anchor));
    item.recurrence.exdates = item.recurrence.exdates.filter(date => Date.parse(date) < Date.parse(anchor));
  }
}

export function applyItemDeletion(workspace: WorkspaceDocument, intent: ItemDeleteIntent, at: string): void {
  const owner = workspace.items[intent.itemId];
  if (!owner) throw new Error('Item is unavailable.');
  if (!intent.scope) { softDeleteItemTree(workspace, owner.id, at); return; }
  const selected = ensureRecurrenceEditOccurrence(workspace, owner.id, intent.scope);
  if (!selected?.occurrence || selected.occurrence.seriesId !== owner.id || !owner.recurrence) throw new Error('Reopen the selected occurrence.');
  const anchor = selected.occurrence.recurrenceId;
  const onlyOne = intent.scope.scope === 'this_occurrence';
  if (!onlyOne && Date.parse(anchor) <= Date.parse(recurrenceAnchor(owner)!)) { softDeleteItemTree(workspace, owner.id, at); return; }
  restrictRecurrence(owner, anchor, onlyOne);
  owner.updatedAt = at; owner.revision += 1;
  for (const item of Object.values(workspace.items)) if (item.occurrence?.seriesId === owner.id && (onlyOne ? item.id === selected.id : Date.parse(item.occurrence.recurrenceId) >= Date.parse(anchor))) softDeleteItemTree(workspace, item.id, at);
}

/** Remote first: local data remains visible/recoverable until Google confirms.
 * Intent is persisted by the coordinator; DELETE and recurrence restriction are idempotent. */
export async function deleteGoogleItem(workspace: WorkspaceDocument, intent: ItemDeleteIntent, token: string): Promise<GoogleCalendarEvent | undefined> {
  const owner = workspace.items[intent.itemId];
  if (!owner) throw new Error('Item is unavailable.');
  const selected = intent.scope ? (workspace.items[intent.scope.occurrenceId] ?? (intent.scope.recurrenceId ? createOccurrence(owner, new Date(intent.scope.recurrenceId), 0) : undefined)) : owner;
  if (!selected) throw new Error('Item is unavailable.');
  const link = intent.scope ? owner.external : selected.external;
  if (!link) {
    if (intent.scope && selected.external) throw new Error('Sync and reopen this series before deleting it.');
    return;
  }
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(link.calendarId)}/events/${encodeURIComponent(link.eventId)}`;
  try {
    const current = await googleJson<GoogleCalendarEvent>(url, token);
    if (current.status === 'cancelled') return;
    const anchor = selected.occurrence?.recurrenceId;
    if (intent.scope && anchor) {
      if (intent.scope.scope === 'this_occurrence') {
        let pageToken: string | undefined;
        do {
          const query = new URLSearchParams({ originalStart: anchor, showDeleted: 'true', maxResults: '2500', ...(pageToken ? { pageToken } : {}) });
          const page = await googleJson<{ items?: GoogleCalendarEvent[]; nextPageToken?: string }>(`${url}/instances?${query}`, token);
          const instance = page.items?.find(event => (event.originalStartTime?.dateTime ? Date.parse(event.originalStartTime.dateTime) : event.originalStartTime?.date ? zonedDateStart(event.originalStartTime.date, owner.schedule?.timezone ?? 'UTC').getTime() : NaN) === Date.parse(anchor));
          if (instance) {
            if (instance.status !== 'cancelled') await googleJson(`${url.slice(0, url.lastIndexOf('/') + 1)}${encodeURIComponent(instance.id)}`, token, { status: 'cancelled' }, { method: 'PATCH', ...(instance.etag ? { etag: instance.etag } : {}) });
            return;
          }
          pageToken = page.nextPageToken;
        } while (pageToken);
        throw new Error('The selected Google occurrence could not be confirmed. Sync and retry.');
      }
      const remote = googleCalendarEventToItem(current, link.calendarId, link.connectionId, new Date().toISOString(), owner.schedule?.timezone);
      if (!remote?.schedule?.startAt) throw new Error('Google series has no valid start.');
      remote.role = 'series_template';
      remote.recurrence = googleRecurrence(current, remote.schedule.timezone ?? 'UTC');
      if (Date.parse(anchor) > Date.parse(remote.schedule.startAt)) {
        restrictRecurrence(remote, anchor, false);
        const recurrence = itemGoogleDraft(remote, true).recurrence;
        if (JSON.stringify(recurrence) !== JSON.stringify(current.recurrence)) return await googleJson<GoogleCalendarEvent>(url, token, { recurrence }, { method: 'PATCH', ...(current.etag ? { etag: current.etag } : {}) });
        return current;
      }
    }
    await googleJson(url, token, undefined, { method: 'DELETE', ...(current.etag ? { etag: current.etag } : {}) });
  } catch (reason) {
    if (![404, 410].includes((reason as { status?: number }).status ?? 0)) throw reason;
  }
}
