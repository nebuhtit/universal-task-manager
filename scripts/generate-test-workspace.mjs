import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  APP_VERSION, STANDARD_ATTENTION_VIEW_SORT_SOURCE, createItem, createWorkspace,
  ensureAreaDefinition, ensureProjectDefinition, ensureTagDefinition, standardAttentionViewSort,
  validateWorkspace,
} from '../packages/core/dist/index.js';
import { createAutomergeDocument, exportContainer, ready } from '../packages/sdk/dist/index.js';

const PASSWORD = 'Universal-1.98.0-Test!';
const OUTPUT = resolve(import.meta.dirname, '../apps/web/public/fixtures/test-workspace-1.98.0.utmb');
const virtualNow = new Date('2026-09-03T06:00:00.000Z');
const workspace = createWorkspace('UTM 1.98.0 complete test workspace', virtualNow);
workspace.workspaceId = 'utm-test-workspace-1-98-0';
workspace.calendarPreferences.timezone = 'Europe/Moscow';
workspace.calendarPreferences.language = 'en';
workspace.calendarPreferences.showExplanations = true;
workspace.calendarPreferences.testClock = {
  enabled: true,
  secondsPerDay: 86_400,
  dayDurationValue: 24,
  dayDurationUnit: 'hours',
  // A future real anchor freezes the deterministic test date until a tester
  // explicitly changes the accelerated clock in Settings.
  startedAt: '2099-01-01T00:00:00.000Z',
  virtualAt: virtualNow.toISOString(),
};

for (const [name, accent] of [['Health', '#7c3aed'], ['Work', '#2563eb'], ['Home', '#16a34a']]) ensureAreaDefinition(workspace, name, { accent }, virtualNow);
ensureProjectDefinition(workspace, 'Launch', { areas: ['Work'], accent: '#dc2626' }, virtualNow);
ensureProjectDefinition(workspace, 'Home renovation', { areas: ['Home'], accent: '#ea580c' }, virtualNow);
ensureProjectDefinition(workspace, 'Training plan', { areas: ['Health'], accent: '#0891b2' }, virtualNow);
for (const [name, accent] of [['focus', '#db2777'], ['urgent', '#e11d48'], ['later', '#64748b']]) ensureTagDefinition(workspace, name, { accent });
workspace.organizationPreferences.priorityOrder = [
  { kind: 'tag', name: 'focus' },
  { kind: 'project', name: 'Launch', area: 'Work' },
  { kind: 'area', name: 'Health' },
  { kind: 'tag', name: 'urgent' },
  { kind: 'project', name: 'Training plan', area: 'Health' },
  { kind: 'area', name: 'Work' },
  { kind: 'project', name: 'Home renovation', area: 'Home' },
  { kind: 'area', name: 'Home' },
  { kind: 'tag', name: 'later' },
  { kind: 'area', name: null },
  { kind: 'project', name: null },
  { kind: 'tag', name: null },
];
workspace.customFields['energy'] = { id: 'field-energy', key: 'energy', label: 'Energy', kind: 'enum', required: false, options: ['low', 'medium', 'high'] };

const at = (hours, minutes = 0, dayOffset = 0) => new Date(Date.UTC(2026, 8, 3 + dayOffset, hours - 3, minutes)).toISOString();
const add = (id, title, patch = {}) => {
  const item = createItem(title, patch.preset ?? 'task', virtualNow);
  Object.assign(item, patch, { id, createdWithVersion: APP_VERSION, updatedAt: virtualNow.toISOString() });
  delete item.presetOverride;
  workspace.items[id] = item;
  return item;
};

