import { createItem, createWorkspace, makeSeries } from '@utm/core';
import { describe, expect, it } from 'vitest';
import { getWorkspaceIndex } from './workspaceIndex';

describe('workspace index', () => {
  it('builds shared relation, organization, recurrence, reminder and script indexes once per workspace revision', () => {
    const workspace = createWorkspace('Indexed');
    workspace.calendarPreferences.timezone = 'UTC';
    workspace.areaDefinitions.Work = { name: 'Work', createdAt: workspace.createdAt, updatedAt: workspace.updatedAt };
    workspace.organizationPreferences.areaOrder = ['Work', null];
    workspace.organizationPreferences.priorityOrder = [{ kind: 'area', name: 'Work' }, { kind: 'area', name: null }];

    const parent = createItem('Parent');
    const child = createItem('Child');
    parent.areas = ['Work'];
    parent.relations = [{ id: 'parent-child', type: 'parent', targetId: child.id }];
    parent.reminders = [{ id: 'reminder', mode: 'absolute', at: '2026-09-03T10:00:00.000Z', urgency: 'normal', repeatUntilAcknowledged: false }];
    parent.scripts = [{ id: 'script', key: 'remaining', label: 'Remaining', source: 'secondsUntil(schedule.startAt)', resultKind: 'number' }];
    parent.schedule = { timezone: 'UTC', startAt: '2026-09-03T10:00:10.000Z' };
    const seriesSource = createItem('Series');
    seriesSource.schedule = { timezone: 'UTC', dueAt: '2026-09-04T10:00:00.000Z' };
    const series = makeSeries(seriesSource, 'FREQ=DAILY;INTERVAL=1');
    workspace.items = { [parent.id]: parent, [child.id]: child, [series.id]: series };

    const index = getWorkspaceIndex(workspace);
    expect(getWorkspaceIndex(workspace)).toBe(index);
    expect(index.activeItems).toHaveLength(3);
    expect(index.childIdsByItemId.get(parent.id)).toEqual([child.id]);
    expect(index.parentIdsByItemId.get(child.id)).toEqual([parent.id]);
    expect(index.relationFor(parent)).toMatchObject({ isParent: true, childDepth: 1 });
    expect(index.parentFor(child)).toBe(parent);
    expect(index.organizationRankFor(parent)).toBeGreaterThan(index.organizationRankFor(child));
    expect(index.queryItemFor(parent)).toBe(index.queryItemFor(parent));
    expect(index.queryItemFor(parent).area).toEqual(['Work']);
    expect(index.recurrence.seriesById.get(series.id)).toBe(series);
    expect(index.remindersFor(parent)[0]?.resolvedAt).toBe('2026-09-03T10:00:00.000Z');
    expect(index.scripts.itemDefinitionsByItemId.get(parent.id)).toBe(parent.scripts);
  });

  it('reuses each computed script/formula result and refreshes time-dependent results at a new clock snapshot', () => {
    const workspace = createWorkspace('Computed');
    const item = createItem('Computed');
    item.schedule = { timezone: 'UTC', startAt: '2026-09-03T10:00:10.000Z' };
    item.scripts = [{ id: 'local', key: 'remaining', label: 'Remaining', source: 'secondsUntil(schedule.startAt)', resultKind: 'number' }];
    workspace.customFields.score = { id: 'score', key: 'score', label: 'Score', kind: 'formula', formula: 'revision + 1', formulaResult: 'number', required: false };
    workspace.items[item.id] = item;
    const viewScripts = [{ id: 'view', key: 'remaining', label: 'Remaining', source: 'secondsUntil(schedule.startAt)', resultKind: 'number' as const }];
    const firstNow = new Date('2026-09-03T10:00:00.000Z');
    const secondNow = new Date('2026-09-03T10:00:01.000Z');
    const index = getWorkspaceIndex(workspace);

    expect(index.formulasFor(item, firstNow)).toBe(index.formulasFor(item, secondNow));
    const localFirst = index.itemScriptsFor(item, firstNow);
    expect(index.itemScriptsFor(item, firstNow)).toBe(localFirst);
    expect(index.itemScriptsFor(item, secondNow)).not.toBe(localFirst);
    expect(index.itemScriptsFor(item, secondNow).values.remaining).toBe(9);
    const viewFirst = index.viewScriptsFor(item, viewScripts, firstNow);
    expect(index.viewScriptsFor(item, [...viewScripts], firstNow)).toBe(viewFirst);
    expect(index.viewScriptsFor(item, viewScripts, secondNow).values.remaining).toBe(9);
  });

  it('can rebuild for legacy callers that add items by mutating the same workspace object', () => {
    const workspace = createWorkspace('Legacy mutation');
    const first = getWorkspaceIndex(workspace, true);
    const added = createItem('Added');
    workspace.items[added.id] = added;
    const rebuilt = getWorkspaceIndex(workspace, true);
    expect(rebuilt).not.toBe(first);
    expect(rebuilt.itemById.get(added.id)).toBe(added);
  });
});
