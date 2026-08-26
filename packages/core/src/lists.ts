import type { ListDefinition, ListKind, WorkspaceDocument } from './types.js';

export const listKinds: ListKind[] = ['list', 'project', 'area', 'resource', 'archive'];

const validDate = (value: string | undefined, fallback: string) => value && Number.isFinite(Date.parse(value)) ? value : fallback;

/** Returns explicit metadata or a stable legacy fallback derived from the list's items. */
export function listDefinitionFor(workspace: WorkspaceDocument, rawName: string | undefined, now = new Date()): ListDefinition | undefined {
  const name = rawName?.trim();
  if (!name) return undefined;
  const explicit = workspace.listDefinitions?.[name];
  if (explicit) return explicit;
  const timestamps = Object.values(workspace.items)
    .filter((item) => item.list === name)
    .map((item) => item.createdAt)
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort();
  const createdAt = timestamps[0] ?? now.toISOString();
  return { name, kind: 'list', priority: 0, createdAt, updatedAt: createdAt };
}

/** Creates or updates shared list metadata without changing item membership. */
export function ensureListDefinition(
  workspace: WorkspaceDocument,
  rawName: string,
  patch: Partial<Pick<ListDefinition, 'kind' | 'priority'>> = {},
  now = new Date(),
): ListDefinition | undefined {
  const name = rawName.trim();
  if (!name) return undefined;
  workspace.listDefinitions ??= {};
  const timestamp = now.toISOString();
  const current = workspace.listDefinitions[name];
  const next: ListDefinition = {
    name,
    kind: patch.kind ?? current?.kind ?? 'list',
    priority: patch.priority ?? current?.priority ?? 0,
    createdAt: validDate(current?.createdAt, timestamp),
    updatedAt: timestamp,
  };
  workspace.listDefinitions[name] = next;
  return next;
}

/** Lists are presented by organization order: priority, recency, then name. */
export function orderedListNames(workspace: WorkspaceDocument): string[] {
  const names = new Set([
    ...Object.keys(workspace.listDefinitions ?? {}),
    ...Object.values(workspace.items).map((item) => item.list).filter((name): name is string => Boolean(name?.trim())),
  ]);
  return [...names].sort((left, right) => {
    const leftDefinition = listDefinitionFor(workspace, left)!;
    const rightDefinition = listDefinitionFor(workspace, right)!;
    return rightDefinition.priority - leftDefinition.priority
      || Date.parse(rightDefinition.createdAt) - Date.parse(leftDefinition.createdAt)
      || left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
  });
}
