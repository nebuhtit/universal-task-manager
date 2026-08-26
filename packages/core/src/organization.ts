import type { AreaDefinition, OrganizationPreferences, ProjectDefinition, WorkspaceDocument } from './types.js';

export type OrganizationKind = 'area' | 'project';
export type OrganizationDefinition = AreaDefinition | ProjectDefinition;

const validDate = (value: string | undefined, fallback: string) => value && Number.isFinite(Date.parse(value)) ? value : fallback;
const namesFromItems = (workspace: WorkspaceDocument, kind: OrganizationKind) => Object.values(workspace.items)
  .map((item) => item[kind])
  .filter((name): name is string => Boolean(name?.trim()));

export const defaultOrganizationPreferences = (): OrganizationPreferences => ({ areaOrder: [null], projectOrder: [null], tagOrder: [null] });

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
    .filter((item) => item[kind] === name)
    .map((item) => item.createdAt)
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort()[0] ?? now.toISOString();
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
  return definition;
}

export function ensureProjectDefinition(
  workspace: WorkspaceDocument,
  rawName: string,
  patch: Partial<Pick<ProjectDefinition, 'area' | 'priority' | 'order'>> = {},
  now = new Date(),
): ProjectDefinition | undefined {
  const name = rawName.trim();
  if (!name) return undefined;
  workspace.projectDefinitions ??= {};
  const timestamp = now.toISOString();
  const current = workspace.projectDefinitions[name];
  const area = patch.area === undefined ? current?.area : patch.area.trim() || undefined;
  const definition: ProjectDefinition = {
    name,
    createdAt: validDate(current?.createdAt, timestamp),
    updatedAt: timestamp,
    ...(area ? { area } : {}),
  };
  workspace.projectDefinitions[name] = definition;
  const preferences = workspace.organizationPreferences ??= defaultOrganizationPreferences();
  preferences.projectOrder = normalizedOrder(preferences.projectOrder, Object.keys(workspace.projectDefinitions));
  if (area) ensureAreaDefinition(workspace, area, {}, now);
  return definition;
}

export function orderedOrganizationNames(workspace: WorkspaceDocument, kind: OrganizationKind, area?: string): string[] {
  const definitions = kind === 'area' ? workspace.areaDefinitions : workspace.projectDefinitions;
  const names = new Set([...Object.keys(definitions ?? {}), ...namesFromItems(workspace, kind)]);
  const eligible = [...names]
    .filter((name) => kind === 'area' || !area || workspace.projectDefinitions[name]?.area === area || Object.values(workspace.items).some((item) => item.project === name && item.area === area))
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
