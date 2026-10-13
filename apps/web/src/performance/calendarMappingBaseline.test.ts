import { describe, expect, it } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { googleCalendarProjection, projectOccurrences, recurrenceDisplayItems, type WorkspaceDocument } from '@utm/core';
import { createCalendarProjectionCache } from '../features/calendar/calendarProjectionCache';
import { createPerformanceWorkspace } from './performanceFixture';

const extended = process.env.UTM_PERF_BASELINE === '1';
const start = new Date('2026-08-31T00:00:00Z');
const end = new Date('2026-09-07T00:00:00Z');

describe('calendar mapping baseline', () => {
  const cases = extended ? [[1_000, false], [10_000, false], [1_000, true]] as const : [[100, false], [100, true]] as const;
  for (const [size, crdt] of cases) it(`preserves projections through single-item edits (${size} items, ${crdt ? 'Automerge' : 'plain'})`, () => {
    let workspace = createPerformanceWorkspace(size);
    // Notes are typical card payload, but do not affect recurrence placement.
    for (const item of Object.values(workspace.items)) item.bodyMarkdown = 'Private fixture note. '.repeat(50);
    let doc = crdt ? Automerge.from(workspace as unknown as Record<string, unknown>) as Automerge.Doc<WorkspaceDocument> : undefined;
    if (doc) workspace = doc;
    const cache = createCalendarProjectionCache();
    const original = workspace;
    const before = JSON.stringify(workspace);
    cache.project(workspace, start, end);
    const samples: number[] = [];
    for (let step = 0; step < 5; step++) {
      const id = `item-${String(step + 1).padStart(6, '0')}`;
      if (doc) { doc = Automerge.change(doc, draft => { draft.items[id]!.title = `Edited ${step}`; }); workspace = doc; }
      else workspace = { ...workspace, items: { ...workspace.items, [id]: { ...workspace.items[id]!, title: `Edited ${step}` } } };
      const at = performance.now();
      const mapped = cache.workspaceFor(workspace);
      samples.push(performance.now() - at);
      const reference: WorkspaceDocument = { ...workspace, items: Object.fromEntries(recurrenceDisplayItems(workspace).map(item => [item.id, googleCalendarProjection(item)])) };
      expect(mapped).toEqual(reference);
      expect(cache.project(workspace, start, end)).toEqual(projectOccurrences(reference, start, end));
    }
    expect(JSON.stringify(original)).toBe(before);
    expect(workspace.items['item-000000']!.title).toBe('Item 000000');
    if (extended) console.info(JSON.stringify({ benchmark: 'calendar.mapping-edit', items: size, snapshot: crdt ? 'Automerge' : 'plain', samplesMs: samples.map(value => +value.toFixed(2)), medianMs: +[...samples].sort((a, b) => a - b)[2]!.toFixed(2) }));
    if (doc) Automerge.free(doc);
  });
});