add('test-focus-tag', 'Focus tag wins from a low Area', { tags: ['focus'], areas: ['Home'], projects: ['Home renovation'], schedule: { timezone: 'Europe/Moscow', startAt: at(9), dueAt: at(12), estimatedDuration: 'PT45M' }, custom: { energy: 'high' } });
add('test-launch-project', 'Launch project wins despite later tag', { tags: ['later'], areas: ['Work'], projects: ['Launch'], schedule: { timezone: 'Europe/Moscow', startAt: at(8), dueAt: at(11), estimatedDuration: 'PT2H' }, custom: { energy: 'medium' } });
add('test-overdue', 'Overdue urgent task', { tags: ['urgent'], areas: ['Work'], schedule: { timezone: 'Europe/Moscow', dueAt: at(5), estimatedDuration: 'PT30M' }, reminders: [{ id: 'reminder-overdue', mode: 'absolute', at: at(5, 30), urgency: 'critical', repeatUntilAcknowledged: false }] });
add('test-active-range', 'Active range now', { areas: ['Health'], projects: ['Training plan'], schedule: { timezone: 'Europe/Moscow', startAt: at(8), dueAt: at(10), estimatedDuration: 'PT1H' }, reminders: [{ id: 'reminder-relative', mode: 'relative', relativeTo: 'due', offset: '-PT15M', urgency: 'urgent', repeatUntilAcknowledged: false }] });
add('test-future', 'Future start and due', { tags: ['later'], schedule: { timezone: 'Europe/Moscow', startAt: at(16), dueAt: at(18), estimatedDuration: 'PT20M' } });
add('test-unscheduled', 'Unscheduled item', { bodyMarkdown: 'Exercises the null-date sort path.', attachments: [{ id: 'attachment-docs', url: 'https://example.com/spec', title: 'Example link' }], scripts: [{ id: 'script-tag-count', key: 'tag_count', label: 'Tag count', source: 'length(tags)', resultKind: 'number' }] });
add('test-done', 'Completed item with actual duration', { state: 'done', closure: { at: at(7), actor: 'user', reason: 'manual' }, areas: ['Home'], schedule: { timezone: 'Europe/Moscow', dueAt: at(8), estimatedDuration: 'PT1H', actualDuration: 'PT50M' } });
add('test-event', 'Timed calendar event', { preset: 'event', location: 'Test room', tags: ['focus'], schedule: { timezone: 'Europe/Moscow', startAt: at(13), endAt: at(14, 30), estimatedDuration: 'PT1H30M' } });
add('test-all-day', 'All-day event excluded from time statistics', { preset: 'event', schedule: { timezone: 'Europe/Moscow', allDay: true, startAt: at(0), endAt: at(0, 0, 1), estimatedDuration: 'P1D' } });
add('test-habit', 'Daily reading habit', { preset: 'habit', tags: ['focus'], progress: { mode: 'counter', current: 0, target: 20, unit: 'minutes' }, habit: { target: 20, unit: 'minutes', streakMode: 'manual_only', completedDates: ['2026-09-01', '2026-09-02'] }, schedule: { timezone: 'Europe/Moscow', dueAt: at(21), estimatedDuration: 'PT20M' } });
add('test-series', 'Weekly review recurrence', { role: 'series_template', areas: ['Work'], projects: ['Launch'], schedule: { timezone: 'Europe/Moscow', startAt: at(17), dueAt: at(18), estimatedDuration: 'PT1H' }, recurrence: { rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TH', rdates: [], exdates: [], timezone: 'Europe/Moscow', activationOffset: 'P1D', closeAt: 'next_activation', anchor: 'schedule', autoRenew: true } });
const parent = add('test-parent', 'Parent task with relation', { tags: ['urgent'], schedule: { timezone: 'Europe/Moscow', dueAt: at(15), estimatedDuration: 'PT1H' } });
const child = add('test-child', 'Blocked child task', { schedule: { timezone: 'Europe/Moscow', dueAt: at(14), estimatedDuration: 'PT10M' } });
parent.relations = [{ id: 'relation-parent-child', targetId: child.id, type: 'parent' }];
child.relations = [{ id: 'relation-child-parent', targetId: parent.id, type: 'blocked_by' }];

const addView = (id, name, source, fields = ['title', 'schedule.startAt', 'schedule.dueAt', 'tags', 'area', 'project', 'reminders']) => {
  workspace.views[id] = { id, name, query: { source }, renderer: 'list', sort: standardAttentionViewSort(), sortSource: STANDARD_ATTENTION_VIEW_SORT_SOURCE, fields, statistics: { showTime: true, reservedItemIds: [] } };
  workspace.viewOrder.push(id);
};
addView('test-view-reminders', 'Test · active reminders', 'state == "open" && hasActiveReminders == true');
addView('test-view-active-now', 'Test · active range now', 'state == "open" && activeRange == true');
addView('test-view-focus-or-overdue', 'Test · focus OR overdue', 'state == "open" && (contains(tags, "focus") || dueAt < now())');
addView('test-view-para', 'Test · PARA unified priority', 'state == "open" && (length(tags) > 0 || length(areas) > 0 || length(projects) > 0)');
workspace.views['test-view-duration'] = { id: 'test-view-duration', name: 'Test · duration then created', query: { source: 'state == "open"' }, renderer: 'table', sort: [{ field: 'durationOrder', direction: 'desc', nulls: 'last' }, { field: 'createdAt', direction: 'desc', nulls: 'last' }], sortSource: 'durationOrder desc nulls last\ncreatedAt desc nulls last', fields: ['title', 'schedule.estimatedDuration', 'createdAt'] };
workspace.viewOrder.push('test-view-duration');
workspace.updatedAt = virtualNow.toISOString();

const validation = validateWorkspace(workspace);
if (!validation.valid) throw new Error(`Generated test workspace is invalid: ${validation.errors.join('; ')}`);
await ready();
const encrypted = await exportContainer(createAutomergeDocument(workspace), PASSWORD);
await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, encrypted);
console.log(`Generated ${OUTPUT} (${Object.keys(workspace.items).length} items, ${workspace.viewOrder.length} views, password ${PASSWORD})`);
