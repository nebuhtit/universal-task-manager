import { describe, expect, it } from 'vitest';
import { createItem, createOccurrence, createWorkspace, makeSeries, recurrenceDisplayItems, projectOccurrences } from './index.js';

describe('legacy recurrence display', () => {
  it('uses the edited cycle rather than its stale nested copy and preserves all records', () => {
    const workspace = createWorkspace();
    const root = createItem('Task'); root.schedule = { timezone: 'UTC', startAt: '2030-09-20T12:00:00.000Z', dueAt: '2030-09-24T12:00:00.000Z', estimatedDuration: 'PT45M' };
    const series = makeSeries(root, 'FREQ=WEEKLY');
    const edited = createOccurrence(series, new Date(root.schedule.startAt!), 0);
    edited.role = 'series_template'; edited.recurrence = series.recurrence!;
    edited.updatedAt = '2030-09-23T12:00:00.000Z';
    const stale = createOccurrence(edited, new Date(root.schedule.startAt!), 0);
    stale.schedule!.endAt = '2030-09-20T12:45:00.000Z';
    workspace.items = { [series.id]: series, [edited.id]: edited, [stale.id]: stale };
    const before = JSON.stringify(workspace);
    const rows = recurrenceDisplayItems(workspace);
    expect(rows.map(row => row.id)).toEqual([series.id, edited.id]);
    expect(rows[1]).toMatchObject({ role: 'occurrence', occurrence: { seriesId: series.id } });
    expect(rows[1]!.schedule?.endAt).toBeUndefined();
    expect(projectOccurrences(workspace, new Date('2030-09-20T00:00:00Z'), new Date('2030-09-21T00:00:00Z'))).toHaveLength(1);
    expect(JSON.stringify(workspace)).toBe(before);
    const independent = createItem('Task'); workspace.items[independent.id] = independent;
    expect(recurrenceDisplayItems(workspace)).toHaveLength(3);
  });
});
