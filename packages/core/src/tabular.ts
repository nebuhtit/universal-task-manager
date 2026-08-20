import { APP_ID, APP_NAME, APP_VERSION, createId, createItem, SCHEMA_VERSION } from './types.js';
import { migrateItem, migrateView } from './schema.js';
import type { CustomFieldDefinition, CustomFieldKind, PortablePackage, SavedView, UniversalItem, WorkspaceDocument } from './types.js';

export type TabularCell = string | number | boolean | null | undefined;
export type TabularRow = Record<string, TabularCell>;
export interface TabularWorkbookData { items: TabularRow[]; customFields: TabularRow[]; views: TabularRow[]; warnings: string[] }

export const ITEM_COLUMNS = ['title', 'description', 'state', 'preset', 'role', 'start', 'end', 'due', 'timezone', 'all_day', 'priority', 'tags', 'contexts', 'rrule', 'utm_item_json'];

const text = (value: TabularCell) => value == null ? '' : String(value);
const dateLike = (value: string) => /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) && !Number.isNaN(new Date(value).getTime());
const safeCell = (value: string) => /^[=+\-@]/.test(value) ? `'${value}` : value;
const keyFor = (label: string) => (label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'imported_field').replace(/^([^a-z])/, 'field_$1');

/** CSV has no type system. Keep values harmless when opened in Excel. */
export function toCsv(rows: TabularRow[], columns = ITEM_COLUMNS): string {
  const escape = (value: TabularCell) => `"${safeCell(text(value)).replace(/"/g, '""')}"`;
  return [columns.map(escape).join(','), ...rows.map((row) => columns.map((column) => escape(row[column])).join(','))].join('\r\n') + '\r\n';
}

export function parseCsv(source: string): TabularRow[] {
  const input = source.replace(/^\uFEFF/, ''); const rows: string[][] = []; let row: string[] = []; let value = ''; let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (quoted) { if (char === '"' && input[index + 1] === '"') { value += '"'; index += 1; } else if (char === '"') quoted = false; else value += char; continue; }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { row.push(value); value = ''; continue; }
    if (char === '\n') { row.push(value.replace(/\r$/, '')); rows.push(row); row = []; value = ''; continue; }
    value += char;
  }
  if (quoted) throw new Error('CSV has an unclosed quoted value.');
  if (value.length || row.length) { row.push(value.replace(/\r$/, '')); rows.push(row); }
  if (!rows.length) throw new Error('CSV is empty.');
  const headers = rows.shift()!.map((header) => header.trim());
  if (!headers.some(Boolean)) throw new Error('CSV must have a header row.');
  return rows.filter((values) => values.some((entry) => entry.trim())).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

export function packageToTabular(value: PortablePackage): TabularWorkbookData {
  const warnings: string[] = [];
  const items = value.items.map((item) => ({
    title: item.title, description: item.bodyMarkdown, state: item.state, preset: item.preset, role: item.role,
    start: item.schedule?.startAt ?? '', end: item.schedule?.endAt ?? '', due: item.schedule?.dueAt ?? '', timezone: item.schedule?.timezone ?? '',
    all_day: item.schedule?.allDay ? 'true' : '', priority: item.priority ?? '', tags: item.tags.join(', '), contexts: item.contexts.join(', '), rrule: item.recurrence?.rrule ?? '',
    utm_item_json: JSON.stringify(item),
  }));
  const customFields = Object.values(value.customFields).map((field) => ({ key: field.key, label: field.label, kind: field.kind, required: String(field.required), options: JSON.stringify(field.options ?? []), formula: field.formula ?? '', utm_custom_field_json: JSON.stringify(field) }));
  const views = value.views.map((view) => ({ name: view.name, renderer: view.renderer, query: view.query.source, utm_view_json: JSON.stringify(view) }));
  if (items.some((item) => text(item.utm_item_json).length > 32_000)) warnings.push('Some item metadata is large; CSV remains valid but may be awkward to inspect in a spreadsheet.');
  return { items, customFields, views, warnings };
}

function inferKind(value: string): CustomFieldKind {
  if (/^(true|false)$/i.test(value)) return 'boolean';
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return 'number';
  if (dateLike(value)) return value.includes('T') ? 'datetime' : 'date';
  return 'text';
}

