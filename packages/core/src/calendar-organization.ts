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
const sameNames = (left: string[], right: string[]) => left.length === right.length && left.every((name, index) => String(name) === String(right[index]));
const sameSource = (left: CalendarOrganizationSource | undefined, right: CalendarOrganizationSource) => Boolean(left && String(left.calendarId) === right.calendarId && String(left.tag) === right.tag && String(left.color ?? '') === String(right.color ?? '') && sameNames(left.areas, right.areas) && sameNames(left.projects, right.projects));

export function removeDetachedCalendarTags(workspace: WorkspaceDocument): void {
  // Explicit detachment is distinct from missing cached Google data in a backup.
  for (const item of Object.values(workspace.items)) {
    const pending = item.extensions?.['utm:googleSave'] as { kind?: string } | undefined;
    const source = item.extensions?.[CALENDAR_ORGANIZATION] as unknown as CalendarOrganizationSource | undefined;
    if (pending?.kind !== 'delete' || !source) continue;
    item.tags = item.tags.filter(tag => String(tag) !== String(source.tag));
    delete item.extensions![CALENDAR_ORGANIZATION];
  }
}

/** Materialize source contributions while preserving memberships supplied by the user. */
export function reconcileCalendarOrganization(workspace: WorkspaceDocument): void {
  removeDetachedCalendarTags(workspace);
  const google = workspace.calendarPreferences.googleCalendar;
  if (!google) return;
  const used = new Set([...Object.values(workspace.items).flatMap((item) => item.tags), ...(workspace.organizationPreferences?.tagOrder ?? []).filter((name): name is string => name !== null)].map(String));
  for (const calendar of google.calendars) {
    if (!calendar.managedTag) {
      const previous = Object.values(workspace.items).map((item) => item.extensions?.[CALENDAR_ORGANIZATION] as unknown as CalendarOrganizationSource | undefined).find((source) => source && String(source.calendarId) === String(calendar.id));
      if (previous) calendar.managedTag = String(previous.tag);
    }
    if (!calendar.selected) {
      const old = calendar.managedTag ? String(calendar.managedTag) : undefined;
      if (old) {
        for (const item of Object.values(workspace.items)) {
          if (item.tags.some((tag) => String(tag) === old)) item.tags = item.tags.filter((tag) => String(tag) !== old);
        }
        if (workspace.organizationPreferences.tagOrder.some((tag) => String(tag) === old)) workspace.organizationPreferences.tagOrder = workspace.organizationPreferences.tagOrder.filter((tag) => String(tag) !== old);
        if (workspace.organizationPreferences.tagAccents) delete workspace.organizationPreferences.tagAccents[old];
        used.delete(old);
      }
      delete calendar.managedTag;
      continue;
    }
    const base = `C.${calendar.name}`;
    let tag = base;
    let suffix = 2;
    while (used.has(tag) && tag !== String(calendar.managedTag ?? '')) tag = `${base} (${suffix++})`;
    const old = calendar.managedTag ? String(calendar.managedTag) : undefined;
    if (old && old !== tag) {
      renameTagDefinition(workspace, old, tag);
      for (const item of Object.values(workspace.items)) {
        const source = item.extensions?.[CALENDAR_ORGANIZATION] as unknown as CalendarOrganizationSource | undefined;
        if (source && String(source.tag) === old) source.tag = tag;
      }
      used.delete(old);
    }
    if (String(calendar.managedTag ?? '') !== tag) calendar.managedTag = tag;
    used.add(tag);
    if (!workspace.organizationPreferences.tagOrder.some((name) => String(name) === tag) || (calendar.color && String(workspace.organizationPreferences.tagAccents?.[tag] ?? '') !== String(calendar.color))) ensureTagDefinition(workspace, tag, calendar.color ? { accent: String(calendar.color) } : {});
  }
  const calendars = new Map(google.calendars.map((calendar) => [String(calendar.id), calendar]));
  for (const item of Object.values(workspace.items)) {
    if (!item.external || String(item.external.connectionId) !== String(google.connectionId)) continue;
    const calendar = calendars.get(String(item.external.calendarId));
    const previous = item.extensions?.[CALENDAR_ORGANIZATION] as unknown as CalendarOrganizationSource | undefined;
    if (!calendar?.selected || !calendar.managedTag) {
      if (!previous) continue;
      const tags = item.tags.filter((tag) => String(tag) !== String(previous.tag));
      const areas = item.areas.filter((name) => !previous.areas.some((previousName) => String(previousName) === String(name)));
      const projects = item.projects.filter((name) => !previous.projects.some((previousName) => String(previousName) === String(name)));
      if (!sameNames(item.tags, tags)) item.tags = tags;
      if (!sameNames(item.areas, areas)) item.areas = areas;
      if (!sameNames(item.projects, projects)) item.projects = projects;
      delete item.extensions?.[CALENDAR_ORGANIZATION];
      continue;
    }
    const source: CalendarOrganizationSource = { calendarId: String(calendar.id), tag: String(calendar.managedTag), areas: [], projects: [], ...(calendar.color ? { color: String(calendar.color) } : {}) };
    for (const kind of ['areas', 'projects'] as const) {
      const manual = item[kind].filter((name) => !previous?.[kind]?.some((previousName) => String(previousName) === String(name))).map(String);
      const definitions = kind === 'areas' ? workspace.areaDefinitions : workspace.projectDefinitions;
      const mapped = (calendar[kind] ?? []).map(String).filter((name) => Boolean(definitions[name]));
      source[kind] = mapped.filter((name) => !manual.some((manualName) => String(manualName) === String(name)));
      const next = [...new Set([...manual, ...mapped])];
      if (!sameNames(item[kind], next)) item[kind] = next;
    }
    const tags = [...new Set([...item.tags.filter((tag) => String(tag) !== String(previous?.tag ?? '')).map(String), String(calendar.managedTag)])];
    if (!sameNames(item.tags, tags)) item.tags = tags;
    if (!sameSource(previous, source)) {
      item.extensions ??= {};
      item.extensions[CALENDAR_ORGANIZATION] = JSON.parse(JSON.stringify(source));
    }
  }
}
