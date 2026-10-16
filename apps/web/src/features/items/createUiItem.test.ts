import { describe, expect, it } from 'vitest';
import { canManuallyComplete, createWorkspace, type SavedView } from '@utm/core';
import { createUiItem } from './createUiItem';
import { applyQuickEntryText, createQuickEntryItem } from './quickEntry';
import { applyViewCreationDefaults } from '../views/applyCreationDefaults';
import { paraAreaViews, paraProjectView } from '../settings/OrganizationManager';

describe('undated task capture', () => {
  const now = new Date('2030-09-20T12:00:00Z');
  const workspace = createWorkspace('Capture', now);
  const home: SavedView = { id: 'home', name: 'Home', query: { source: 'true' }, renderer: 'list', fields: [], sort: [] };
  const views = [home, paraProjectView('Launch'), paraAreaViews(workspace, 'Work').at(-1)!];
  it.each(views)('keeps ordinary editor and scoped Live Text capture undated in $name', view => {
    const base = applyViewCreationDefaults(createUiItem('', 'task', now), view, workspace);
    const typed = applyQuickEntryText(base, 'Call client', now, { preserveUnspecifiedSchedule: true }).item;
    for (const item of [base, typed]) {
      expect(item.schedule).toMatchObject({ estimatedDuration: 'PT10M' });
      expect(item.schedule?.startAt).toBeUndefined();
      expect(item.schedule?.endAt).toBeUndefined();
      expect(canManuallyComplete(item)).toBe(true);
    }
    expect(typed.projects).toEqual(base.projects);
    expect(typed.areas).toEqual(base.areas);
  });
  it('keeps global capture undated while honoring explicit event times and duration in scoped capture', () => {
    const plain = createQuickEntryItem('Call client', now);
    expect(plain.schedule).toMatchObject({ estimatedDuration: 'PT10M' });
    expect(plain.schedule?.startAt).toBeUndefined();
    expect(plain.schedule?.endAt).toBeUndefined();
    expect(canManuallyComplete(plain)).toBe(true);
    const base = applyViewCreationDefaults(createUiItem('', 'task', now), views[1]!, workspace);
    const timed = applyQuickEntryText(base, 'Call client начало 23.09.2030 12:00 длительность 30м', now, { preserveUnspecifiedSchedule: true }).item;
    expect(timed.schedule?.startAt).toBeTruthy();
    expect(timed.schedule?.estimatedDuration).toBe('PT30M');
    expect(Date.parse(timed.schedule!.endAt!) - Date.parse(timed.schedule!.startAt!)).toBe(30 * 60_000);
  });
});
