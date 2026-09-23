import { APP_ID, APP_NAME, APP_VERSION, SCHEMA_VERSION, durationToMs, type UniversalItem, type WorkspaceDocument } from './types.js';
import { retainedItemHistory, syncActualDuration } from './item-history.js';
import { reconcileCalendarOrganization } from './calendar-organization.js';

export interface GoogleCalendarEventDate {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GoogleCalendarEvent {
  /** Computed locally, never sent to Google. */
  localHistoryKey?: string;
  id: string;
  iCalUID?: string;
  eventType?: string;
  etag?: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  created?: string;
  updated?: string;
  transparency?: 'opaque' | 'transparent';
  recurringEventId?: string;
  recurrence?: string[];
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
  /** Duration of the recurring series source, populated by the browser sync. */
  seriesDurationMilliseconds?: number;
  start?: GoogleCalendarEventDate;
  end?: GoogleCalendarEventDate;
  attachments?: Array<{ fileId?: string; fileUrl?: string; title?: string; mimeType?: string }>;
}

export const GOOGLE_TRAVEL_DURATION_PROPERTY = 'utmTravelDuration';

function googleTravelDuration(event: GoogleCalendarEvent): { present: boolean; value?: string } {
  const properties = event.extendedProperties?.private;
  if (!properties || !Object.prototype.hasOwnProperty.call(properties, GOOGLE_TRAVEL_DURATION_PROPERTY)) return { present: false };
  const value = properties[GOOGLE_TRAVEL_DURATION_PROPERTY];
  try { if (value && durationToMs(value) > 0) return { present: true, value }; } catch { /* Invalid metadata is an explicit clear. */ }
  return { present: true };
}

export interface GoogleCalendarSyncBatch {
  connectionId: string;
  calendarId: string;
  events: GoogleCalendarEvent[];
  syncedAt: string;
  fullSync: boolean;
}

const externalId = (calendarId: string, eventId: string) => `google:${encodeURIComponent(calendarId)}:${encodeURIComponent(eventId)}`;

function validIso(value: string | undefined, fallback: string): string {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : fallback;
}

function isoDuration(milliseconds: number): string | undefined {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return undefined;
  const seconds = Math.ceil(milliseconds / 1_000);
  const days = Math.floor(seconds / 86_400);
  const remainder = seconds % 86_400;
  const hours = Math.floor(remainder / 3_600);
  const minutes = Math.floor((remainder % 3_600) / 60);
  const tailSeconds = remainder % 60;
  return `${days ? `P${days}D` : 'P'}${hours || minutes || tailSeconds ? `T${hours ? `${hours}H` : ''}${minutes ? `${minutes}M` : ''}${tailSeconds ? `${tailSeconds}S` : ''}` : ''}`;
}

function dateOnlyInstant(value: string | undefined, timeZone: string): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  const wallClock = Date.UTC(year!, month! - 1, day!);
  let instant = new Date(wallClock);
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
      const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
      const displayed = Date.UTC(values.year!, values.month! - 1, values.day!, values.hour!, values.minute!, values.second!);
      const next = new Date(wallClock - (displayed - instant.getTime()));
      if (next.getTime() === instant.getTime()) break;
      instant = next;
    }
  } catch { /* Invalid imported timezone falls back to UTC. */ }
  return instant.toISOString();
}

