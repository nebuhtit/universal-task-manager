import { APP_ID, APP_NAME, APP_VERSION, SCHEMA_VERSION, type UniversalItem, type WorkspaceDocument } from './types.js';

export interface GoogleCalendarEventDate {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GoogleCalendarEvent {
  id: string;
  etag?: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  created?: string;
  updated?: string;
  transparency?: 'opaque' | 'transparent';
  start?: GoogleCalendarEventDate;
  end?: GoogleCalendarEventDate;
  attachments?: Array<{ fileId?: string; fileUrl?: string; title?: string; mimeType?: string }>;
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
  const end = endAt && Number.isFinite(Date.parse(endAt)) && Date.parse(endAt) > start ? Date.parse(endAt) : start;
  const estimatedDuration = isoDuration(end - start);
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
    },
    areas: [], projects: [], contexts: [], tags: [], reminders: [], relations: [],
    attachments: (event.attachments ?? []).flatMap((attachment, index) => attachment.fileUrl && /^https?:\/\//.test(attachment.fileUrl) ? [{ id: attachment.fileId || `${event.id}:${index}`, url: attachment.fileUrl, ...(attachment.title ? { title: attachment.title } : {}), ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}) }] : []),
    custom: {},
    external: {
      provider: 'google_calendar', connectionId, calendarId, eventId: event.id, sourceUrl, readOnly: true,
      transparency: event.transparency === 'transparent' ? 'transparent' : 'opaque',
      ...(event.etag ? { etag: event.etag } : {}), syncedAt,
    },
  };
  return item;
}

/** Applies one full or incremental calendar response in-place and tombstones removed Google events. */
export function applyGoogleCalendarSync(workspace: WorkspaceDocument, batch: GoogleCalendarSyncBatch): { added: number; updated: number; removed: number } {
  const seen = new Set<string>();
  let added = 0; let updated = 0; let removed = 0;
  for (const event of batch.events) {
    const id = externalId(batch.calendarId, event.id);
    seen.add(id);
    if (event.status === 'cancelled') {
      const existing = workspace.items[id];
      if (existing) { delete workspace.items[id]; delete workspace.tombstones[id]; removed += 1; }
      continue;
    }
    const next = googleCalendarEventToItem(event, batch.calendarId, batch.connectionId, batch.syncedAt, workspace.calendarPreferences.timezone);
    if (!next) continue;
    const existing = workspace.items[id];
    if (existing) { next.createdAt = existing.createdAt; next.revision = existing.revision + 1; updated += 1; }
    else added += 1;
    workspace.items[id] = next;
    delete workspace.tombstones[id];
  }
  if (batch.fullSync) {
    for (const item of Object.values(workspace.items)) {
      if (item.external?.provider !== 'google_calendar' || item.external.connectionId !== batch.connectionId || item.external.calendarId !== batch.calendarId || seen.has(item.id)) continue;
      delete workspace.items[item.id]; delete workspace.tombstones[item.id]; removed += 1;
    }
  }
  return { added, updated, removed };
}
