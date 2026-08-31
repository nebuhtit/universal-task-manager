import { APP_ID, APP_NAME, APP_VERSION, createId, SCHEMA_VERSION } from './types.js';
import { defaultOrganizationPreferences, ensureAreaDefinition, ensureProjectDefinition, ensureTagDefinition, normalizedOrder, normalizedOrganizationPriorityOrder } from './organization.js';
import { migrateItem, migrateView, validatePortablePackage } from './schema.js';
import { itemsForExport, viewsForExport, workspaceForExport } from './export-privacy.js';
import type {
  CustomFieldDefinition, OrganizationPreferences, PortablePackage, PortableSelection, ProjectDefinition, SavedView, UniversalItem, WorkspaceDocument,
} from './types.js';

const clone = <T>(value: T): T => structuredClone(value);

export interface PortablePackageOptions {
  kind: PortablePackage['kind'];
  items?: UniversalItem[];
  views?: SavedView[];
  selection?: PortableSelection;
  dependencyItemIds?: string[];
  now?: Date;
}

export function createPortablePackage(workspace: WorkspaceDocument, options: PortablePackageOptions): PortablePackage {
  const safeWorkspace = workspaceForExport(workspace);
  const items = itemsForExport(workspace, options.items ?? []);
  const views = viewsForExport(workspace, options.views ?? []);
  const itemIds = new Set(items.map((item) => item.id));
  const selection = options.selection?.type === 'single_item' && !itemIds.has(options.selection.itemId) ? undefined : options.selection;
  return {
    format: 'utm-portable', formatVersion: 1, kind: options.kind, schemaVersion: SCHEMA_VERSION,
    exportedAt: (options.now ?? new Date()).toISOString(),
    source: { appId: APP_ID, appName: APP_NAME, appVersion: APP_VERSION, workspaceId: safeWorkspace.workspaceId },
    customFields: clone(safeWorkspace.customFields), areaDefinitions: clone(safeWorkspace.areaDefinitions), projectDefinitions: clone(safeWorkspace.projectDefinitions), organizationPreferences: clone(safeWorkspace.organizationPreferences), items, views,
    ...(selection ? { selection: clone(selection) } : {}),
    dependencyItemIds: [...new Set(options.dependencyItemIds ?? [])].filter((id) => itemIds.has(id)),
  };
}

export function serializePortablePackage(value: PortablePackage): string {
  const validation = validatePortablePackage(value);
  if (!validation.valid) throw new Error(`Cannot export invalid portable package: ${validation.errors.join('; ')}`);
  return JSON.stringify(value, null, 2);
}

export interface ParsedPortablePackage { package: PortablePackage; resolvedWarnings: string[] }

