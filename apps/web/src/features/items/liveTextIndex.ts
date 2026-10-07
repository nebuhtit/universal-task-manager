import { orderedOrganizationNames, orderedTagEntries, withinTargets, withinPlacementWorkspace, type UniversalItem, type WorkspaceDocument } from '@utm/core';

// Separate from the evaluation index: opening a text field must not calculate
// reminders, formulas or recurrence merely to offer organization names.
const indexes = new WeakMap<WorkspaceDocument, ReturnType<typeof buildIndex>>();
function buildIndex(workspace: WorkspaceDocument) {
  const items = Object.values(workspace.items);
  const byTarget = new Map<string, UniversalItem[]>();
  const occurrences = new Map<string, UniversalItem[]>();
  const projectAreas = new Map<string, Set<string>>();
  for (const name of orderedOrganizationNames(workspace, 'project')) {
    const definition = workspace.projectDefinitions[name];
    projectAreas.set(name, new Set([...(definition?.areas ?? []), ...(definition?.area ? [definition.area] : [])]));
  }
  for (const item of items) {
    for (const target of withinTargets(item)) { const group = byTarget.get(target) ?? []; group.push(item); byTarget.set(target, group); }
    if (item.occurrence) { const group = occurrences.get(item.occurrence.seriesId) ?? []; group.push(item); occurrences.set(item.occurrence.seriesId, group); }
    if (item.deletedAt) continue;
    for (const name of new Set([...(item.projects ?? []), ...(item.project ? [item.project] : [])])) {
      const group = projectAreas.get(name);
      if (group) for (const area of [...(item.areas ?? []), ...(item.area ? [item.area] : [])]) group.add(area);
    }
  }
  return {
    candidates: items.filter(i => !i.deletedAt && i.state !== 'archived' && i.state !== 'cancelled'), byTarget, occurrences,
    catalog: { area: orderedOrganizationNames(workspace, 'area'), project: [...projectAreas.keys()], tag: orderedTagEntries(workspace).filter((tag): tag is string => tag !== null), projectAreas: Object.fromEntries([...projectAreas].map(([name, areas]) => [name, [...areas]])) },
  };
}
export function liveTextIndex(workspace: WorkspaceDocument) {
  let index = indexes.get(workspace);
  if (!index) { index = buildIndex(workspace); indexes.set(workspace, index); }
  return index;
}

/** Include the whole connected competition group, not just the selected task:
 * A in Work+Cleaning can shift B in Cleaning even if the draft only uses Work.
 * Preserve workspace ordering for tie-breaking and leave all definitions intact.
 */
export function withinPreviewWorkspace(workspace: WorkspaceDocument, draft: UniversalItem, now: Date) {
  const index = liveTextIndex(workspace);
  const selected = new Set<string>([draft.id]);
  const targets = new Set<string>();
  const queue = [...withinTargets(draft)];
  for (let i = 0; i < queue.length; i++) {
    const target = queue[i]!;
    if (targets.has(target)) continue;
    targets.add(target); selected.add(target);
    const block = workspace.items[target];
    if (block) queue.push(...withinTargets(block));
    for (const item of index.occurrences.get(target) ?? []) selected.add(item.id);
    for (const item of index.byTarget.get(target) ?? []) {
      if (item.id === draft.id || item.deletedAt || item.state === 'archived' || item.state === 'cancelled') continue;
      selected.add(item.id); queue.push(...withinTargets(item));
    }
  }
  const items: WorkspaceDocument['items'] = {};
  // Selection order cannot change creation-time sorting; keys remain stable.
  for (const id of selected) if (workspace.items[id]) items[id] = workspace.items[id]!;
  items[draft.id] = draft;
  return withinPlacementWorkspace({ ...workspace, items }, now, { transient: true });
}
