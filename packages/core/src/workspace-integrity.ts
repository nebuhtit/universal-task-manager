import type { WorkspaceDocument } from './types.js';

export interface WorkspaceIntegrityIssue {
  code: 'nested-series' | 'missing-series' | 'cyclic-series' | 'duplicate-cycle' | 'duplicate-google-link' | 'end-without-start' | 'invalid-event-range' | 'invalid-active-range' | 'linked-without-end';
  itemIds: string[];
}

/** Semantic audit only: never repairs, deletes, or rewrites the source document. */
export function inspectWorkspaceIntegrity(workspace: WorkspaceDocument): WorkspaceIntegrityIssue[] {
  const issues: WorkspaceIntegrityIssue[] = [];
  const cycles = new Map<string, string[]>();
  const links = new Map<string, string[]>();
  const group = (map: Map<string, string[]>, key: string, id: string) => map.set(key, [...(map.get(key) ?? []), id]);
  for (const item of Object.values(workspace.items)) {
    if (item.deletedAt || workspace.tombstones[item.id]) continue;
    const report = (code: WorkspaceIntegrityIssue['code']) => issues.push({ code, itemIds: [item.id] });
    if (item.role === 'series_template' && item.occurrence) report('nested-series');
    let parent = item;
    const visited = new Set([item.id]);
    while (parent.occurrence && parent.recurrenceOverride?.kind !== 'future_split') {
      const id = parent.occurrence.seriesId;
      if (visited.has(id)) { report('cyclic-series'); break; }
      visited.add(id);
      const next = workspace.items[id];
      if (!next) { if (!workspace.tombstones[id]) report('missing-series'); break; }
      parent = next;
    }
    if (item.occurrence) group(cycles, JSON.stringify([parent.id, item.occurrence.recurrenceId]), item.id);
    const pending = item.extensions?.['utm:googleSave'] as { kind?: string } | undefined;
    if (item.external) {
      const link = item.external;
      group(links, JSON.stringify([link.connectionId, link.calendarId, link.eventId]), item.id);
      if (!item.schedule?.endAt && !link.readOnly && pending?.kind !== 'delete') report('linked-without-end');
    }
    const schedule = item.schedule;
    if (schedule?.endAt && !schedule.startAt) report('end-without-start');
    if (schedule?.startAt && schedule.endAt && Date.parse(schedule.endAt) <= Date.parse(schedule.startAt)) report('invalid-event-range');
    if (schedule?.startAt && schedule.dueAt && Date.parse(schedule.dueAt) < Date.parse(schedule.startAt)) report('invalid-active-range');
    // Duration is an independent estimate, NOT a required equality with event occupancy.
  }
  for (const ids of cycles.values()) if (ids.length > 1) issues.push({ code: 'duplicate-cycle', itemIds: ids });
  for (const ids of links.values()) if (ids.length > 1) issues.push({ code: 'duplicate-google-link', itemIds: ids });
  return issues;
}