/** Converts one Google event into the canonical item shape without persisting credentials. */
export function googleCalendarEventToItem(event: GoogleCalendarEvent, calendarId: string, connectionId: string, syncedAt: string, fallbackTimezone = 'UTC'): UniversalItem | null {
  if (!event.id || event.status === 'cancelled') return null;
  const allDay = Boolean(event.start?.date && !event.start.dateTime);
  const timezone = event.start?.timeZone || event.end?.timeZone || fallbackTimezone;
  const startAt = allDay ? dateOnlyInstant(event.start?.date, timezone) : event.start?.dateTime;
  const endAt = allDay ? dateOnlyInstant(event.end?.date, timezone) : event.end?.dateTime;
  if (!startAt || !Number.isFinite(Date.parse(startAt))) return null;
  const start = Date.parse(startAt);
  const receivedEnd = endAt && Number.isFinite(Date.parse(endAt)) && Date.parse(endAt) > start ? Date.parse(endAt) : start;
  const receivedDuration = receivedEnd - start;
  const seriesDuration = event.seriesDurationMilliseconds;
  // Some recurring Google instances have been observed with the next
  // occurrence boundary in `end`. Only repair clearly suspicious timed spans;
  // shorter edited instances keep their own Google-provided end time.
  const repairedDuration = !allDay && event.recurringEventId && receivedDuration >= 86_400_000
    && Number.isFinite(seriesDuration) && seriesDuration! > 0 && seriesDuration! < receivedDuration
    ? seriesDuration!
    : receivedDuration;
  const end = start + repairedDuration;
  const estimatedDuration = isoDuration(end - start);
  const travel = googleTravelDuration(event);
  const timestamp = validIso(event.updated, syncedAt);
  const sourceUrl = event.htmlLink && /^https?:\/\//.test(event.htmlLink) ? event.htmlLink : `https://calendar.google.com/calendar/u/0/r/eventedit/${encodeURIComponent(event.id)}`;
  const item: UniversalItem = {
    id: externalId(calendarId, event.id), schemaVersion: SCHEMA_VERSION,
    createdWithAppId: APP_ID, createdWithAppName: APP_NAME, createdWithVersion: APP_VERSION,
    revision: 1, role: 'standalone', preset: 'event', title: event.summary?.trim() || 'Busy',
    bodyMarkdown: event.description ?? '', ...(event.location ? { location: event.location } : {}),
    state: 'open', createdAt: validIso(event.created, timestamp), updatedAt: timestamp,
    schedule: {
      timezone,
      ...(allDay ? { allDay: true } : {}), startAt: new Date(start).toISOString(),
      ...(end > start ? { endAt: new Date(end).toISOString(), ...(estimatedDuration ? { estimatedDuration } : {}) } : {}),
      ...(travel.value ? { travelDuration: travel.value } : {}),
    },
    areas: [], projects: [], contexts: [], tags: [], reminders: [], relations: [],
    attachments: (event.attachments ?? []).flatMap((attachment, index) => attachment.fileUrl && /^https?:\/\//.test(attachment.fileUrl) ? [{ id: attachment.fileId || `${event.id}:${index}`, url: attachment.fileUrl, ...(attachment.title ? { title: attachment.title } : {}), ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}) }] : []),
    custom: {}, ...(travel.present ? { extensions: { 'utm:googleTravelDuration': travel.value ?? '' } } : {}),
    external: {
      provider: 'google_calendar', connectionId, calendarId, eventId: event.id, sourceUrl, readOnly: true,
      transparency: event.transparency === 'transparent' ? 'transparent' : 'opaque',
      ...(event.etag ? { etag: event.etag } : {}), syncedAt,
    },
  };
  return item;
}

/** Remove only the calendar association; the UTM task and all its data survive. */
export function detachGoogleCalendar(item: UniversalItem): void {
  delete item.external;
  if (item.extensions) { delete item.extensions['utm:googleCreate']; delete item.extensions['utm:googleEdit']; delete item.extensions['utm:googleSave']; }
}

function linkGoogleCopy(workspace: WorkspaceDocument, target: UniversalItem, mirror: UniversalItem): void {
  if (!mirror.external) return;
  if (target.role === 'series_template') {
    const occurrence = Object.values(workspace.items).find((item) => !item.deletedAt && item.occurrence?.seriesId === target.id);
    if (occurrence) {
      occurrence.extensions ??= {};
      for (const key of ['utm:googleCreate', 'utm:googleLinkKey']) if (target.extensions?.[key] !== undefined) {
        occurrence.extensions[key] = JSON.parse(JSON.stringify(target.extensions[key])); delete target.extensions[key];
      }
      target = occurrence;
    }
  }
  target.external = { ...mirror.external, readOnly: false,
    ...(mirror.schedule?.startAt ? { startAt: mirror.schedule.startAt } : {}),
    ...(mirror.schedule?.endAt ? { endAt: mirror.schedule.endAt } : {}),
    ...(mirror.schedule?.timezone ? { timezone: mirror.schedule.timezone } : {}), allDay: mirror.schedule?.allDay === true };
  target.title = mirror.title;
  target.revision += 1;
  target.updatedAt = mirror.updatedAt;
  target.bodyMarkdown = mirror.bodyMarkdown;
  if (mirror.location) target.location = mirror.location; else delete target.location;
  target.schedule = { ...target.schedule, timezone: mirror.schedule!.timezone, startAt: mirror.schedule!.startAt!, endAt: mirror.schedule!.endAt!, allDay: mirror.schedule?.allDay === true };
  if (Object.prototype.hasOwnProperty.call(mirror.extensions ?? {}, 'utm:googleTravelDuration')) {
    if (mirror.schedule?.travelDuration) target.schedule.travelDuration = mirror.schedule.travelDuration;
    else delete target.schedule.travelDuration;
  }
  for (const field of ['actualTimeEntries', 'completionEntries', 'timerHistory'] as const) {
    const incoming = mirror[field];
    if (incoming?.length) (target as unknown as Record<string, unknown>)[field] = JSON.parse(JSON.stringify([...(target[field] ?? []), ...incoming.filter((entry) => !target[field]?.some((existing) => existing.id === entry.id))]));
  }
  syncActualDuration(target);
  // Only legacy stored copies can have references to remap. Normal sync updates
  // must not scan every task and view for each linked event.
  if (mirror.id === target.id || !workspace.items[mirror.id]) return;
  for (const item of Object.values(workspace.items)) for (const relation of item.relations) if (relation.targetId === mirror.id) relation.targetId = target.id;
  for (const view of Object.values(workspace.views)) {
    if (view.statistics) view.statistics.reservedItemIds = [...new Set(view.statistics.reservedItemIds.map((id) => id === mirror.id ? target.id : id))];
    const order = view.extensions?.['utm:manualOrder'];
    if (Array.isArray(order)) view.extensions!['utm:manualOrder'] = [...new Set(order.map((id) => id === mirror.id ? target.id : id))];
  }
  delete workspace.items[mirror.id]; delete workspace.tombstones[mirror.id];
}

/** Match only the persisted creation operation, never a title or approximate date. */
export function mergeGoogleCalendarCopies(workspace: WorkspaceDocument): void {
  for (const target of Object.values(workspace.items)) {
    if (target.deletedAt || target.external?.readOnly) continue;
    const operation = target.extensions?.['utm:googleCreate'] as { calendarId?: string; eventId?: string; accountEmail?: string } | undefined;
    if (!operation?.calendarId || !operation.eventId) continue;
    const account = workspace.calendarPreferences.googleCalendar?.accountEmail;
    if (account && operation.accountEmail?.toLowerCase() !== account.toLowerCase()) continue;
    const mirror = workspace.items[externalId(operation.calendarId, operation.eventId)];
    if (mirror?.external?.readOnly) linkGoogleCopy(workspace, target, mirror);
  }
}

/** Calendar-only projection keeps the UTM estimate, identity and state intact. */
export function googleCalendarProjection(item: UniversalItem): UniversalItem {
  const link = item.external;
  if (item.extensions?.['utm:googleSave']) return item;
  if (!link || link.readOnly || !link.startAt || !link.endAt) return item;
  return { ...item, schedule: { ...item.schedule, startAt: link.startAt, endAt: link.endAt, allDay: link.allDay ?? false, timezone: link.timezone ?? item.schedule?.timezone ?? 'UTC' } };
}

/** Applies one full or incremental calendar response in-place. */
export function applyGoogleCalendarSync(workspace: WorkspaceDocument, batch: GoogleCalendarSyncBatch): { added: number; updated: number; removed: number } {
  const seen = new Set<string>();
  const pendingDeletions = new Set(Object.values(workspace.items).flatMap((item) => {
    const pending = item.extensions?.['utm:googleSave'] as { kind?: string; calendarId?: string; eventId?: string } | undefined;
    return pending?.kind === 'delete' && pending.calendarId && pending.eventId ? [externalId(pending.calendarId, pending.eventId)] : [];
  }));
  const linkedByEvent = new Map<string, UniversalItem>();
  const restoredByKey = new Map<string, UniversalItem>();
  for (const item of Object.values(workspace.items)) if (!item.deletedAt && !item.external?.readOnly) {
    if (item.external) linkedByEvent.set(externalId(item.external.calendarId, item.external.eventId), item);
    const pending = item.extensions?.['utm:googleSave'] as { calendarId?: string; destination?: string; eventId?: string; accountEmail?: string } | undefined;
    if (pending?.eventId && pending.calendarId && pending.accountEmail === workspace.calendarPreferences.googleCalendar?.accountEmail) {
      linkedByEvent.set(externalId(pending.calendarId, pending.eventId), item);
      if (pending.destination) linkedByEvent.set(externalId(pending.destination, pending.eventId), item);
    }
    const key = item.extensions?.['utm:googleLinkKey'];
    if (typeof key === 'string') restoredByKey.set(key, item);
  }
  let added = 0; let updated = 0; let removed = 0;
  for (const event of batch.events) {
    const id = externalId(batch.calendarId, event.id);
    if (pendingDeletions.has(id)) {
      seen.add(id);
      const mirror = workspace.items[id];
      if (mirror?.external?.readOnly) { delete workspace.items[id]; delete workspace.tombstones[id]; removed += 1; }
      continue;
    }
    seen.add(id);
    const linked = linkedByEvent.get(id);
    if (linked) seen.add(linked.id);
    if (event.status === 'cancelled') {
      if (linked) detachGoogleCalendar(linked);
      const existing = workspace.items[id];
      if (existing) { delete workspace.items[id]; delete workspace.tombstones[id]; removed += 1; }
      continue;
    }
    const next = googleCalendarEventToItem(event, batch.calendarId, batch.connectionId, batch.syncedAt, workspace.calendarPreferences.timezone);
    if (!next) continue;
    const restored = event.localHistoryKey ? restoredByKey.get(event.localHistoryKey) : undefined;
    if (restored && !linked) { linkGoogleCopy(workspace, restored, next); seen.add(restored.id); updated += 1; continue; }
    if (linked) { if (!linked.extensions?.['utm:googleSave']) { linkGoogleCopy(workspace, linked, next); updated += 1; } continue; }
    const existing = workspace.items[id];
    if (!existing && event.localHistoryKey && workspace.calendarPreferences.localTimeJournals?.[event.localHistoryKey]) {
      next.actualTimeEntries = JSON.parse(JSON.stringify(workspace.calendarPreferences.localTimeJournals[event.localHistoryKey]));
      syncActualDuration(next);
    }
    const nextSchedule = next.schedule;
    if (existing && event.etag && existing.external?.etag === event.etag
      && existing.schedule?.startAt === nextSchedule?.startAt
      && existing.schedule?.endAt === nextSchedule?.endAt
      && existing.schedule?.estimatedDuration === nextSchedule?.estimatedDuration) continue;
    if (existing) {
      if (existing.eventProgram) next.eventProgram = JSON.parse(JSON.stringify(existing.eventProgram));
      if (existing.schedule?.travelBackDuration) next.schedule!.travelBackDuration = existing.schedule.travelBackDuration;
      if (existing.scripts) next.scripts = JSON.parse(JSON.stringify(existing.scripts));
      if (!Object.prototype.hasOwnProperty.call(next.extensions ?? {}, 'utm:googleTravelDuration') && existing.schedule?.travelDuration) next.schedule!.travelDuration = existing.schedule.travelDuration;
      next.areas = [...existing.areas]; next.projects = [...existing.projects]; next.tags = [...existing.tags];
      next.extensions = JSON.parse(JSON.stringify(existing.extensions ?? {}));
      Object.assign(next, retainedItemHistory(existing)); syncActualDuration(next);
      next.createdAt = existing.createdAt; next.revision = existing.revision + 1; updated += 1;
    }
    else added += 1;
    workspace.items[id] = next;
    delete workspace.tombstones[id];
  }
  if (batch.fullSync) {
    for (const item of Object.values(workspace.items)) {
      if (item.external?.provider !== 'google_calendar' || item.external.connectionId !== batch.connectionId || item.external.calendarId !== batch.calendarId || seen.has(item.id)) continue;
      if (item.external.readOnly) { delete workspace.items[item.id]; delete workspace.tombstones[item.id]; removed += 1; }
    }
  }
  mergeGoogleCalendarCopies(workspace);
  const linkedAfterSync = new Map(Object.values(workspace.items).filter((item) => item.external?.readOnly === false).map((item) => [externalId(item.external!.calendarId, item.external!.eventId), item]));
  for (const event of batch.events) if (event.localHistoryKey) {
    const item = linkedAfterSync.get(externalId(batch.calendarId, event.id));
    if (item) { item.extensions ??= {}; item.extensions['utm:googleLinkKey'] = event.localHistoryKey; }
  }
  reconcileCalendarOrganization(workspace);
  return { added, updated, removed };
}
