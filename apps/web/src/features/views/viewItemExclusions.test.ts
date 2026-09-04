import { describe, expect, it } from 'vitest';
import { createItem, makeSeries } from '@utm/core';
import { exclusionFieldFor, itemIsExcludedByRows, itemIsExcludedBySource, setItemExcludedInRows, setItemExcludedInSource } from './viewItemExclusions';

describe('View item exclusions', () => {
  it('uses Item ID for a standalone item and remains independently reversible', () => {
    const item = createItem('One-off');
    const rows = setItemExcludedInRows(item, [], true);
    expect(rows[0]).toMatchObject({ join: 'and', field: 'id', operator: '!=', value: item.id });
    expect(itemIsExcludedByRows(item, rows)).toBe(true);
    expect(setItemExcludedInRows(item, rows, false)).toEqual([]);
  });

  it('uses the stable Series ID for a recurring item', () => {
    const source = createItem('Sleep');
    source.schedule = { timezone: 'UTC', startAt: '2026-09-04T20:00:00.000Z' };
    const series = makeSeries(source, 'FREQ=DAILY');
    expect(exclusionFieldFor(series)).toBe('occurrence.seriesId');
    expect(setItemExcludedInRows(series, [], true)[0]).toMatchObject({ field: 'occurrence.seriesId', value: series.id });
  });

  it('keeps exclusions visible and removable in advanced filter code', () => {
    const item = createItem('Busy');
    const added = setItemExcludedInSource(item, 'custom.score > 10 || priority == 4', true);
    expect(added).toContain(`id != "${item.id}"`);
    expect(itemIsExcludedBySource(item, added)).toBe(true);
    expect(setItemExcludedInSource(item, added, false)).not.toContain(item.id);
  });
});
