import type { GoogleCalendarPreferences, WorkspaceDocument } from './types.js';
import { ensureTagDefinition } from './organization.js';

export const CALENDAR_ORGANIZATION = 'utm:calendarOrganization';
export const GOOGLE_WRITE_DAILY_LIMIT = 25;
export const GOOGLE_WRITE_BATCH_LIMIT = 5;

export function recentGoogleWriteTimestamps(preferences: GoogleCalendarPreferences, now = Date.now()): string[] {
  const cutoff = now - 24 * 60 * 60 * 1_000;
  return (preferences.writeTimestamps ?? []).filter((value) => {
    const at = Date.parse(value);
    return Number.isFinite(at) && at >= cutoff && at <= now + 60_000;
  });
}

export function googleWriteLimitReached(preferences: GoogleCalendarPreferences, now = Date.now()): boolean {
  return recentGoogleWriteTimestamps(preferences, now).length >= (preferences.writeDailyLimit ?? GOOGLE_WRITE_DAILY_LIMIT);
}

export function recordGoogleWrite(preferences: GoogleCalendarPreferences, at = new Date()): void {
  preferences.writeTimestamps = [...recentGoogleWriteTimestamps(preferences, at.getTime()), at.toISOString()].slice(-200);
}

export interface CalendarOrganizationSource {
  calendarId: string;
  tag?: string;
  tags?: string[];
  color?: string;
  areas: string[];
  projects: string[];
}
const sameNames = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => String(v) === String(b[i]));
const sameSource = (a: CalendarOrganizationSource | undefined, b: CalendarOrganizationSource) => Boolean(a && !a.tag && String(a.calendarId) === b.calendarId && String(a.color ?? '') === String(b.color ?? '') && sameNames(a.tags ?? [], b.tags ?? []) && sameNames(a.areas, b.areas) && sameNames(a.projects, b.projects));
export function removeDetachedCalendarTags(workspace: WorkspaceDocument): void {
  for (const item of Object.values(workspace.items)) {
    const pending = item.extensions?.['utm:googleSave'] as { kind?: string } | undefined;
    const source = item.extensions?.[CALENDAR_ORGANIZATION] as unknown as CalendarOrganizationSource | undefined;
    if (pending?.kind !== 'delete' || !source) continue;
    item.tags = item.tags.filter(tag => ![...(source.tags ?? []), ...(source.tag ? [source.tag] : [])].includes(String(tag)));
    delete item.extensions![CALENDAR_ORGANIZATION];
  }
}
/** Apply explicit calendar memberships while preserving manual contributions. */
export function retireLegacyCalendarTags(workspace: WorkspaceDocument): void {
  const google = workspace.calendarPreferences.googleCalendar;
  const legacy = new Set<string>();
  for (const calendar of google?.calendars ?? []) {
    if (calendar.managedTag) { legacy.add(String(calendar.managedTag)); delete calendar.managedTag; }
  }
  for (const item of Object.values(workspace.items)) {
    const source = item.extensions?.[CALENDAR_ORGANIZATION] as unknown as CalendarOrganizationSource | undefined;
    if (source?.tag) { legacy.add(String(source.tag)); delete source.tag; }
  }
  // A C. prefix alone never identifies a generated tag.
  if (legacy.size) {
    for (const item of Object.values(workspace.items)) {
      const tags = item.tags.filter(tag => !legacy.has(String(tag)));
      if (!sameNames(item.tags, tags)) item.tags = tags;
    }
    workspace.organizationPreferences.tagOrder = workspace.organizationPreferences.tagOrder.filter(tag => tag === null || !legacy.has(String(tag)));
    for (const tag of legacy) delete workspace.organizationPreferences.tagAccents?.[tag];
  }
}

export function reconcileCalendarOrganization(workspace: WorkspaceDocument): void {
  retireLegacyCalendarTags(workspace);
  const google = workspace.calendarPreferences.googleCalendar;
  removeDetachedCalendarTags(workspace);
  if (!google) return;
  const calendars = new Map(google.calendars.map(calendar => [String(calendar.id), calendar]));
  for (const item of Object.values(workspace.items)) {
    if (!item.external || String(item.external.connectionId) !== String(google.connectionId)) continue;
    const calendar = calendars.get(String(item.external.calendarId));
    const previous = item.extensions?.[CALENDAR_ORGANIZATION] as unknown as CalendarOrganizationSource | undefined;
    if (!calendar?.selected) {
      if (!previous) continue;
      for (const kind of ['tags', 'areas', 'projects'] as const) {
        const next = item[kind].filter(name => !(previous[kind] ?? []).some(old => String(old) === String(name)));
        if (!sameNames(item[kind], next)) item[kind] = next;
      }
      delete item.extensions?.[CALENDAR_ORGANIZATION];
      continue;
    }
    const source: CalendarOrganizationSource = { calendarId: String(calendar.id), tags: [], areas: [], projects: [], ...(calendar.color ? { color: String(calendar.color) } : {}) };
    for (const kind of ['tags', 'areas', 'projects'] as const) {
      const manual = item[kind].filter(name => !(previous?.[kind] ?? []).some(old => String(old) === String(name))).map(String);
      const mapped = (calendar[kind] ?? []).map(String).filter(name => kind === 'tags' ? Boolean(name.trim()) : Boolean((kind === 'areas' ? workspace.areaDefinitions : workspace.projectDefinitions)[name]));
      if (kind === 'tags') for (const tag of mapped) {
        if (!workspace.organizationPreferences.tagOrder.includes(tag)) ensureTagDefinition(workspace, tag);
      }
      source[kind] = mapped.filter(name => !manual.includes(name));
      const next = [...new Set([...manual, ...mapped])];
      if (!sameNames(item[kind], next)) item[kind] = next;
    }
    if (!sameSource(previous, source)) {
      item.extensions ??= {};
      item.extensions[CALENDAR_ORGANIZATION] = JSON.parse(JSON.stringify(source));
    }
  }
}