function genericItem(row: TabularRow, customKeys: Map<string, CustomFieldDefinition>, warnings: string[]): UniversalItem {
  const title = text(row.title || row.Title || row.name || row.Name || row.summary || row.SUMMARY || 'Untitled').trim() || 'Untitled';
  const preset = (text(row.preset).toLowerCase() || 'task') as UniversalItem['preset'];
  const item = createItem(title, ['task', 'event', 'habit', 'blank'].includes(preset) ? preset : 'task');
  item.bodyMarkdown = text(row.description || row.Description || row.notes || row.Notes);
  const state = text(row.state).toLowerCase(); if (['open', 'done', 'cancelled', 'auto_closed', 'archived'].includes(state)) item.state = state as UniversalItem['state'];
  const priority = Number(text(row.priority)); if (Number.isInteger(priority) && priority >= 0 && priority <= 4) item.priority = priority as NonNullable<UniversalItem['priority']>;
  item.tags = text(row.tags).split(',').map((tag) => tag.trim()).filter(Boolean); item.contexts = text(row.contexts).split(',').map((tag) => tag.trim()).filter(Boolean);
  const start = text(row.start || row.startAt); const end = text(row.end || row.endAt); const due = text(row.due || row.dueAt); const timezone = text(row.timezone) || 'UTC';
  if (start || end || due) item.schedule = { timezone, ...(start ? { startAt: start } : {}), ...(end ? { endAt: end } : {}), ...(due ? { dueAt: due } : {}), ...(text(row.all_day) === 'true' ? { allDay: true } : {}) };
  const reserved = new Set(ITEM_COLUMNS.concat(['Title', 'name', 'Name', 'summary', 'SUMMARY', 'Description', 'notes', 'Notes', 'startAt', 'endAt', 'dueAt']));
  for (const [label, raw] of Object.entries(row)) {
    if (reserved.has(label) || text(raw) === '') continue;
    const key = keyFor(label); let field = customKeys.get(key);
    if (!field) { field = { id: createId(), key, label, kind: inferKind(text(raw)), required: false }; customKeys.set(key, field); warnings.push(`Imported column "${label}" as custom.${key}`); }
    const kind = field.kind; item.custom[key] = kind === 'number' ? Number(text(raw)) : kind === 'boolean' ? /^true$/i.test(text(raw)) : text(raw);
  }
  return item;
}

/** Converts UTM tables or ordinary header-based tables to the existing portable package. */
export function tabularToPackage(data: { items: TabularRow[]; customFields?: TabularRow[]; views?: TabularRow[] }, workspace: WorkspaceDocument): { package: PortablePackage; warnings: string[] } {
  const warnings: string[] = []; const customFields = new Map<string, CustomFieldDefinition>();
  for (const row of data.customFields ?? []) {
    const raw = text(row.utm_custom_field_json); if (!raw) continue;
    try { const parsed = JSON.parse(raw); const field = parsed as CustomFieldDefinition; customFields.set(field.key, field); } catch { warnings.push(`Skipped malformed custom field ${text(row.label || row.key)}`); }
  }
  const items: UniversalItem[] = [];
  for (const row of data.items) {
    const raw = text(row.utm_item_json);
    try { items.push(raw ? migrateItem(JSON.parse(raw), 'import:tabular').value : genericItem(row, customFields, warnings)); }
    catch (error) { throw new Error(`Could not import row "${text(row.title) || 'Untitled'}": ${error instanceof Error ? error.message : String(error)}`); }
  }
  const views: SavedView[] = [];
  for (const row of data.views ?? []) { const raw = text(row.utm_view_json); if (!raw) continue; try { views.push(migrateView(JSON.parse(raw), 'import:tabular').value); } catch { warnings.push(`Skipped malformed view ${text(row.name)}`); } }
  const fields = Object.fromEntries([...customFields.values()].map((field) => [field.id, field]));
  return { package: { format: 'utm-portable', formatVersion: 1, kind: views.length && items.length ? 'view_bundle' : views.length ? 'views' : 'items', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), source: { appId: APP_ID, appName: APP_NAME, appVersion: APP_VERSION, workspaceId: workspace.workspaceId }, customFields: fields, items, views, dependencyItemIds: [] }, warnings };
}
