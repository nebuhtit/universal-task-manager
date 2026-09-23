import { createItem, createWorkspace } from '@utm/core';
import { describe, expect, it } from 'vitest';
import { createLiveDayPreview } from './liveDayPreview';

describe('mini timeline reserves', () => {
  it('includes filtered pinned occupancy, clips to the day and reuses projections', () => {
    const now = new Date('2026-09-23T12:00:00Z');
    const workspace = createWorkspace('Preview', now);
    workspace.calendarPreferences.timezone = 'UTC';
    workspace.calendarPreferences.dayView.filter.source = 'title != "Reserve"';
    const item = createItem('Reserve', 'event', now);
    item.schedule = { startAt: '2026-09-22T23:00:00Z', endAt: '2026-09-23T09:00:00Z', timezone: 'UTC' };
    workspace.items[item.id] = item;
    workspace.calendarPreferences.dayView.statistics = { showTime: true, reservedItemIds: [item.id] };
    const model = createLiveDayPreview();
    const result = model.evaluate(workspace, '2026-09-23', now);
    expect(result.reserves).toEqual([{ start: Date.parse('2026-09-23T00:00:00Z'), end: Date.parse('2026-09-23T09:00:00Z') }]);
    expect(result.events.some(event => event.item.id === item.id)).toBe(false);
    const count = model.counters.projections;
    expect(model.evaluate(workspace, '2026-09-23', new Date(now.getTime() + 60_000)).reserves).toEqual(result.reserves);
    expect(model.counters.projections).toBe(count);
    const changed = structuredClone(workspace);
    changed.calendarPreferences.dayView.statistics!.reservedItemIds = [];
    expect(model.evaluate(changed, '2026-09-23', now).reserves).toEqual([]);
  });
});
