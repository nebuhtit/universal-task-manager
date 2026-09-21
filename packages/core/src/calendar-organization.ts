import type { GoogleCalendarPreferences, WorkspaceDocument } from './types.js';
import { ensureTagDefinition, renameTagDefinition } from './organization.js';

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
  tag: string;
  color?: string;
  areas: string[];
  projects: string[];
}

/** Materialize source contributions while preserving memberships supplied by the user. */
export function reconcileCalendarOrganization(workspace: WorkspaceDocument): void {
  const google = workspace.calendarPreferences.googleCalendar;
  if (!google) return;
  const used = new Set([...Object.values(workspace.items).flatMap((item) => item.tags), ...(workspace.organizationPreferences?.tagOrder ?? []).filter((name): name is string => name !== null)]);
  for (const calendar of google.calendars) {
    if (!calendar.managedTag) {
      const previous = Object.values(workspace.items).map((item) => item.extensions?.[CALENDAR_ORGANIZATION] as unknown as CalendarOrganizationSource | undefined).find((source) => source?.calendarId === calendar.id);
      if (previous) calendar.managedTag = previous.tag;
    }
    if (!calendar.selected) {
      calendar.areas = [];
      calendar.projects = [];
      const old = calendar.managedTag;
      if (old) {
        for (const item of Object.values(workspace.items)) item.tags = item.tags.filter((tag) => tag !== old);
        workspace.organizationPreferences.tagOrder = workspace.organizationPreferences.tagOrder.filter((tag) => tag !== old);
        if (workspace.organizationPreferences.tagAccents) delete workspace.organizationPreferences.tagAccents[old];
        used.delete(old);
      }
      delete calendar.managedTag;
      continue;
    }
    const base = `C.${calendar.name}`;
    let tag = base;
    let suffix = 2;
    while (used.has(tag) && tag !== calendar.managedTag) tag = `${base} (${suffix++})`;
    const old = calendar.managedTag;
    if (old && old !== tag) {
      renameTagDefinition(workspace, old, tag);
      for (const item of Object.values(workspace.items)) {
        const source = item.extensions?.[CALENDAR_ORGANIZATION] as unknown as CalendarOrganizationSource | undefined;
        if (source?.tag === old) source.tag = tag;
      }
      used.delete(old);
    }
    calendar.managedTag = tag;
    used.add(tag);
    ensureTagDefinition(workspace, tag, calendar.color ? { accent: calendar.color } : {});
  }
  const calendars = new Map(google.calendars.map((calendar) => [calendar.id, calendar]));
  for (const item of Object.values(workspace.items)) {
    if (!item.external || item.external.connectionId !== google.connectionId) continue;
    const calendar = calendars.get(item.external.calendarId);
    const previous = item.extensions?.[CALENDAR_ORGANIZATION] as unknown as CalendarOrganizationSource | undefined;
    if (!calendar?.selected || !calendar.managedTag) {
      if (!previous) continue;
      item.tags = item.tags.filter((tag) => tag !== previous.tag);
      item.areas = item.areas.filter((name) => !previous.areas.includes(name));
      item.projects = item.projects.filter((name) => !previous.projects.includes(name));
      delete item.extensions?.[CALENDAR_ORGANIZATION];
      continue;
    }
    const source: CalendarOrganizationSource = { calendarId: calendar.id, tag: calendar.managedTag, areas: [], projects: [], ...(calendar.color ? { color: calendar.color } : {}) };
    for (const kind of ['areas', 'projects'] as const) {
      const manual = item[kind].filter((name) => !previous?.[kind]?.includes(name));
      const definitions = kind === 'areas' ? workspace.areaDefinitions : workspace.projectDefinitions;
      const mapped = (calendar[kind] ?? []).filter((name) => Boolean(definitions[name]));
      source[kind] = mapped.filter((name) => !manual.includes(name));
      item[kind] = [...new Set([...manual, ...mapped])];
    }
    item.tags = [...new Set([...item.tags.filter((tag) => tag !== previous?.tag), calendar.managedTag])];
    item.extensions ??= {};
    item.extensions[CALENDAR_ORGANIZATION] = JSON.parse(JSON.stringify(source));
  }
}