export function parsePortablePackage(source: string): ParsedPortablePackage {
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch (error) { throw new Error(`File is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Portable package must be a JSON object');
  const raw = clone(parsed) as Partial<PortablePackage> & Record<string, unknown>;
  if (raw.format !== 'utm-portable' || raw.formatVersion !== 1) throw new Error('Expected a utm-portable formatVersion 1 package');
  if (!['items', 'views', 'view_bundle'].includes(String(raw.kind))) throw new Error(`Unsupported portable package kind: ${String(raw.kind)}`);
  if (!raw.source || typeof raw.source !== 'object') throw new Error('Portable package source metadata is required');
  const namespace = `import:${(raw.source as PortablePackage['source']).appId || 'unknown'}:${raw.schemaVersion || 'unknown'}`;
  const resolvedWarnings: string[] = [];
  const items = (Array.isArray(raw.items) ? raw.items : []).map((item) => {
    const migrated = migrateItem(item, namespace); resolvedWarnings.push(...migrated.warnings); return migrated.value;
  });
  const views = (Array.isArray(raw.views) ? raw.views : []).map((view) => {
    const migrated = migrateView(view, namespace); resolvedWarnings.push(...migrated.warnings); return migrated.value;
  });
  const projectDefinitions = Object.fromEntries(Object.entries((raw.projectDefinitions ?? {}) as Record<string, unknown>).map(([name, value]) => {
    const definition = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const areas = [...new Set([
      ...(Array.isArray(definition.areas) ? definition.areas.filter((area): area is string => typeof area === 'string') : []),
      ...(typeof definition.area === 'string' ? [definition.area] : []),
    ].map((area) => area.trim()).filter(Boolean))];
    return [name, { ...definition, name, areas } as unknown as ProjectDefinition];
  }));
  const rawPreferences = raw.organizationPreferences && typeof raw.organizationPreferences === 'object' ? raw.organizationPreferences as Partial<OrganizationPreferences> : {};
  const defaults = defaultOrganizationPreferences();
  const organizationPreferences: OrganizationPreferences = {
    areaOrder: Array.isArray(rawPreferences.areaOrder) ? rawPreferences.areaOrder : defaults.areaOrder,
    projectOrder: Array.isArray(rawPreferences.projectOrder) ? rawPreferences.projectOrder : defaults.projectOrder,
    tagOrder: Array.isArray(rawPreferences.tagOrder) ? rawPreferences.tagOrder : defaults.tagOrder,
    tagAccents: rawPreferences.tagAccents && typeof rawPreferences.tagAccents === 'object' ? clone(rawPreferences.tagAccents) : defaults.tagAccents ?? {},
    priorityOrder: Array.isArray(rawPreferences.priorityOrder) ? rawPreferences.priorityOrder : [
      ...(Array.isArray(rawPreferences.areaOrder) ? rawPreferences.areaOrder : defaults.areaOrder).map((name) => ({ kind: 'area' as const, name })),
      ...(Array.isArray(rawPreferences.projectOrder) ? rawPreferences.projectOrder : defaults.projectOrder).map((name) => ({ kind: 'project' as const, name })),
      ...(Array.isArray(rawPreferences.tagOrder) ? rawPreferences.tagOrder : defaults.tagOrder).map((name) => ({ kind: 'tag' as const, name })),
    ],
  };
  const portable: PortablePackage = {
    format: 'utm-portable', formatVersion: 1, kind: raw.kind as PortablePackage['kind'], schemaVersion: SCHEMA_VERSION,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : new Date().toISOString(),
    source: raw.source as PortablePackage['source'], customFields: clone((raw.customFields ?? {}) as Record<string, CustomFieldDefinition>),
    areaDefinitions: clone((raw.areaDefinitions ?? {}) as NonNullable<PortablePackage['areaDefinitions']>),
    projectDefinitions,
    organizationPreferences,
    items, views, ...(raw.selection ? { selection: clone(raw.selection as PortableSelection) } : {}),
    dependencyItemIds: Array.isArray(raw.dependencyItemIds) ? raw.dependencyItemIds.filter((id): id is string => typeof id === 'string') : [],
    ...(raw.extensions && typeof raw.extensions === 'object' ? { extensions: clone(raw.extensions as Record<string, unknown>) } : {}),
  };
  const validation = validatePortablePackage(portable);
  if (!validation.valid) throw new Error(`Invalid portable package: ${validation.errors.join('; ')}`);
  if (raw.schemaVersion !== SCHEMA_VERSION) resolvedWarnings.unshift(`Normalized package schema ${String(raw.schemaVersion)} to ${SCHEMA_VERSION}`);
  return { package: portable, resolvedWarnings };
}

export function collectItemDependencies(workspace: WorkspaceDocument, selected: UniversalItem[]): UniversalItem[] {
  const result = new Map(selected.map((item) => [item.id, item]));
  const queue = [...selected];
  while (queue.length) {
    const item = queue.shift()!;
    const ids = [item.occurrence?.seriesId, ...item.relations.map((relation) => relation.targetId)].filter((id): id is string => Boolean(id));
    for (const id of ids) {
      const dependency = workspace.items[id];
      if (!dependency || dependency.deletedAt || result.has(id)) continue;
      result.set(id, dependency); queue.push(dependency);
    }
  }
  return [...result.values()];
}

export type ImportEntityChoice = 'add' | 'skip' | 'copy';
export type CustomFieldChoice = 'add' | 'identical' | 'rename' | 'use_local' | 'unresolved';

export interface ImportItemPlan { source: UniversalItem; conflict: boolean; choice: ImportEntityChoice }
export interface ImportViewPlan { source: SavedView; conflict: boolean; choice: ImportEntityChoice }
export interface ImportCustomFieldPlan {
  source: CustomFieldDefinition; local?: CustomFieldDefinition; conflict: boolean; choice: CustomFieldChoice; renamedKey?: string;
}
export interface PortableImportPreview {
  package: PortablePackage;
  items: ImportItemPlan[];
  views: ImportViewPlan[];
  customFields: ImportCustomFieldPlan[];
  errors: string[];
  resolvedWarnings: string[];
}

function same(value: unknown, other: unknown): boolean { return JSON.stringify(value) === JSON.stringify(other); }

export function buildPortableImportPreview(source: string | PortablePackage, workspace: WorkspaceDocument): PortableImportPreview {
  const parsed = typeof source === 'string' ? parsePortablePackage(source) : { package: clone(source), resolvedWarnings: [] };
  const itemPlans = parsed.package.items.map((item) => ({
    source: item, conflict: Boolean(workspace.items[item.id] || workspace.tombstones[item.id]), choice: workspace.items[item.id] || workspace.tombstones[item.id] ? 'skip' as const : 'add' as const,
  }));
  const viewPlans = parsed.package.views.map((view) => ({
    source: view, conflict: Boolean(workspace.views[view.id]), choice: workspace.views[view.id] ? 'skip' as const : 'add' as const,
  }));
  const localFields = Object.values(workspace.customFields);
  const fieldPlans = Object.values(parsed.package.customFields).map((field) => {
    const local = workspace.customFields[field.id] ?? localFields.find((candidate) => candidate.key === field.key);
    if (!local) return { source: field, conflict: false, choice: 'add' as const };
    if (same(local, field)) return { source: field, local, conflict: false, choice: 'identical' as const };
    return { source: field, local, conflict: true, choice: 'unresolved' as const };
  });
  const errors: string[] = [];
  const itemIds = new Set(parsed.package.items.map((item) => item.id));
  for (const item of parsed.package.items) {
    if (item.occurrence && !itemIds.has(item.occurrence.seriesId) && !workspace.items[item.occurrence.seriesId]) errors.push(`${item.title}: missing series dependency ${item.occurrence.seriesId}`);
  }
  return { package: parsed.package, items: itemPlans, views: viewPlans, customFields: fieldPlans, errors, resolvedWarnings: parsed.resolvedWarnings };
}

function uniqueFieldKey(workspace: WorkspaceDocument, requested: string): string {
  const used = new Set(Object.values(workspace.customFields).map((field) => field.key));
  let candidate = `${requested}_imported`; let suffix = 2;
  while (used.has(candidate)) candidate = `${requested}_imported_${suffix++}`;
  return candidate;
}

function rewriteCustomPath(source: string, oldKey: string, newKey: string): string {
  const escapedKey = oldKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.replace(new RegExp(`\\bcustom\\.${escapedKey}\\b`, 'g'), `custom.${newKey}`);
}

export interface ApplyPortableImportResult { addedItems: number; copiedItems: number; addedViews: number; copiedViews: number; skipped: number }

export function applyPortableImport(workspace: WorkspaceDocument, preview: PortableImportPreview): ApplyPortableImportResult {
  if (preview.errors.length) throw new Error(`Import has blocking errors: ${preview.errors.join('; ')}`);
  const unresolved = preview.customFields.filter((field) => field.choice === 'unresolved');
  if (unresolved.length) throw new Error(`Resolve custom field conflicts: ${unresolved.map((field) => field.source.key).join(', ')}`);

  const localOrganization = {
    areaOrder: [...workspace.organizationPreferences.areaOrder],
    projectOrder: [...workspace.organizationPreferences.projectOrder],
    tagOrder: [...workspace.organizationPreferences.tagOrder],
    tagAccents: { ...(workspace.organizationPreferences.tagAccents ?? {}) },
  };
  for (const [name, definition] of Object.entries(preview.package.areaDefinitions ?? {})) workspace.areaDefinitions[name] ??= clone(definition);
  for (const [name, definition] of Object.entries(preview.package.projectDefinitions ?? {})) {
    const existing = workspace.projectDefinitions[name];
    workspace.projectDefinitions[name] = existing
      ? { ...existing, areas: [...new Set([...(existing.areas ?? []), ...(definition.areas ?? [])])] }
      : clone(definition);
    definition.areas.forEach((area) => ensureAreaDefinition(workspace, area, {}, new Date(definition.createdAt)));
  }
  const importedOrganization = preview.package.organizationPreferences ?? defaultOrganizationPreferences();
  const mergeOrder = (local: Array<string | null>, imported: Array<string | null>, names: string[]) => normalizedOrder(local.some((entry) => entry !== null) ? [...local, ...imported] : imported, names);
  workspace.organizationPreferences.areaOrder = mergeOrder(localOrganization.areaOrder, importedOrganization.areaOrder, Object.keys(workspace.areaDefinitions));
  workspace.organizationPreferences.projectOrder = mergeOrder(localOrganization.projectOrder, importedOrganization.projectOrder, Object.keys(workspace.projectDefinitions));
  workspace.organizationPreferences.tagOrder = mergeOrder(localOrganization.tagOrder, importedOrganization.tagOrder, [...new Set([...localOrganization.tagOrder, ...importedOrganization.tagOrder].filter((tag): tag is string => tag !== null))]);
  workspace.organizationPreferences.tagAccents = { ...(importedOrganization.tagAccents ?? {}), ...localOrganization.tagAccents };
  const priorityKey = (entry: OrganizationPreferences['priorityOrder'][number]) => JSON.stringify([entry.kind, entry.name, entry.kind === 'project' && entry.name !== null ? entry.area ?? null : undefined]);
  workspace.organizationPreferences.priorityOrder = [...workspace.organizationPreferences.priorityOrder, ...importedOrganization.priorityOrder]
    .filter((entry, index, entries) => entries.findIndex((candidate) => priorityKey(candidate) === priorityKey(entry)) === index);

  const keyMap = new Map<string, string>();
  for (const plan of preview.customFields) {
    if (plan.choice === 'identical' || plan.choice === 'use_local') continue;
    const definition = clone(plan.source);
    if (plan.choice === 'rename') {
      const key = plan.renamedKey?.trim() || uniqueFieldKey(workspace, definition.key);
      keyMap.set(definition.key, key); definition.key = key; definition.id = createId(); definition.label = `${definition.label} (imported)`;
    }
    workspace.customFields[definition.id] = definition;
  }

  const itemIdMap = new Map<string, string>();
  preview.items.forEach((plan) => { if (plan.choice === 'copy') itemIdMap.set(plan.source.id, createId()); });
  const viewIdMap = new Map<string, string>();
  preview.views.forEach((plan) => { if (plan.choice === 'copy') viewIdMap.set(plan.source.id, createId()); });
  let addedItems = 0; let copiedItems = 0; let addedViews = 0; let copiedViews = 0; let skipped = 0;

  for (const plan of preview.items) {
    if (plan.choice === 'skip') { skipped += 1; continue; }
    const item = clone(plan.source);
    for (const [oldKey, newKey] of keyMap) {
      if (Object.hasOwn(item.custom, oldKey)) { item.custom[newKey] = item.custom[oldKey]!; delete item.custom[oldKey]; }
    }
    item.relations = item.relations.map((relation) => ({ ...relation, targetId: itemIdMap.get(relation.targetId) ?? relation.targetId }));
    if (item.occurrence) item.occurrence.seriesId = itemIdMap.get(item.occurrence.seriesId) ?? item.occurrence.seriesId;
    if (plan.choice === 'copy') {
      const originalId = item.id; item.id = itemIdMap.get(originalId)!;
      item.extensions = { ...item.extensions, 'dev.universal-task-manager/import-copy': { originalId, importedAt: new Date().toISOString() } };
      copiedItems += 1;
    } else addedItems += 1;
    workspace.items[item.id] = item;
    item.areas.forEach((area) => ensureAreaDefinition(workspace, area));
    item.projects.forEach((project) => ensureProjectDefinition(workspace, project));
    item.tags.forEach((tag) => ensureTagDefinition(workspace, tag));
  }

  for (const plan of preview.views) {
    if (plan.choice === 'skip') { skipped += 1; continue; }
    const view = clone(plan.source);
    for (const [oldKey, newKey] of keyMap) {
      view.query.source = rewriteCustomPath(view.query.source, oldKey, newKey);
      if (view.sortSource) view.sortSource = rewriteCustomPath(view.sortSource, oldKey, newKey);
      view.sort = view.sort.map((sort) => ({ ...sort, field: rewriteCustomPath(sort.field, oldKey, newKey) }));
      view.fields = view.fields.map((field) => rewriteCustomPath(field, oldKey, newKey));
    }
    if (plan.choice === 'copy') { view.id = viewIdMap.get(view.id)!; view.name = `${view.name} Copy`; copiedViews += 1; }
    else addedViews += 1;
    workspace.views[view.id] = view;
  }
  workspace.organizationPreferences.priorityOrder = normalizedOrganizationPriorityOrder(workspace.organizationPreferences.priorityOrder, workspace);
  workspace.updatedAt = new Date().toISOString();
  return { addedItems, copiedItems, addedViews, copiedViews, skipped };
}
