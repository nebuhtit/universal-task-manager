import {
  STANDARD_ATTENTION_VIEW_SORT_SOURCE,
  createItem,
  createWorkspace,
  makeSeries,
  standardAttentionViewSort,
  type SavedView,
  type UniversalItem,
  type WorkspaceDocument,
} from '@utm/core';

export const PERFORMANCE_NOW = new Date('2026-09-03T09:00:00.000Z');
const DAY_MS = 86_400_000;
const pad = (value: number) => String(value).padStart(6, '0');
const iso = (milliseconds: number) => new Date(milliseconds).toISOString();

const view = (id: string, name: string, query: string, statistics = true): SavedView => ({
  id,
  name,
  query: { source: query },
  renderer: 'list',
  fields: ['title', 'schedule.startAt', 'schedule.dueAt', 'tags', 'area', 'project', 'schedule.estimatedDuration', 'reminders'],
  sort: standardAttentionViewSort(),
  sortSource: STANDARD_ATTENTION_VIEW_SORT_SOURCE,
  ...(statistics ? { statistics: { showTime: true, reservedItemIds: [] } } : {}),
});

/** A deterministic mixed workspace used by correctness and performance baselines. */
export function createPerformanceWorkspace(itemCount: number): WorkspaceDocument {
  const workspace = createWorkspace(`Performance ${itemCount}`, PERFORMANCE_NOW);
  workspace.workspaceId = `performance-${itemCount}`;
  workspace.dashboards = {};
  workspace.calendarPreferences.timezone = 'UTC';
  workspace.calendarPreferences.language = 'en';
  workspace.areaDefinitions = Object.fromEntries(['Home', 'Work', 'Health'].map((name, index) => [name, {
    name, createdAt: iso(PERFORMANCE_NOW.getTime() - (index + 1) * DAY_MS), updatedAt: PERFORMANCE_NOW.toISOString(),
  }]));
  workspace.projectDefinitions = {
    Launch: { name: 'Launch', areas: ['Work'], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: PERFORMANCE_NOW.toISOString() },
    Renovation: { name: 'Renovation', areas: ['Home'], createdAt: '2026-01-02T00:00:00.000Z', updatedAt: PERFORMANCE_NOW.toISOString() },
    Fitness: { name: 'Fitness', areas: ['Health'], createdAt: '2026-01-03T00:00:00.000Z', updatedAt: PERFORMANCE_NOW.toISOString() },
  };
  workspace.organizationPreferences = {
    areaOrder: ['Work', 'Home', 'Health', null],
    projectOrder: ['Launch', 'Renovation', 'Fitness', null],
    tagOrder: ['urgent', 'focus', 'routine', null],
    priorityOrder: [
      { kind: 'tag', name: 'urgent' },
      { kind: 'project', name: 'Launch', area: 'Work' },
      { kind: 'area', name: 'Work' },
      { kind: 'tag', name: 'focus' },
      { kind: 'project', name: 'Renovation', area: 'Home' },
      { kind: 'area', name: 'Home' },
      { kind: 'project', name: 'Fitness', area: 'Health' },
      { kind: 'area', name: 'Health' },
      { kind: 'tag', name: 'routine' },
      { kind: 'area', name: null },
      { kind: 'project', name: null },
      { kind: 'tag', name: null },
    ],
  };

  const items: Record<string, UniversalItem> = {};
  for (let index = 0; index < itemCount; index += 1) {
    const id = `item-${pad(index)}`;
    const dayOffset = index % 31 - 15;
    const start = PERFORMANCE_NOW.getTime() + dayOffset * DAY_MS + (index % 10 - 4) * 3_600_000;
    const durationMinutes = [10, 20, 30, 45, 60, 90, 120][index % 7]!;
    const event = index % 4 === 0;
    let item = createItem(`Item ${pad(index)}`, event ? 'event' : 'task', new Date(PERFORMANCE_NOW.getTime() - index * 60_000));
    item.id = id;
    item.createdAt = iso(PERFORMANCE_NOW.getTime() - index * 60_000);
    item.updatedAt = item.createdAt;
    item.revision = index % 9 + 1;
    item.priority = (index % 5) as 0 | 1 | 2 | 3 | 4;
    item.state = index % 19 === 0 ? 'cancelled' : index % 7 === 0 ? 'done' : 'open';
    item.areas = index % 3 === 0 ? ['Work'] : index % 3 === 1 ? ['Home'] : index % 5 === 0 ? [] : ['Health'];
    item.projects = index % 6 === 0 ? ['Launch'] : index % 6 === 1 ? ['Renovation'] : index % 6 === 2 ? ['Fitness'] : [];
    item.tags = index % 11 === 0 ? ['urgent', 'focus'] : index % 3 === 0 ? ['focus'] : index % 5 === 0 ? ['routine'] : [];
    item.schedule = {
      timezone: 'UTC',
      ...(event ? { startAt: iso(start), endAt: iso(start + durationMinutes * 60_000) } : {}),
      ...(index % 5 !== 4 ? { dueAt: iso(start + (index % 3) * DAY_MS) } : {}),
      estimatedDuration: `PT${durationMinutes}M`,
    };
    if (index % 11 === 0) item.reminders.push({ id: `reminder-a-${id}`, mode: 'absolute', at: iso(start - 30 * 60_000), urgency: index % 22 === 0 ? 'urgent' : 'normal', repeatUntilAcknowledged: false });
    if (index % 13 === 0) item.reminders.push({ id: `reminder-r-${id}`, mode: 'relative', relativeTo: 'due', offset: '-PT1H', urgency: 'critical', repeatUntilAcknowledged: true, ...(index % 26 === 0 ? { acknowledgedAt: PERFORMANCE_NOW.toISOString() } : {}) });
    if (index % 10 === 0 && index + 1 < itemCount) item.relations.push({ id: `relation-${id}`, type: 'parent', targetId: `item-${pad(index + 1)}` });
    if (index % 100 === 0) item = makeSeries(item, 'FREQ=DAILY;INTERVAL=3', { activationOffset: 'P7D', closeAt: 'next_activation' });
    items[id] = item;
  }
  workspace.items = items;
  workspace.views = {
    all: view('all', 'All active', 'state == "open" && isTemplate != true'),
    today: view('today', 'Today', 'state == "open" && scheduleInPeriod("today", "event_open,event,active,due", true, 7, "", "")'),
    week: view('week', 'This week', 'state == "open" && scheduleInPeriod("this_week", "event_open,event,active,due", true, 7, "", "")'),
    reminders: view('reminders', 'Active reminders', 'state == "open" && hasActiveReminders == true', false),
  };
  workspace.viewOrder = ['today', 'week', 'all', 'reminders'];
  workspace.views.today!.statistics!.reservedItemIds = Object.values(items).filter((item) => item.role === 'series_template').slice(0, 4).map((item) => item.id);
  workspace.views.week!.statistics!.reservedItemIds = [...workspace.views.today!.statistics!.reservedItemIds];
  workspace.updatedAt = PERFORMANCE_NOW.toISOString();
  return workspace;
}
