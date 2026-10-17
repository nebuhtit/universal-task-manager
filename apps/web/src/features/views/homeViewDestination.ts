import type { SavedView, WorkspaceDocument } from '@utm/core';

/** Editing modernizes legacy scope fields, so pinned PARA identity can live in extensions. */
export function homeViewDestination(view: SavedView, workspace: Pick<WorkspaceDocument, 'projectDefinitions' | 'areaDefinitions'>): { kind: 'project' | 'area'; name: string } | undefined {
  const pinned = view.extensions?.['utm:para-view'] === true;
  let scope: Record<string, unknown> = {};
  if (pinned && typeof view.extensions?.['utm:para-scope'] === 'string') {
    try {
      const parsed: unknown = JSON.parse(view.extensions['utm:para-scope']);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) scope = parsed as Record<string, unknown>;
    } catch { /* Invalid stored scope must not prevent opening the ordinary view. */ }
  }
  const project = [view.project, ...(pinned ? [scope.project, view.creationDefaults?.project] : [])]
    .find((name): name is string => typeof name === 'string' && Object.hasOwn(workspace.projectDefinitions, name));
  if (project) return { kind: 'project', name: project };
  const area = [view.area, ...(pinned ? [scope.area, view.creationDefaults?.area] : [])]
    .find((name): name is string => typeof name === 'string' && Object.hasOwn(workspace.areaDefinitions, name));
  return area ? { kind: 'area', name: area } : undefined;
}
