import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createItem, createOccurrence, createWorkspace } from '@utm/core';
import { incomingItemRelations, itemReferenceDetail, sameNameIndependentItems } from './itemIdentity';
import { IncomingRelations } from './editor/sections/IncomingRelations';
import { ItemIdentityNotice } from './editor/sections/ItemIdentityNotice';

function fixture() {
  const workspace = createWorkspace('Identity'); workspace.calendarPreferences.language = 'ru';
  const old = createItem('Work', 'event'); old.id = 'old-work'; old.role = 'series_template';
  old.schedule = { timezone: 'UTC', startAt: '2030-09-02T09:00:00Z', endAt: '2030-09-02T17:00:00Z' };
  old.recurrence = { rrule: 'FREQ=WEEKLY', timezone: 'UTC', anchor: 'schedule', closeAt: 'next_activation', autoRenew: true, exdates: [], rdates: [] };
  const next = structuredClone(old); next.id = 'next-work';
  next.recurrenceOverride = { kind: 'future_split', sourceSeriesId: old.id, recurrenceId: '2030-09-09T09:00:00Z' };
  const task = createItem('Иванову путевки'); task.id = 'task';
  task.relations = [{ id: 'r', targetId: old.id, type: 'scheduled_within' }];
  const other = createItem('Work', 'event'); other.id = 'separate-work';
  workspace.items = { [old.id]: old, [next.id]: next, [task.id]: task, [other.id]: other };
  return { workspace, old, next, task, other };
}

describe('item identity and incoming relationships', () => {
  it('shows an incoming task addressed to a historical occurrence that no longer exists', () => {
    const { workspace, next, task } = fixture();
    task.relations[0]!.targetId = 'occ_old-work_20300902090000000';
    const before = JSON.stringify(workspace);
    const links = incomingItemRelations(workspace, next);
    expect(links).toHaveLength(1); expect(links[0]?.source.id).toBe(task.id); expect(links[0]?.inherited).toBe(true);
    expect(JSON.stringify(workspace)).toBe(before);
    delete workspace.items['old-work'];
    expect(incomingItemRelations(workspace, next)[0]?.source.id).toBe(task.id);
    expect(before).toContain('occ_old-work_20300902090000000');
    task.relations[0]!.targetId = 'occ_unrelated_20300902090000000';
    expect(incomingItemRelations(workspace, next)).toEqual([]);
  });
  it('shows a task on the continued Work without linking an independent namesake', () => {
    const { workspace, old, next, task, other } = fixture();
    const before = JSON.stringify(workspace);
    expect(incomingItemRelations(workspace, next)).toEqual([{ source: task, relation: task.relations[0], inherited: true }]);
    expect(incomingItemRelations(workspace, old)[0]?.inherited).toBe(false);
    expect(incomingItemRelations(workspace, other)).toEqual([]);
    const markup = renderToStaticMarkup(<IncomingRelations item={next} workspace={workspace} />);
    expect(markup).toContain('Иванову путевки'); expect(markup).toContain('ветки одной повторяющейся серии');
    expect(markup).toContain(old.id.slice(-8)); expect(markup).toContain(next.id.slice(-8));
    expect(markup).not.toContain('separate-work');
    expect(JSON.stringify(workspace)).toBe(before);
    task.relations.push({ id: 'same-family', type: 'scheduled_within', targetId: next.id });
    expect(incomingItemRelations(workspace, next)).toHaveLength(1);
    expect(incomingItemRelations(workspace, next)[0]?.inherited).toBe(false);
  });

  it('distinguishes independent duplicate names from series branches and gives each choice an identity', () => {
    const { workspace, next, other } = fixture();
    expect(sameNameIndependentItems(workspace, next)).toEqual([other]);
    other.title = '  WORK  ';
    expect(sameNameIndependentItems(workspace, next)).toEqual([other]);
    const markup = renderToStaticMarkup(<ItemIdentityNotice item={next} workspace={workspace} />);
    expect(markup).toContain('отдельные элементы'); expect(markup).toContain('ID');
    expect(itemReferenceDetail(workspace, next)).toContain('Продолжение с');
    expect(itemReferenceDetail(workspace, next)).not.toBe(itemReferenceDetail(workspace, other));
  });

  it('shows incoming links on ordinary items and avoids repeating inherited cycle relationships', () => {
    const { workspace, old, next, task } = fixture();
    task.relations.push({ id: 'related', type: 'related', targetId: next.id });
    const series = structuredClone(old); series.id = 'recurring-task'; series.title = 'Recurring task'; series.relations = structuredClone(task.relations);
    const cycle = createOccurrence(series, new Date('2030-09-02T09:00:00Z'), 0);
    workspace.items[series.id] = series; workspace.items[cycle.id] = cycle;
    expect(incomingItemRelations(workspace, next).filter(entry => entry.source.id === cycle.id)).toEqual([]);
    expect(incomingItemRelations(workspace, next).filter(entry => entry.source.id === task.id)).toHaveLength(2);
    workspace.calendarPreferences.language = 'en';
    expect(renderToStaticMarkup(<IncomingRelations item={next} workspace={workspace} />)).toContain('Incoming relationships');
  });
});
