import { orderedOrganizationNames, orderedTagEntries, seriesReferenceIds, seriesReferenceOwner, seriesReferenceAncestors, withinTargetsFor, withinPlacementWorkspace, type UniversalItem, type WorkspaceDocument } from '@utm/core';
import { itemFamilyId, itemReferenceDetail } from './itemIdentity';

// Separate from the evaluation index: opening a text field must not calculate
// reminders, formulas or recurrence merely to offer organization names.
const indexes = new WeakMap<WorkspaceDocument, ReturnType<typeof buildIndex>>();
function buildIndex(workspace: WorkspaceDocument) {
  const items = Object.values(workspace.items);
  const reservedIds = new Set(seriesReferenceIds(workspace, [...(workspace.calendarPreferences.dayView.statistics?.reservedItemIds ?? []), ...Object.values(workspace.views).flatMap(view => view.statistics?.reservedItemIds ?? [])]
    .map(id => workspace.items[id]?.occurrence?.seriesId ?? id)));
  const byTarget = new Map<string, UniversalItem[]>();
  const occurrences = new Map<string, UniversalItem[]>();
  const projectAreas = new Map<string, Set<string>>();
  const familyMembers = new Map<string, string[]>();
  for (const name of orderedOrganizationNames(workspace, 'project')) {
    const definition = workspace.projectDefinitions[name];
    projectAreas.set(name, new Set([...(definition?.areas ?? []), ...(definition?.area ? [definition.area] : [])]));
  }
  for (const item of items) {
    if (item.role !== 'occurrence') {
      const family = itemFamilyId(workspace, item);
      familyMembers.set(family, [...(familyMembers.get(family) ?? []), item.id]);
    }
    for (const target of withinTargetsFor(workspace, item)) { const group = byTarget.get(target) ?? []; group.push(item); byTarget.set(target, group); }
    if (item.occurrence) { const group = occurrences.get(item.occurrence.seriesId) ?? []; group.push(item); occurrences.set(item.occurrence.seriesId, group); }
    if (item.deletedAt) continue;
    for (const name of new Set([...(item.projects ?? []), ...(item.project ? [item.project] : [])])) {
      const group = projectAreas.get(name);
      if (group) for (const area of [...(item.areas ?? []), ...(item.area ? [item.area] : [])]) group.add(area);
    }
  }
  const candidates = items.filter(i => !i.deletedAt && i.state !== 'archived' && i.state !== 'cancelled' && !(i.occurrence && workspace.items[i.occurrence.seriesId]));
  const titleCounts = new Map<string, number>();
  for (const item of candidates) { const key = item.title.trim().toLocaleLowerCase(); titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1); }
  return {
    candidates: candidates.map(item => ({ id: item.id, title: item.title, preferred: reservedIds.has(item.id), referenceId: itemFamilyId(workspace, item), wholeSeries: item.role === 'series_template' || Boolean(item.occurrence || item.recurrence?.rrule),
      ...((titleCounts.get(item.title.trim().toLocaleLowerCase()) ?? 0) > 1 || item.recurrenceOverride?.kind === 'future_split' ? { detail: itemReferenceDetail(workspace, item) } : {}) })),
    calendars: (workspace.calendarPreferences.googleCalendar?.calendars ?? []).filter(calendar => !calendar.accessRole || calendar.accessRole === 'owner' || calendar.accessRole === 'writer').map(calendar => ({ id: calendar.id, name: calendar.name })),
    byTarget, occurrences, familyMembers,
    catalog: { area: orderedOrganizationNames(workspace, 'area'), project: [...projectAreas.keys()], tag: orderedTagEntries(workspace).filter((tag): tag is string => tag !== null), projectAreas: Object.fromEntries([...projectAreas].map(([name, areas]) => [name, [...areas]])) },
  };
}
export function liveTextIndex(workspace: WorkspaceDocument) {
  let index = indexes.get(workspace);
  if (!index) { index = buildIndex(workspace); indexes.set(workspace, index); }
  return index;
}

/** One selected series reference already covers its continuation branches. */
export function withinReferenceCandidates(workspace: WorkspaceDocument, draft: UniversalItem | undefined, selectedIds: readonly string[]) {
  const families = new Set(selectedIds.map(id => seriesReferenceAncestors(workspace, seriesReferenceOwner(workspace, id)).at(-1)!));
  if (draft) families.add(itemFamilyId(workspace, draft));
  const choices = new Map<string, ReturnType<typeof liveTextIndex>['candidates'][number]>();
  for (const candidate of liveTextIndex(workspace).candidates) {
    const family = candidate.referenceId;
    if (families.has(family)) continue;
    const previous = choices.get(family);
    const since = (id: string) => workspace.items[id]?.recurrenceOverride?.recurrenceId ?? '';
    if (!previous || since(candidate.id) > since(previous.id)) choices.set(family, candidate);
  }
  return [...choices.values()];
}

/** Include the whole connected competition group, not just the selected task:
 * A in Work+Cleaning can shift B in Cleaning even if the draft only uses Work.
 * Preserve workspace ordering for tie-breaking and leave all definitions intact.
 */
export function withinPreviewWorkspace(workspace: WorkspaceDocument, draft: UniversalItem, now: Date) {
  const index = liveTextIndex(workspace);
  const selected = new Set<string>([draft.id]);
  const targets = new Set<string>();
  const queue = [...withinTargetsFor(workspace, draft)];
  for (let i = 0; i < queue.length; i++) {
    const target = queue[i]!;
    if (targets.has(target)) continue;
    targets.add(target); selected.add(target);
    const block = workspace.items[target];
    const family = block ? itemFamilyId(workspace, block) : target;
    queue.push(...(index.familyMembers.get(family) ?? []));
    if (block) queue.push(...withinTargetsFor(workspace, block));
    for (const item of index.occurrences.get(target) ?? []) selected.add(item.id);
    for (const item of index.byTarget.get(target) ?? []) {
      if (item.id === draft.id || item.deletedAt || item.state === 'archived' || item.state === 'cancelled') continue;
      selected.add(item.id); queue.push(...withinTargetsFor(workspace, item));
    }
  }
  const items: WorkspaceDocument['items'] = {};
  // Selection order cannot change creation-time sorting; keys remain stable.
  for (const id of selected) if (workspace.items[id]) items[id] = workspace.items[id]!;
  items[draft.id] = draft;
  return withinPlacementWorkspace({ ...workspace, items }, now, { transient: true });
}
