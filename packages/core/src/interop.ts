import { APP_ID, APP_NAME, createItem, SCHEMA_VERSION } from './types.js';
import { migrateWorkspace, validateWorkspace } from './schema.js';
import { workspaceForExport } from './export-privacy.js';
import type { UniversalItem, WorkspaceDocument } from './types.js';

export interface InteropWarning { itemId?: string; field: string; message: string }
export interface ImportResult { workspace: WorkspaceDocument; warnings: InteropWarning[]; imported: number; updated: number }

export function toCanonicalJSON(workspace: WorkspaceDocument, pretty = true): string {
  const safe = workspaceForExport(workspace);
  const validation = validateWorkspace(safe);
  if (!validation.valid) throw new Error(`Invalid workspace: ${validation.errors.join('; ')}`);
  return JSON.stringify(safe, null, pretty ? 2 : undefined);
}

export function fromCanonicalJSON(source: string): WorkspaceDocument {
  const parsed: unknown = JSON.parse(source);
  return migrateWorkspace(parsed).value;
}

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function unescapeText(value: string): string {
  return value.replace(/\\n/g, '\n').replace(/\\([\\,;])/g, '$1');
}

function icsDate(value: string, allDay = false): string {
  const date = new Date(value);
  if (allDay) return date.toISOString().slice(0, 10).replace(/-/g, '');
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function parseIcsDate(value: string): string {
  if (/^\d{8}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00.000Z`;
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(value);
  if (!match) throw new Error(`Unsupported iCalendar date: ${value}`);
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.000Z`;
}

function fold(line: string): string {
  const chunks: string[] = [];
  let rest = line;
  while (rest.length > 73) { chunks.push(rest.slice(0, 73)); rest = rest.slice(73); }
  chunks.push(rest);
  return chunks.join('\r\n ');
}

export interface ICSExportOptions { includeUtmMetadata?: boolean }

const metadataStart = '--- UTM metadata (do not edit) ---';
const metadataEnd = '--- End UTM metadata ---';
function descriptionWithMetadata(item: UniversalItem, includeMetadata: boolean): string {
  if (!includeMetadata) return item.bodyMarkdown;
  return `${item.bodyMarkdown}${item.bodyMarkdown ? '\n\n' : ''}${metadataStart}\n${JSON.stringify(item)}\n${metadataEnd}`;
}
function readDescriptionMetadata(value: string): { body: string; item?: UniversalItem } {
  const start = value.indexOf(metadataStart); const end = value.indexOf(metadataEnd);
  if (start < 0 || end < start) return { body: value };
  const body = value.slice(0, start).replace(/\n\s*$/, '');
  try { return { body, item: JSON.parse(value.slice(start + metadataStart.length, end).trim()) as UniversalItem }; }
  catch { return { body }; }
}

export function toICS(workspace: WorkspaceDocument, options: ICSExportOptions = {}): { ics: string; warnings: InteropWarning[] } {
  workspace = workspaceForExport(workspace);
  const warnings: InteropWarning[] = [];
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Universal Task Manager//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const item of Object.values(workspace.items).filter((candidate) => !candidate.deletedAt && candidate.role !== 'occurrence')) {
    // Most consumer calendars ignore VTODO. Any item that has a scheduled start
    // therefore becomes a standard VEVENT, even when it has no explicit end.
    const isEvent = Boolean(item.schedule?.startAt);
    lines.push(`BEGIN:${isEvent ? 'VEVENT' : 'VTODO'}`);
    lines.push(`UID:${escapeText(item.id)}@universal-task-manager`);
    lines.push(`DTSTAMP:${icsDate(item.updatedAt)}`);
    lines.push(`SUMMARY:${escapeText(item.title)}`);
    const description = descriptionWithMetadata(item, Boolean(options.includeUtmMetadata));
    if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
    if (item.schedule?.startAt) lines.push(`${isEvent ? 'DTSTART' : 'DTSTART'}${item.schedule.allDay ? ';VALUE=DATE' : ''}:${icsDate(item.schedule.startAt, item.schedule.allDay)}`);
    if (item.schedule?.endAt) lines.push(`DTEND${item.schedule.allDay ? ';VALUE=DATE' : ''}:${icsDate(item.schedule.endAt, item.schedule.allDay)}`);
    if (item.schedule?.dueAt) lines.push(`DUE${item.schedule.allDay ? ';VALUE=DATE' : ''}:${icsDate(item.schedule.dueAt, item.schedule.allDay)}`);
    if (item.recurrence) {
      lines.push(item.recurrence.rrule.startsWith('RRULE:') ? item.recurrence.rrule : `RRULE:${item.recurrence.rrule}`);
      item.recurrence.rdates.forEach((date) => lines.push(`RDATE:${icsDate(date)}`));
      item.recurrence.exdates.forEach((date) => lines.push(`EXDATE:${icsDate(date)}`));
    }
    lines.push(`STATUS:${isEvent ? (item.state === 'cancelled' ? 'CANCELLED' : 'CONFIRMED') : (item.state === 'done' ? 'COMPLETED' : item.state === 'cancelled' ? 'CANCELLED' : 'NEEDS-ACTION')}`);
    lines.push(`X-UTM-ID:${escapeText(item.id)}`);
    lines.push(`X-UTM-STATE:${item.state}`);
    lines.push(`X-UTM-PRESET:${item.preset}`);
    lines.push(`X-UTM-CREATED-WITH-APP-ID:${escapeText(item.createdWithAppId)}`);
    lines.push(`X-UTM-CREATED-WITH-APP-NAME:${escapeText(item.createdWithAppName)}`);
    lines.push(`X-UTM-CREATED-WITH-VERSION:${escapeText(item.createdWithVersion)}`);
    lines.push(`X-UTM-CREATED-WITH:${escapeText(item.createdWithVersion)}`);
    if (item.recurrence) lines.push(`X-UTM-AUTORENEW:${item.recurrence.autoRenew ? 'TRUE' : 'FALSE'}`);
    if (item.tags.length) lines.push(`CATEGORIES:${item.tags.map(escapeText).join(',')}`);
    if (!options.includeUtmMetadata && (Object.keys(item.custom).length || item.relations.length || item.habit || item.reminders.length || item.attachments.length || item.contexts.length)) {
      warnings.push({ itemId: item.id, field: 'extended-properties', message: 'Custom fields, relations, and habit settings are not fully representable in iCalendar.' });
    }
    lines.push(`END:${isEvent ? 'VEVENT' : 'VTODO'}`);
  }
  lines.push('END:VCALENDAR');
  return { ics: lines.map(fold).join('\r\n') + '\r\n', warnings };
}

export function fromICS(source: string, workspace: WorkspaceDocument): ImportResult {
  const unfolded = source.replace(/\r?\n[ \t]/g, '');
  const components = [...unfolded.matchAll(/BEGIN:(VEVENT|VTODO)\r?\n([\s\S]*?)\r?\nEND:\1/g)];
  const warnings: InteropWarning[] = [];
  let imported = 0;
  let updated = 0;
  for (const component of components) {
    const kind = component[1]!;
    const props = new Map<string, string>();
    for (const line of component[2]!.split(/\r?\n/)) {
      const separator = line.indexOf(':');
      if (separator < 0) continue;
      const rawKey = line.slice(0, separator);
      props.set(rawKey.split(';')[0]!, line.slice(separator + 1));
    }
    const externalUid = props.get('X-UTM-ID') ?? props.get('UID')?.replace(/@universal-task-manager$/, '');
    if (!externalUid) { warnings.push({ field: 'UID', message: 'Skipped a component without UID.' }); continue; }
    const existing = workspace.items[externalUid];
    const decodedDescription = readDescriptionMetadata(unescapeText(props.get('DESCRIPTION') ?? ''));
    const item = decodedDescription.item ? structuredClone(decodedDescription.item) : (existing ?? createItem(unescapeText(props.get('SUMMARY') ?? 'Untitled'), kind === 'VEVENT' ? 'event' : 'task'));
    item.id = externalUid;
    item.title = unescapeText(props.get('SUMMARY') ?? item.title);
    item.bodyMarkdown = decodedDescription.body;
    item.schemaVersion = SCHEMA_VERSION;
    if (!existing) {
      const provenance = item as unknown as {
        createdWithAppId: string;
        createdWithAppName: string;
        createdWithVersion: string;
      };
      provenance.createdWithAppId = props.get('X-UTM-CREATED-WITH-APP-ID') ?? APP_ID;
      provenance.createdWithAppName = props.get('X-UTM-CREATED-WITH-APP-NAME') ?? APP_NAME;
      provenance.createdWithVersion = props.get('X-UTM-CREATED-WITH-VERSION') ?? props.get('X-UTM-CREATED-WITH') ?? item.createdWithVersion;
    }
    item.role = props.has('RRULE') ? 'series_template' : 'standalone';
    item.preset = (props.get('X-UTM-PRESET') as UniversalItem['preset'] | undefined) ?? (kind === 'VEVENT' ? 'event' : 'task');
    const start = props.get('DTSTART');
    const end = props.get('DTEND');
    const due = props.get('DUE');
    if (start || end || due) item.schedule = {
      timezone: 'UTC', ...(start ? { startAt: parseIcsDate(start) } : {}),
      ...(end ? { endAt: parseIcsDate(end) } : {}), ...(due ? { dueAt: parseIcsDate(due) } : {}),
    };
    if (props.has('RRULE')) item.recurrence = {
      rrule: props.get('RRULE')!, rdates: [], exdates: [], timezone: item.schedule?.timezone ?? 'UTC',
      closeAt: 'next_activation', anchor: 'schedule', autoRenew: props.get('X-UTM-AUTORENEW') === 'TRUE',
    };
    const status = props.get('X-UTM-STATE') ?? props.get('STATUS');
    if (status === 'COMPLETED') item.state = 'done';
    else if (status === 'CANCELLED') item.state = 'cancelled';
    else if (['open', 'done', 'cancelled', 'auto_closed', 'archived'].includes(status ?? '')) item.state = status as UniversalItem['state'];
    item.tags = (props.get('CATEGORIES') ?? '').split(',').filter(Boolean).map(unescapeText);
    item.updatedAt = new Date().toISOString();
    item.revision += existing ? 1 : 0;
    workspace.items[item.id] = item;
    if (existing) updated += 1; else imported += 1;
  }
  workspace.updatedAt = new Date().toISOString();
  return { workspace, warnings, imported, updated };
}
