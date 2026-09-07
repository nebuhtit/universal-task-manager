import { calculateViewTimeMetrics, compileQuery, effectiveItemDurationMs, itemProjects, participatesInTimeStatistics, type SavedView, type UniversalItem, type WorkspaceDocument } from '@utm/core';

export type ProjectViewResult = {
  kind: 'project'; id: string; name: string; areas: string[];
  items: UniversalItem[]; completionPercent: number | null; remainingDurationMs: number;
};
export type ViewResult = { kind: 'item'; id: string; item: UniversalItem } | ProjectViewResult;
export const projectResultId = (name: string) => `project:${encodeURIComponent(name)}`;

export function projectResults(workspace: WorkspaceDocument, view: SavedView, candidates: UniversalItem[], now: Date): ProjectViewResult[] {
  if (view.renderer === 'calendar' || !view.resultTypes?.includes('project')) return [];
  try {
    const predicate = compileQuery(view.projectQuery?.source || 'true');
    const byProject = new Map<string, UniversalItem[]>();
    for (const item of candidates) for (const name of itemProjects(item)) {
      const group = byProject.get(name);
      if (group) group.push(item); else byProject.set(name, [item]);
    }
    return Object.values(workspace.projectDefinitions).flatMap((project) => {
      // A read-only query projection, not a workspace item or an editable result.
      const projection = { title: project.name, project: [project.name], projects: [project.name], area: project.areas, areas: project.areas, tags: [], reminders: [] } as unknown as UniversalItem;
      if (!predicate(projection, now)) return [];
      const items = byProject.get(project.name) ?? [];
      if (!items.length) return [];
      const metrics = calculateViewTimeMetrics(workspace, { ...view, statistics: { showTime: true, reservedItemIds: [] } }, items, now);
      const hasDuration = items.some((item) => !item.deletedAt && !item.external?.readOnly && item.role !== 'series_template' && !['archived', 'cancelled'].includes(item.state) && participatesInTimeStatistics(item) && effectiveItemDurationMs(item) > 0);
      return [{ kind: 'project' as const, id: projectResultId(project.name), name: project.name, areas: project.areas, items, completionPercent: hasDuration ? metrics.completionPercent : null, remainingDurationMs: metrics.remainingDurationMs }];
    });
  } catch { return []; }
}
