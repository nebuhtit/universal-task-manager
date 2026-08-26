import type { AreaDefinition, ProjectDefinition, WorkspaceDocument } from './types.js';

export type OrganizationKind = 'area' | 'project';
export type OrganizationDefinition = AreaDefinition | ProjectDefinition;

const validDate = (value: string | undefined, fallback: string) => value && Number.isFinite(Date.parse(value)) ? value : fallback;
const namesFromItems = (workspace: WorkspaceDocument, kind: OrganizationKind) => Object.values(workspace.items)
  .map((item) => item[kind])
  .filter((name): name is string => Boolean(name?.trim()));

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
  return { name, priority: 0, order: Number.MAX_SAFE_INTEGER, createdAt, updatedAt: createdAt };
}

export function ensureAreaDefinition(
  workspace: WorkspaceDocument,
  rawName: string,
  patch: Partial<Pick<AreaDefinition, 'priority' | 'order'>> = {},
  now = new Date(),
): AreaDefinition | undefined {
  const name = rawName.trim();
  if (!name) return undefined;
  workspace.areaDefinitions ??= {};
  const timestamp = now.toISOString();
  const current = workspace.areaDefinitions[name];
  const nextOrder = Object.values(workspace.areaDefinitions).reduce((maximum, definition) => Math.max(maximum, definition.order), -1) + 1;
  const definition: AreaDefinition = {
    name,
    priority: patch.priority ?? current?.priority ?? 0,
    order: patch.order ?? current?.order ?? nextOrder,
    createdAt: validDate(current?.createdAt, timestamp),
    updatedAt: timestamp,
  };
  workspace.areaDefinitions[name] = definition;
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
  const nextOrder = Object.values(workspace.projectDefinitions).reduce((maximum, definition) => Math.max(maximum, definition.order), -1) + 1;
  const area = patch.area === undefined ? current?.area : patch.area.trim() || undefined;
  const definition: ProjectDefinition = {
    name,
    priority: patch.priority ?? current?.priority ?? 0,
    order: patch.order ?? current?.order ?? nextOrder,
    createdAt: validDate(current?.createdAt, timestamp),
    updatedAt: timestamp,
    ...(area ? { area } : {}),
  };
  workspace.projectDefinitions[name] = definition;
  if (area) ensureAreaDefinition(workspace, area, {}, now);
  return definition;
}

export function orderedOrganizationNames(workspace: WorkspaceDocument, kind: OrganizationKind, area?: string): string[] {
  const definitions = kind === 'area' ? workspace.areaDefinitions : workspace.projectDefinitions;
  const names = new Set([...Object.keys(definitions ?? {}), ...namesFromItems(workspace, kind)]);
  return [...names]
    .filter((name) => kind === 'area' || !area || workspace.projectDefinitions[name]?.area === area || Object.values(workspace.items).some((item) => item.project === name && item.area === area))
    .sort((left, right) => {
      const leftDefinition = organizationDefinitionFor(workspace, kind, left)!;
      const rightDefinition = organizationDefinitionFor(workspace, kind, right)!;
      return rightDefinition.priority - leftDefinition.priority
        || leftDefinition.order - rightDefinition.order
        || Date.parse(rightDefinition.createdAt) - Date.parse(leftDefinition.createdAt)
        || left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
    });
}

export function reorderOrganization(workspace: WorkspaceDocument, kind: OrganizationKind, orderedNames: string[], now = new Date()): void {
  orderedNames.forEach((name, order) => {
    if (kind === 'area') ensureAreaDefinition(workspace, name, { order }, now);
    else ensureProjectDefinition(workspace, name, { order }, now);
  });
}
