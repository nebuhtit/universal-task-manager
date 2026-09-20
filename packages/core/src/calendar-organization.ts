import type { WorkspaceDocument } from './types.js';
import { ensureTagDefinition, renameTagDefinition } from './organization.js';

export const CALENDAR_ORGANIZATION = 'utm:calendarOrganization';
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
    const base = `.${calendar.name}`;
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
    if (!calendar?.managedTag) continue;
    const previous = item.extensions?.[CALENDAR_ORGANIZATION] as unknown as CalendarOrganizationSource | undefined;
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
