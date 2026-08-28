import type { AreaDefinition, OrganizationPreferences, OrganizationPriorityEntry, ProjectDefinition, UniversalItem, WorkspaceDocument } from './types.js';

export type OrganizationKind = 'area' | 'project';
export type OrganizationDefinition = AreaDefinition | ProjectDefinition;

const validDate = (value: string | undefined, fallback: string) => value && Number.isFinite(Date.parse(value)) ? value : fallback;
const uniqueNames = (values: Array<string | undefined>) => [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
const itemAreas = (item: Pick<UniversalItem, 'areas' | 'area'>) => uniqueNames([...(item.areas ?? []), item.area]);
const itemProjects = (item: Pick<UniversalItem, 'projects' | 'project'>) => uniqueNames([...(item.projects ?? []), item.project]);
const namesFromItems = (workspace: WorkspaceDocument, kind: OrganizationKind) => Object.values(workspace.items)
  .flatMap((item) => kind === 'area' ? itemAreas(item) : itemProjects(item));

export const defaultOrganizationPreferences = (): OrganizationPreferences => ({
  areaOrder: [null], projectOrder: [null], tagOrder: [null],
  priorityOrder: [{ kind: 'area', name: null }, { kind: 'project', name: null }, { kind: 'tag', name: null }],
});

export function organizationPreferencesFor(workspace: Pick<WorkspaceDocument, 'organizationPreferences'>): OrganizationPreferences {
  return workspace.organizationPreferences ?? defaultOrganizationPreferences();
}

export function organizationDefinitionFor(
  workspace: WorkspaceDocument,
  kind: 'area',
  rawName: string | undefined,
  now?: Date,
): AreaDefinition | undefined;
export function organizationDefinitionFor(
  workspace: WorkspaceDocument,
  kind: 'project',
  rawName: string | undefined,
  now?: Date,
): ProjectDefinition | undefined;
export function organizationDefinitionFor(
  workspace: WorkspaceDocument,
  kind: OrganizationKind,
  rawName: string | undefined,
  now?: Date,
): OrganizationDefinition | undefined;
export function organizationDefinitionFor(
  workspace: WorkspaceDocument,
  kind: OrganizationKind,
  rawName: string | undefined,
  now = new Date(),
): OrganizationDefinition | undefined {
  const name = rawName?.trim();
  if (!name) return undefined;
  const definitions = kind === 'area' ? workspace.areaDefinitions : workspace.projectDefinitions;
  const explicit = definitions?.[name];
  if (explicit) return explicit;
  const createdAt = Object.values(workspace.items)
    .filter((item) => (kind === 'area' ? itemAreas(item) : itemProjects(item)).includes(name))
    .map((item) => item.createdAt)
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort()[0] ?? now.toISOString();
  if (kind === 'project') {
    const areas = uniqueNames(Object.values(workspace.items).filter((item) => itemProjects(item).includes(name)).flatMap(itemAreas));
    return { name, areas, createdAt, updatedAt: createdAt };
  }
  return { name, createdAt, updatedAt: createdAt };
}

export function ensureAreaDefinition(
  workspace: WorkspaceDocument,
  rawName: string,
  _patch: Partial<Pick<AreaDefinition, 'priority' | 'order'>> = {},
  now = new Date(),
): AreaDefinition | undefined {
  const name = rawName.trim();
  if (!name) return undefined;
  workspace.areaDefinitions ??= {};
  const timestamp = now.toISOString();
  const current = workspace.areaDefinitions[name];
  const definition: AreaDefinition = {
    name,
    createdAt: validDate(current?.createdAt, timestamp),
    updatedAt: timestamp,
  };
  workspace.areaDefinitions[name] = definition;
  const preferences = workspace.organizationPreferences ??= defaultOrganizationPreferences();
  preferences.areaOrder = normalizedOrder(preferences.areaOrder, Object.keys(workspace.areaDefinitions));
  preferences.priorityOrder = normalizedOrganizationPriorityOrder(preferences.priorityOrder, workspace);
  return definition;
}

export function ensureProjectDefinition(
  workspace: WorkspaceDocument,
  rawName: string,
  patch: Partial<Pick<ProjectDefinition, 'areas' | 'area' | 'priority' | 'order'>> = {},
  now = new Date(),
): ProjectDefinition | undefined {
  const name = rawName.trim();
  if (!name) return undefined;
  workspace.projectDefinitions ??= {};
  const timestamp = now.toISOString();
  const current = workspace.projectDefinitions[name];
  const areas = uniqueNames(patch.areas ?? (patch.area !== undefined ? [patch.area] : current?.areas ?? (current?.area ? [current.area] : [])));
  const definition: ProjectDefinition = {
    name,
    createdAt: validDate(current?.createdAt, timestamp),
    updatedAt: timestamp,
    areas,
  };
  workspace.projectDefinitions[name] = definition;
  const preferences = workspace.organizationPreferences ??= defaultOrganizationPreferences();
  preferences.projectOrder = normalizedOrder(preferences.projectOrder, Object.keys(workspace.projectDefinitions));
  areas.forEach((area) => ensureAreaDefinition(workspace, area, {}, now));
  preferences.priorityOrder = normalizedOrganizationPriorityOrder(preferences.priorityOrder, workspace);
  return definition;
}

export function ensureTagDefinition(workspace: WorkspaceDocument, rawTag: string): string | undefined {
  const tag = rawTag.trim().replace(/^#+/, '');
  if (!tag) return undefined;
  const preferences = workspace.organizationPreferences ??= defaultOrganizationPreferences();
  preferences.tagOrder = normalizedOrder(preferences.tagOrder, [...preferences.tagOrder.filter((entry): entry is string => entry !== null), tag]);
  preferences.priorityOrder = normalizedOrganizationPriorityOrder(preferences.priorityOrder, workspace);
  return tag;
}

const replaceName = (values: string[] | undefined, from: string, to: string) => uniqueNames((values ?? []).map((value) => value === from ? to : value));
const renameDefault = (defaults: Record<string, unknown> | undefined, singular: 'area' | 'project', plural: 'areas' | 'projects', from: string, to: string) => {
  if (!defaults) return;
  if (defaults[singular] === from) defaults[singular] = to;
  if (Array.isArray(defaults[plural])) defaults[plural] = replaceName(defaults[plural] as string[], from, to);
};
const replaceQuotedName = (source: string | undefined, from: string, to: string) => {
  if (!source) return source;
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.replace(new RegExp(`(["'])${escaped}\\1`, 'g'), (match, quote: string) => `${quote}${to}${quote}`);
};

/** Rename an Area and every structured reference to it. Returns false on invalid or conflicting names. */
export function renameAreaDefinition(workspace: WorkspaceDocument, rawFrom: string, rawTo: string, now = new Date()): boolean {
  const from = rawFrom.trim(); const to = rawTo.trim();
  if (!from || !to || from === to || !workspace.areaDefinitions[from] || workspace.areaDefinitions[to]) return false;
  const timestamp = now.toISOString();
  const current = workspace.areaDefinitions[from]!;
  const createdAt = String(current.createdAt);
  delete workspace.areaDefinitions[from];
  workspace.areaDefinitions[to] = { name: to, createdAt, updatedAt: timestamp };
  Object.values(workspace.projectDefinitions).forEach((project) => {
    project.areas = replaceName(project.areas ?? (project.area ? [project.area] : []), from, to);
    if (project.area === from) project.area = to;
    project.updatedAt = timestamp;
  });
  Object.values(workspace.items).forEach((item) => {
    item.areas = replaceName(item.areas, from, to);
    if (item.area === from) item.area = to;
  });
  Object.values(workspace.views).forEach((view) => {
    if (view.area === from) view.area = to;
    renameDefault(view.creationDefaults, 'area', 'areas', from, to);
    view.query.source = replaceQuotedName(view.query.source, from, to) ?? '';
    if (view.sortSource !== undefined) view.sortSource = replaceQuotedName(view.sortSource, from, to) ?? '';
  });
  const preferences = workspace.organizationPreferences ??= defaultOrganizationPreferences();
  preferences.areaOrder = preferences.areaOrder.map((name) => name === from ? to : name);
  preferences.priorityOrder = preferences.priorityOrder.map((entry) => ({
    ...entry,
    name: entry.kind === 'area' && entry.name === from ? to : entry.name,
    ...(entry.kind === 'project' && entry.name !== null && (entry.area ?? null) === from ? { area: to } : {}),
  }));
  preferences.priorityOrder = normalizedOrganizationPriorityOrder(preferences.priorityOrder, workspace);
  workspace.updatedAt = timestamp;
  return true;
}

/** Rename a Project and every structured reference to it. Returns false on invalid or conflicting names. */
export function renameProjectDefinition(workspace: WorkspaceDocument, rawFrom: string, rawTo: string, now = new Date()): boolean {
  const from = rawFrom.trim(); const to = rawTo.trim();
  if (!from || !to || from === to || !workspace.projectDefinitions[from] || workspace.projectDefinitions[to]) return false;
  const timestamp = now.toISOString();
  const current = workspace.projectDefinitions[from]!;
  const createdAt = String(current.createdAt);
  const areas = [...(current.areas ?? (current.area ? [current.area] : []))].map(String);
  delete workspace.projectDefinitions[from];
  workspace.projectDefinitions[to] = { name: to, areas, createdAt, updatedAt: timestamp };
  Object.values(workspace.items).forEach((item) => {
    item.projects = replaceName(item.projects, from, to);
    if (item.project === from) item.project = to;
  });
  Object.values(workspace.views).forEach((view) => {
    if (view.project === from) view.project = to;
    renameDefault(view.creationDefaults, 'project', 'projects', from, to);
    view.query.source = replaceQuotedName(view.query.source, from, to) ?? '';
    if (view.sortSource !== undefined) view.sortSource = replaceQuotedName(view.sortSource, from, to) ?? '';
  });
  const preferences = workspace.organizationPreferences ??= defaultOrganizationPreferences();
  preferences.projectOrder.forEach((name, index) => { if (name === from) preferences.projectOrder[index] = to; });
  preferences.priorityOrder.forEach((entry) => { if (entry.kind === 'project' && entry.name === from) entry.name = to; });
  workspace.updatedAt = timestamp;
  return true;
}

/** Rename a Tag and every structured reference to it. Returns false on invalid or conflicting names. */
export function renameTagDefinition(workspace: WorkspaceDocument, rawFrom: string, rawTo: string, now = new Date()): boolean {
  const from = rawFrom.trim().replace(/^#+/, ''); const to = rawTo.trim().replace(/^#+/, '');
  if (!from || !to || from === to) return false;
  const preferences = workspace.organizationPreferences ??= defaultOrganizationPreferences();
  const knownTags = new Set(orderedTagEntries(workspace).filter((tag): tag is string => tag !== null));
  if (!knownTags.has(from) || knownTags.has(to)) return false;
  Object.values(workspace.items).forEach((item) => { item.tags = replaceName(item.tags, from, to); });
  Object.values(workspace.views).forEach((view) => {
    if (Array.isArray(view.creationDefaults?.tags)) view.creationDefaults.tags = replaceName(view.creationDefaults.tags as string[], from, to);
    view.query.source = replaceQuotedName(view.query.source, from, to) ?? '';
    if (view.sortSource !== undefined) view.sortSource = replaceQuotedName(view.sortSource, from, to) ?? '';
  });
  preferences.tagOrder.forEach((tag, index) => { if (tag === from) preferences.tagOrder[index] = to; });
  preferences.priorityOrder.forEach((entry) => { if (entry.kind === 'tag' && entry.name === from) entry.name = to; });
  workspace.updatedAt = now.toISOString();
  return true;
}

export function orderedOrganizationNames(workspace: WorkspaceDocument, kind: OrganizationKind, area?: string): string[] {
  const definitions = kind === 'area' ? workspace.areaDefinitions : workspace.projectDefinitions;
  const names = new Set([...Object.keys(definitions ?? {}), ...namesFromItems(workspace, kind)]);
  const eligible = [...names]
    .filter((name) => kind === 'area' || !area || workspace.projectDefinitions[name]?.areas?.includes(area) || workspace.projectDefinitions[name]?.area === area || Object.values(workspace.items).some((item) => itemProjects(item).includes(name) && itemAreas(item).includes(area)))
  return orderedOrganizationEntries(workspace, kind).filter((name): name is string => name !== null && eligible.includes(name));
}

export function normalizedOrder(order: Array<string | null> | undefined, names: string[]): Array<string | null> {
  const known = new Set(names.map((name) => name.trim()).filter(Boolean));
  const result: Array<string | null> = [];
  for (const value of order ?? []) {
    if (value === null) { if (!result.includes(null)) result.push(null); continue; }
    if (known.has(value) && !result.includes(value)) result.push(value);
  }
  for (const name of known) if (!result.includes(name)) result.push(name);
  if (!result.includes(null)) result.push(null);
  return result;
}

export function orderedOrganizationEntries(workspace: WorkspaceDocument, kind: OrganizationKind): Array<string | null> {
  const definitions = kind === 'area' ? workspace.areaDefinitions : workspace.projectDefinitions;
  const names = [...new Set([...Object.keys(definitions ?? {}), ...namesFromItems(workspace, kind)])];
  const preferences = organizationPreferencesFor(workspace);
  return normalizedOrder(kind === 'area' ? preferences.areaOrder : preferences.projectOrder, names);
}

export function orderedTagEntries(workspace: WorkspaceDocument): Array<string | null> {
  const preferences = organizationPreferencesFor(workspace);
  const names = [...new Set([
    ...preferences.tagOrder.filter((tag): tag is string => tag !== null),
    ...Object.values(workspace.items).flatMap((item) => item.tags).map((tag) => tag.trim()).filter(Boolean),
  ])];
  return normalizedOrder(preferences.tagOrder, names);
}

export function reorderOrganization(workspace: WorkspaceDocument, kind: OrganizationKind, orderedNames: Array<string | null>): void {
  const preferences = workspace.organizationPreferences ??= defaultOrganizationPreferences();
  const names = kind === 'area' ? Object.keys(workspace.areaDefinitions) : Object.keys(workspace.projectDefinitions);
  const normalized = normalizedOrder(orderedNames, [...new Set([...names, ...namesFromItems(workspace, kind)])]);
  if (kind === 'area') preferences.areaOrder = normalized;
  else preferences.projectOrder = normalized;
}

export function reorderTags(workspace: WorkspaceDocument, orderedTags: Array<string | null>): void {
  const preferences = workspace.organizationPreferences ??= defaultOrganizationPreferences();
  const names = [...new Set([...preferences.tagOrder.filter((tag): tag is string => tag !== null), ...Object.values(workspace.items).flatMap((item) => item.tags)])];
  preferences.tagOrder = normalizedOrder(orderedTags, names);
}

const projectScopes = (workspace: WorkspaceDocument, project: string): Array<string | null> => {
  const areas = uniqueNames(workspace.projectDefinitions[project]?.areas ?? []);
  return areas.length ? areas : [null];
};

const priorityKey = (entry: OrganizationPriorityEntry) => JSON.stringify([
  entry.kind,
  entry.name,
  entry.kind === 'project' && entry.name !== null ? entry.area ?? null : undefined,
]);

export function normalizedOrganizationPriorityOrder(
  order: OrganizationPriorityEntry[] | undefined,
  workspace: WorkspaceDocument,
): OrganizationPriorityEntry[] {
  const areas = orderedOrganizationEntries(workspace, 'area');
  const projects = orderedOrganizationEntries(workspace, 'project').filter((name): name is string => name !== null);
  const expected: OrganizationPriorityEntry[] = areas.flatMap((area) => [
    { kind: 'area' as const, name: area },
    ...projects.filter((project) => projectScopes(workspace, project).includes(area)).map((name) => ({ kind: 'project' as const, name, area })),
  ]);
  expected.push({ kind: 'project', name: null }, ...orderedTagEntries(workspace).map((name) => ({ kind: 'tag' as const, name })));
  const known = new Map(expected.map((entry) => [priorityKey(entry), entry]));
  const result: OrganizationPriorityEntry[] = [];
  for (const entry of order ?? []) {
    if (!entry || !['area', 'project', 'tag'].includes(entry.kind) || (entry.name !== null && typeof entry.name !== 'string')) continue;
    const name = entry.name?.trim() || null;
    const candidates = entry.kind === 'project' && name !== null && !Object.prototype.hasOwnProperty.call(entry, 'area')
      ? expected.filter((candidate) => candidate.kind === 'project' && candidate.name === name)
      : [known.get(priorityKey({ kind: entry.kind, name, ...(entry.kind === 'project' && name !== null ? { area: typeof entry.area === 'string' ? entry.area.trim() || null : null } : {}) }))];
    candidates.forEach((normalized) => {
      if (normalized && !result.some((candidate) => priorityKey(candidate) === priorityKey(normalized))) result.push(normalized);
    });
  }
  expected.forEach((entry) => {
    if (result.some((candidate) => priorityKey(candidate) === priorityKey(entry))) return;
    if (entry.kind === 'project' && entry.name !== null) {
      const sameArea = result.map((candidate, index) => ({ candidate, index })).filter(({ candidate }) => candidate.kind === 'project' && candidate.name !== null && (candidate.area ?? null) === (entry.area ?? null));
      const areaIndex = result.findIndex((candidate) => candidate.kind === 'area' && candidate.name === (entry.area ?? null));
      result.splice((sameArea.at(-1)?.index ?? areaIndex) + 1, 0, entry);
      return;
    }
    if (entry.kind === 'area') {
      const fallbackIndex = result.findIndex((candidate) => candidate.kind === 'project' && candidate.name === null || candidate.kind === 'tag');
      result.splice(fallbackIndex < 0 ? result.length : fallbackIndex, 0, entry);
      return;
    }
    result.push(entry);
  });
  return result;
}

export function orderedOrganizationPriorityEntries(workspace: WorkspaceDocument): OrganizationPriorityEntry[] {
  return normalizedOrganizationPriorityOrder(workspace.organizationPreferences?.priorityOrder, workspace);
}

export function reorderOrganizationPriority(workspace: WorkspaceDocument, order: OrganizationPriorityEntry[]): void {
  const preferences = workspace.organizationPreferences ??= defaultOrganizationPreferences();
  preferences.priorityOrder = normalizedOrganizationPriorityOrder(order, workspace);
  const priorityTags = preferences.priorityOrder
    .filter((entry): entry is OrganizationPriorityEntry & { kind: 'tag' } => entry.kind === 'tag')
    .map((entry) => entry.name);
  preferences.tagOrder = normalizedOrder(priorityTags, priorityTags.filter((tag): tag is string => tag !== null));
}

/** Reorder Area cards, including No Area, without moving Project or Tag slots. */
export function reorderAreaSubset(workspace: WorkspaceDocument, orderedAreas: Array<string | null>): void {
  const currentAreas = orderedOrganizationEntries(workspace, 'area');
  const normalized = normalizedOrder(orderedAreas, currentAreas.filter((name): name is string => name !== null));
  const preferences = workspace.organizationPreferences ??= defaultOrganizationPreferences();
  preferences.areaOrder = normalized;

  const current = orderedOrganizationPriorityEntries(workspace);
  const groupSlots = current.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.kind === 'area' || entry.kind === 'project' && entry.name !== null);
  const grouped = normalized.flatMap((area) => current.filter((entry) => entry.kind === 'area' && entry.name === area || entry.kind === 'project' && entry.name !== null && (entry.area ?? null) === area));
  let priorityIndex = 0;
  const priorityOrder = current.map((entry, index) => groupSlots.some((slot) => slot.index === index) ? grouped[priorityIndex++] ?? entry : entry);
  preferences.priorityOrder = normalizedOrganizationPriorityOrder(priorityOrder, workspace);
}

/** Reorder only the supplied Projects while preserving every unrelated priority slot. */
export function reorderProjectSubset(workspace: WorkspaceDocument, orderedProjects: string[], area: string | null = null): void {
  const currentProjects = orderedOrganizationEntries(workspace, 'project');
  const knownProjects = new Set(currentProjects.filter((name): name is string => name !== null));
  const requested = uniqueNames(orderedProjects).filter((name) => knownProjects.has(name));
  const requestedSet = new Set(requested);
  const originalSubset = currentProjects.filter((name): name is string => name !== null && requestedSet.has(name));
  const completeOrder = [...requested, ...originalSubset.filter((name) => !requestedSet.has(name))];
  if (completeOrder.length < 2 || completeOrder.length !== originalSubset.length) return;

  const preferences = workspace.organizationPreferences ??= defaultOrganizationPreferences();
  let legacyIndex = 0;
  preferences.projectOrder = currentProjects.map((name) => (
    name !== null && requestedSet.has(name) ? completeOrder[legacyIndex++] ?? name : name
  ));

  const scopedSet = new Set(completeOrder);
  let priorityIndex = 0;
  const priorityOrder = orderedOrganizationPriorityEntries(workspace).map((entry) => (
    entry.kind === 'project' && entry.name !== null && (entry.area ?? null) === area && scopedSet.has(entry.name)
      ? { ...entry, name: completeOrder[priorityIndex++] ?? entry.name, area }
      : entry
  ));
  preferences.priorityOrder = normalizedOrganizationPriorityOrder(priorityOrder, workspace);
}

/** Reorder Tags, including No Tags, in both the catalog and their existing Unified priority slots. */
export function reorderTagSubset(workspace: WorkspaceDocument, orderedTags: Array<string | null>): void {
  const currentTags = orderedTagEntries(workspace);
  const knownTags = currentTags.filter((tag): tag is string => tag !== null);
  const requested = normalizedOrder(orderedTags, knownTags);

  const preferences = workspace.organizationPreferences ??= defaultOrganizationPreferences();
  preferences.tagOrder = requested;

  let priorityIndex = 0;
  const priorityOrder = orderedOrganizationPriorityEntries(workspace).map((entry) => {
    if (entry.kind !== 'tag') return { ...entry };
    const nextName = requested[priorityIndex++];
    return { ...entry, name: nextName === undefined ? entry.name : nextName };
  });
  preferences.priorityOrder = normalizedOrganizationPriorityOrder(priorityOrder, workspace);
}

export function organizationPriorityRank(workspace: WorkspaceDocument, item: UniversalItem): number {
  const areas = itemAreas(item); const projects = itemProjects(item); const tags = uniqueNames(item.tags);
  const order = orderedOrganizationPriorityEntries(workspace);
  const projectBelongsTo = (area: string | null) => projects.some((project) => projectScopes(workspace, project).includes(area));
  const matches = (entry: OrganizationPriorityEntry) => entry.kind === 'area'
    ? (entry.name === null ? areas.length === 0 : areas.includes(entry.name)) && !projectBelongsTo(entry.name)
    : entry.kind === 'project'
      ? entry.name === null ? projects.length === 0 : projects.includes(entry.name)
      : entry.name === null ? tags.length === 0 : tags.includes(entry.name);
  const index = order.findIndex(matches);
  return index < 0 ? 0 : order.length - index;
}

export { itemAreas, itemProjects };
