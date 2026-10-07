import { expect, it, vi } from 'vitest';
import { createItem, createWorkspace, makeSeries, orderedOrganizationNames, withinPlacementWorkspace, type UniversalItem } from '@utm/core';
import { withinSuggestions } from '../../../quick-entry-lab/relations';
import { liveTextIndex, withinPreviewWorkspace } from './liveTextIndex';

it('loads relationship candidates only for a textual rr/рр command', () => {
  const load = vi.fn(() => [{ id: 'a', title: 'Work' }, { id: 'b', title: 'Work' }]);
  for (const text of ['hello', 'рр 30', 'rr 45m']) expect(withinSuggestions(text, text.length, load)).toBeNull();
  expect(load).not.toHaveBeenCalled();
  for (const text of ['rr W', 'рр W']) expect(withinSuggestions(text, text.length, load)?.options).toHaveLength(2);
});

it('shares organization catalog and retains legacy project/area order', () => {
  const workspace = createWorkspace('test');
  for (let i = 0; i < 20; i++) {
    const item = createItem('item'); item.project = 'Legacy'; item.projects = ['Modern']; item.area = 'A'; item.areas = ['B'];
    workspace.items[item.id] = item;
  }
  const indexed = liveTextIndex(workspace);
  expect(liveTextIndex(workspace)).toBe(indexed);
  expect(indexed.catalog.project).toEqual(orderedOrganizationNames(workspace, 'project'));
  for (const name of indexed.catalog.project) expect(indexed.catalog.projectAreas[name]).toEqual(['B', 'A']);
  const changed = structuredClone(workspace); Object.values(changed.items)[0]!.areas = ['C'];
  expect(liveTextIndex(changed)).not.toBe(indexed);
  expect(liveTextIndex(changed).catalog.projectAreas.Modern).toContain('C');
});

it('matches full placement including transitive competing tasks, missed days and explicit times', () => {
  const now = new Date('2026-10-06T09:00:00Z');
  const workspace = createWorkspace('placement'); workspace.calendarPreferences.timezone = 'UTC';
  const add = (id: string, targets: string[], minutes = 60) => {
    const item = createItem(id, 'task', new Date('2026-10-05T00:00:00Z'));
    item.id = id; item.schedule = { timezone: 'UTC', plannedDate: '2026-10-06', estimatedDuration: `PT${minutes}M` };
    item.relations = targets.map(targetId => ({ id: targetId, type: 'scheduled_within' as const, targetId }));
    workspace.items[id] = item; return item;
  };
  for (const id of ['work', 'clean', 'other']) {
    const item = add(id, []); item.schedule = { timezone: 'UTC', startAt: '2026-10-06T08:00:00Z', endAt: '2026-10-06T16:00:00Z' };
  }
  add('a', ['work', 'clean']); add('b', ['clean']); add('unrelated', ['other']);
  const draft = add('c', ['work']);
  for (const day of ['2026-10-05', '2026-10-06', '2026-10-07', undefined]) {
    for (const minutes of [30, 600]) {
      const candidate: UniversalItem = { ...draft, schedule: { timezone: 'UTC', ...(day ? { plannedDate: day } : {}), estimatedDuration: `PT${minutes}M` } };
      const full = withinPlacementWorkspace({ ...workspace, items: { ...workspace.items, c: candidate } }, now);
      const subset = withinPreviewWorkspace(workspace, candidate, now);
      for (const id of ['a', 'b', 'c']) expect(subset.items[id]).toEqual(full.items[id]);
      expect(subset.items.unrelated).toBeUndefined();
    }
  }
  const explicit = { ...draft, schedule: { timezone: 'UTC', startAt: '2026-10-06T12:00:00Z', endAt: '2026-10-06T13:00:00Z' } };
  expect(withinPreviewWorkspace(workspace, explicit, now).items.c).toEqual(explicit);
  const recurring = structuredClone(workspace);
  recurring.items.work = makeSeries(recurring.items.work!, 'FREQ=WEEKLY');
  const nextWeek = { ...draft, schedule: { timezone: 'UTC', plannedDate: '2026-10-13', estimatedDuration: 'PT90M' } };
  const full = withinPlacementWorkspace({ ...recurring, items: { ...recurring.items, c: nextWeek } }, now);
  expect(withinPreviewWorkspace(recurring, nextWeek, now).items.c).toEqual(full.items.c);
  const noRelation = { ...nextWeek, relations: [] };
  expect(withinPreviewWorkspace(recurring, noRelation, now).items.c).toEqual(noRelation);
});
