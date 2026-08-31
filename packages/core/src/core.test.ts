import { describe, expect, it } from 'vitest';
import {
  APP_ID, APP_NAME, APP_RELEASED_AT, APP_VERSION, SCHEMA_VERSION, advanceCompletionAnchoredSeries, applyPortableImport, backfillItemCreationVersions, buildPortableImportPreview, buildRecurrenceRule,
  compileQuery, compileSort, createId, createItem, createOccurrence, createPortablePackage, createWorkspace, evaluateFormulas, evaluateItemScripts, fromCanonicalJSON, fromICS, makeSeries,
  materializeProjectedOccurrence, migrateItem, migrateView, migrateWorkspace, moveCalendarItems, moveRecurringOccurrence, parseExpression, parsePortablePackage, parseSortSource,
  projectOccurrences, reconcileRecurrences, removeDuplicateReminders, resizeCalendarItem, restoreCalendarSchedules, runAutomationEvents,
  packageToTabular, parseCsv, serializePortablePackage, serializeSortRules, tabularToPackage, toCsv, toICS, validateViewCreationDefaults, validateWorkspace,
} from './index.js';
import type { AutomationRule, DomainEvent, UniversalItem } from './types.js';

describe('safe expression language', () => {
  it('filters items without evaluating JavaScript', () => {
    const item = createItem('Prepare material');
    expect(item.createdWithAppId).toBe(APP_ID);
    expect(item.createdWithAppName).toBe(APP_NAME);
    expect(item.createdWithVersion).toBe(APP_VERSION);
    expect(Number.isNaN(new Date(APP_RELEASED_AT).getTime())).toBe(false);
    item.tags = ['work', 'writing']; item.priority = 4;
    expect(compileQuery('state == "open" && priority >= 3 && includes(tags, "work")')(item)).toBe(true);
    item.priority = 2;
    expect(compileQuery('priority == 3 || priority < 3')(item)).toBe(true);
    const withoutPriority = createItem('No priority');
    expect(compileQuery('priority < 3')(withoutPriority)).toBe(false);
    expect(() => parseExpression('globalThis.fetch("https://example.com")')).not.toThrow();
    expect(() => compileQuery('globalThis.fetch("https://example.com")')(item)).toThrow('Function is not allowed');
  });

  it('supports active-range predicates and Active wording aliases', () => {
    const item = createItem('Time boxed');
    item.schedule = { startAt: '2026-08-20T10:00:00.000Z', dueAt: '2026-08-20T10:02:00.000Z' };
    const query = compileQuery('state == "active" && activeRange == true');
    expect(query(item, new Date('2026-08-20T10:01:00.000Z'))).toBe(true);
    expect(query(item, new Date('2026-08-20T10:03:00.000Z'))).toBe(false);
  });

  it('distinguishes an active duration from a point date and supports presence checks', () => {
    const bounded = createItem('Bounded');
    bounded.schedule = { startAt: '2026-08-20T10:00:00.000Z', dueAt: '2026-08-20T10:02:00.000Z' };
    const openOnly = createItem('Open only');
    openOnly.schedule = { startAt: '2026-08-20T10:00:00.000Z' };
    expect(compileQuery('activeDuration == true')(bounded)).toBe(true);
    expect(compileQuery('activeDuration == true')(openOnly)).toBe(false);
    expect(compileQuery('schedule.startAt != null')(bounded)).toBe(true);
    expect(compileQuery('schedule.dueAt == null')(openOnly)).toBe(true);
    expect(compileQuery('length(tags) == 0')(createItem('No tags'))).toBe(true);
  });

  it('creates active, today and week starter views with compact fields', () => {
    const workspace = createWorkspace('Starter views', new Date(2026, 7, 26, 12));
    const views = Object.values(workspace.views);
    expect(views.map((view) => view.name)).toEqual(['All items', 'Today', 'This week']);
    expect(workspace.viewOrder.map((id) => workspace.views[id]?.name)).toEqual(['Today', 'This week', 'All items']);
    expect(views.every((view) => view.renderer === 'list')).toBe(true);
    const defaultFields = ['title', 'bodyMarkdown', 'schedule.startAt', 'schedule.dueAt', 'tags', 'area', 'project'];
    expect(views.every((view) => JSON.stringify(view.fields) === JSON.stringify(defaultFields))).toBe(true);
    expect(views[0]?.query.source).toContain('state == "open"');
  });

  it('filters due-date buckets by local day and Monday-based week', () => {
    const now = new Date(2026, 7, 26, 12);
    const itemDueAt = (date: Date) => { const item = createItem('Due'); item.schedule = { dueAt: date.toISOString(), timezone: 'UTC' }; return item; };
    const today = compileQuery('dueTodayOrOverdue == true', undefined, { timeZone: 'Europe/Moscow', weekStartsOn: 1 });
    const week = compileQuery('dueThisWeekOrOverdue == true', undefined, { timeZone: 'Europe/Moscow', weekStartsOn: 1 });
    expect(today(itemDueAt(new Date(2026, 7, 25, 18)), now)).toBe(true);
    expect(today(itemDueAt(new Date(2026, 7, 26, 20)), now)).toBe(true);
    expect(today(itemDueAt(new Date(2026, 7, 27, 9)), now)).toBe(false);
    expect(week(itemDueAt(new Date(2026, 7, 30, 20)), now)).toBe(true);
    expect(week(itemDueAt(new Date(2026, 7, 31, 9)), now)).toBe(false);
    expect(today(createItem('No due date'), now)).toBe(false);
  });

  it('matches Today and This week when an event interval overlaps the period while retaining overdue items', () => {
    const now = new Date('2026-08-26T12:00:00.000Z');
    const event = (startAt: string, endAt: string) => { const item = createItem('Event'); item.schedule = { startAt, endAt, timezone: 'UTC' }; return item; };
    const active = 'state == "open" && role != "series_template" && isTemplate != true';
    const today = compileQuery(`${active} && (eventToday == true || dueTodayOrOverdue == true)`, undefined, { timeZone: 'UTC', weekStartsOn: 1 });
    const week = compileQuery(`${active} && (eventThisWeek == true || dueThisWeekOrOverdue == true)`, undefined, { timeZone: 'UTC', weekStartsOn: 1 });
    expect(today(event('2026-08-25T20:00:00.000Z', '2026-08-26T15:00:00.000Z'), now)).toBe(true);
    expect(today(event('2026-08-27T09:00:00.000Z', '2026-08-27T10:00:00.000Z'), now)).toBe(false);
    expect(week(event('2026-08-23T20:00:00.000Z', '2026-08-24T01:00:00.000Z'), now)).toBe(true);
    expect(week(event('2026-08-31T09:00:00.000Z', '2026-08-31T10:00:00.000Z'), now)).toBe(false);
    const overdue = createItem('Overdue'); overdue.schedule = { dueAt: '2026-08-20T09:00:00.000Z', timezone: 'UTC' };
    expect(today(overdue, now)).toBe(true);
    expect(week(overdue, now)).toBe(true);
  });

  it('matches reusable schedule periods, custom ranges and optional overdue items', () => {
    const now = new Date('2026-08-30T21:30:00.000Z'); // 31 August in Europe/Moscow
    const query = (source: string) => compileQuery(source, undefined, { timeZone: 'Europe/Moscow', weekStartsOn: 1 });
    const item = createItem('Tomorrow event');
    item.schedule = { startAt: '2026-08-31T22:00:00.000Z', endAt: '2026-08-31T23:00:00.000Z', dueAt: '2026-09-01T12:00:00.000Z' };
    expect(query('scheduleInPeriod("tomorrow", "event_open", false, 7, "", "")')(item, now)).toBe(true);
    expect(query('scheduleInPeriod("today", "event_open", false, 7, "", "")')(item, now)).toBe(false);
    expect(query('scheduleInPeriod("custom", "active", false, 7, "2026-09-01", "2026-09-03")')(item, now)).toBe(true);
    expect(query('scheduleInPeriod("next_days", "due", false, 3, "", "")')(item, now)).toBe(true);

    const overdue = createItem('Overdue');
    overdue.schedule = { dueAt: '2026-08-30T20:00:00.000Z' };
    expect(query('scheduleInPeriod("tomorrow", "due", true, 7, "", "")')(overdue, now)).toBe(true);
    overdue.state = 'done';
    expect(query('scheduleInPeriod("tomorrow", "due", true, 7, "", "")')(overdue, now)).toBe(false);
  });

  it('modernizes legacy starter view labels, filters and order without touching custom views', () => {
    const workspace = createWorkspace('Legacy starter views');
    const today = Object.values(workspace.views).find((view) => view.name === 'Today')!;
    const week = Object.values(workspace.views).find((view) => view.name === 'This week')!;
    today.name = 'Today + overdue'; today.query.source = 'state == "open" && role != "series_template" && isTemplate != true && dueTodayOrOverdue == true';
    week.name = 'This week + overdue'; week.query.source = 'state == "open" && role != "series_template" && isTemplate != true && dueThisWeekOrOverdue == true';
    workspace.viewOrder = ['__all_items__', today.id, week.id];
    workspace.views.custom = { id: 'custom', name: 'Custom overdue', query: { source: 'dueTodayOrOverdue == true' }, renderer: 'list', sort: [], fields: ['title'] };
    workspace.viewOrder.push('custom');
    const migrated = migrateWorkspace(workspace).value;
    expect(migrated.viewOrder.slice(0, 4)).toEqual([today.id, week.id, '__all_items__', 'custom']);
    expect(migrated.views[today.id]?.name).toBe('Today');
    expect(migrated.views[today.id]?.query.source).toContain('eventToday == true || dueTodayOrOverdue == true');
    expect(migrated.views[today.id]?.fields).toEqual(['title', 'bodyMarkdown', 'schedule.startAt', 'schedule.dueAt', 'tags', 'area', 'project']);
    expect(migrated.views[week.id]?.name).toBe('This week');
    expect(migrated.views.custom?.query.source).toBe('dueTodayOrOverdue == true');
  });

  it('detects formula cycles', () => {
    const result = evaluateFormulas(createItem('Cost'), [
      { id: 'a', key: 'a', label: 'A', kind: 'formula', required: false, formula: 'custom.b + 1' },
      { id: 'b', key: 'b', label: 'B', kind: 'formula', required: false, formula: 'custom.a + 1' },
    ]);
    expect(Object.values(result.errors).join(' ')).toContain('cycle');
  });

  it('evaluates safe item scripts with time, duration and linked item values', () => {
    const linked = createItem('Linked');
    linked.priority = 4;
    const item = createItem('Computed');
    item.schedule = { timezone: 'UTC', startAt: '2026-08-24T12:00:00.000Z', estimatedDuration: 'PT45M' };
    item.relations = [{ id: 'rel-1', targetId: linked.id, type: 'related' }];
    item.scripts = [
      { id: 'script-1', key: 'remaining', label: 'Remaining', source: 'minutesUntil(schedule.startAt)', resultKind: 'number' },
      { id: 'script-2', key: 'finish', label: 'Finish', source: 'addDuration(schedule.startAt, schedule.estimatedDuration)', resultKind: 'datetime' },
      { id: 'script-3', key: 'linked_priority', label: 'Linked priority', source: 'linked("related", "priority")', resultKind: 'number' },
      { id: 'script-4', key: 'double_remaining', label: 'Double remaining', source: 'script.remaining * 2', resultKind: 'number' },
      { id: 'script-5', key: 'seconds_remaining', label: 'Seconds remaining', source: 'secondsUntil(schedule.startAt)', resultKind: 'number' },
      { id: 'script-6', key: 'calendar_length', label: 'Calendar length', source: 'durationBetween(schedule.startAt, script.finish)', resultKind: 'duration' },
      { id: 'script-7', key: 'friendly_length', label: 'Friendly length', source: 'formatDuration(script.calendar_length)', resultKind: 'text' },
    ];
    const result = evaluateItemScripts(item, (id) => id === linked.id ? linked : undefined, new Date('2026-08-24T11:30:00.000Z'));
    expect(result.values.remaining).toBe(30);
    expect(result.values.finish).toBe('2026-08-24T12:45:00.000Z');
    expect(result.values.linked_priority).toBe(4);
    expect(result.values.double_remaining).toBe(60);
    expect(result.values.seconds_remaining).toBe(1800);
    expect(result.values.calendar_length).toBe(2_700_000);
    expect(result.values.friendly_length).toBe('45m');
    expect(result.errors).toEqual({});
    const workspace = createWorkspace(); workspace.items[item.id] = item; workspace.items[linked.id] = linked;
    expect(validateWorkspace(workspace)).toEqual({ valid: true, errors: [] });
  });

  it('formats adaptive countdowns from days down to seconds', () => {
    const item = createItem('Adaptive countdown');
    item.scripts = [{ id: 'adaptive', key: 'adaptive', label: 'Remaining', source: 'timeUntil(schedule.startAt)', resultKind: 'text' }];
    const valueAt = (startAt: string, now: string) => {
      item.schedule = { timezone: 'UTC', startAt };
      return evaluateItemScripts(item, undefined, new Date(now)).values.adaptive;
    };
    expect(valueAt('2026-08-21T12:00:00.000Z', '2026-08-01T12:00:00.000Z')).toBe('20d');
    expect(valueAt('2026-08-01T17:30:00.000Z', '2026-08-01T12:00:00.000Z')).toBe('5h 30m');
    expect(valueAt('2026-08-01T12:00:42.000Z', '2026-08-01T12:00:00.000Z')).toBe('42s');
  });

  it('rejects arbitrary JavaScript and detects item script cycles', () => {
    const item = createItem('Unsafe');
    item.scripts = [
      { id: 'a', key: 'a', label: 'A', source: 'script.b + 1', resultKind: 'number' },
      { id: 'b', key: 'b', label: 'B', source: 'script.a + 1', resultKind: 'number' },
      { id: 'unsafe', key: 'unsafe', label: 'Unsafe', source: 'eval("alert(1)")', resultKind: 'text' },
    ];
    const result = evaluateItemScripts(item);
    expect(`${result.errors.a} ${result.errors.b}`).toContain('cycle');
    expect(result.errors.unsafe).toContain('not allowed');
  });

  it('backfills legacy creation versions without changing existing values', () => {
    const workspace = createWorkspace();
    const legacy = createItem('Legacy');
    delete (legacy as { createdWithAppId?: string }).createdWithAppId;
    delete (legacy as { createdWithAppName?: string }).createdWithAppName;
    delete (legacy as { createdWithVersion?: string }).createdWithVersion;
    const current = createItem('Current');
    workspace.items[legacy.id] = legacy;
    workspace.items[current.id] = current;
    expect(backfillItemCreationVersions(workspace)).toBe(1);
    expect(legacy.createdWithVersion).toBe('0.1.0');
    expect(legacy.createdWithAppId).toBe(APP_ID);
    expect(legacy.createdWithAppName).toBe(APP_NAME);
    expect(current.createdWithVersion).toBe(APP_VERSION);
  });

  it('keeps saved-view creation defaults portable while rejecting system and relation fields', () => {
    const view = migrateView({ id: 'view-defaults', name: 'Draft', query: { source: '' }, renderer: 'table', sort: [], fields: [], list: 'Health', creationDefaults: { priority: 3, tags: ['work'], location: 'Office', attachments: [{ id: 'brief', url: 'https://example.com/brief.pdf' }], 'schedule.estimatedDuration': 'PT10M', 'custom.client': 'Acme' }, statistics: { showTime: false, reservedItemIds: ['sleep-series'] } }).value;
    expect(view.list).toBe('Health');
    expect(view.creationDefaults).toEqual({ priority: 3, tags: ['work'], location: 'Office', attachments: [{ id: 'brief', url: 'https://example.com/brief.pdf' }], 'schedule.estimatedDuration': 'PT10M', 'custom.client': 'Acme' });
    expect(view.statistics).toEqual({ showTime: false, reservedItemIds: ['sleep-series'] });
    expect(validateViewCreationDefaults({ createdAt: '2026-08-24T10:00:00.000Z' }).valid).toBe(false);
    expect(validateViewCreationDefaults({ relations: [] }).valid).toBe(false);
    expect(() => migrateView({ ...view, creationDefaults: { id: 'old-item' } })).toThrow('not an editable default');
  });

  it('preserves item location and file links through schema migration', () => {
    const item = createItem('Calendar import');
    item.location = 'Room 204';
    item.attachments = [{ id: 'agenda', url: 'https://example.com/agenda.pdf', title: 'Agenda' }];
    const migrated = migrateItem({ ...item, schemaVersion: '1.18.0' }).value;
    expect(migrated.location).toBe('Room 204');
    expect(migrated.attachments).toEqual(item.attachments);
    expect(migrated.schemaVersion).toBe('1.19.0');
  });

  it('restores list membership hidden by the older strict schema', () => {
    const legacy = createItem('Legacy list item');
    legacy.extensions = { 'schema:1.8.0': { list: 'Family' } };
    expect(migrateItem(legacy).value.list).toBe('Family');
    const legacyView = { id: 'legacy-list-view', name: 'Family', query: { source: '' }, renderer: 'list', sort: [], fields: [], extensions: { 'schema:1.8.0': { list: 'Family' } } };
    expect(migrateView(legacyView).value.list).toBe('Family');
  });

  it('sorts by multiple safe DSL expressions with explicit null placement', () => {
    const low = createItem('item 10'); low.priority = 2;
    const high = createItem('Item 2'); high.priority = 4;
    const missing = createItem('No priority');
    const source = 'priority desc nulls last\nlower(title) asc nulls last';
    const rules = parseSortSource(source);
    expect(serializeSortRules(rules)).toBe(source);
    expect([missing, low, high].sort(compileSort(source)).map((item) => item.title)).toEqual(['Item 2', 'item 10', 'No priority']);
    expect(() => parseSortSource('priority sideways')).toThrow('Invalid sort rule');
    expect(() => parseSortSource('fetch(title) asc')).not.toThrow();
    expect(() => [low, high].sort(compileSort('fetch(title) asc'))).toThrow('Function is not allowed');
  });

  it('removes reminder duplicates that resolve to the same visible minute', () => {
    const item = createItem('Reminder');
    item.reminders = [
      { id: 'first', mode: 'absolute', at: '2026-08-13T09:00:05.000Z', urgency: 'urgent', repeatUntilAcknowledged: false },
      { id: 'duplicate', mode: 'absolute', at: '2026-08-13T09:00:55.000Z', urgency: 'urgent', repeatUntilAcknowledged: false },
      { id: 'different', mode: 'absolute', at: '2026-08-13T09:00:55.000Z', urgency: 'critical', repeatUntilAcknowledged: false },
    ];
    expect(removeDuplicateReminders(item)).toBe(1);
    expect(item.reminders.map((reminder) => reminder.id)).toEqual(['first', 'different']);
  });
});

describe('portable tabular and calendar formats', () => {
  it('round-trips UTM item data through CSV rows and protects spreadsheet formulas', () => {
    const workspace = createWorkspace('Portable'); const item = createItem('=Not a formula');
    item.bodyMarkdown = 'Private notes'; item.tags = ['work']; item.custom.cost = 12;
    item.scripts = [{ id: 'script-portable', key: 'minutes_left', label: 'Minutes left', source: 'minutesUntil(schedule.startAt)', resultKind: 'number' }];
    item.schedule = { timezone: 'UTC', startAt: '2026-08-24T12:00:00.000Z' };
    workspace.items[item.id] = item;
    const portable = createPortablePackage(workspace, { kind: 'items', items: [item], selection: { type: 'single_item', itemId: item.id } });
    const table = packageToTabular(portable); const csv = toCsv(table.items);
    expect(csv).toContain("'=Not a formula");
    const parsed = tabularToPackage({ items: parseCsv(csv), customFields: table.customFields }, workspace).package;
    expect(parsed.items[0]?.title).toBe('=Not a formula');
    expect(parsed.items[0]?.custom.cost).toBe(12);
    expect(parsed.items[0]?.scripts).toEqual(item.scripts);
  });

  it('turns unknown tabular columns into custom fields', () => {
    const workspace = createWorkspace('Portable');
    const result = tabularToPackage({ items: [{ title: 'Call mom', effort: '3', location: 'Home' }] }, workspace);
    expect(result.package.items[0]?.custom.effort).toBe(3);
    expect(Object.values(result.package.customFields).map((field) => field.key)).toEqual(expect.arrayContaining(['effort', 'location']));
  });

  it('stores otherwise unsupported UTM item data in iCalendar metadata when requested', () => {
    const source = createWorkspace('ICS'); const item = createItem('Calendar item');
    item.custom.note = 'keep me'; item.contexts = ['home']; item.reminders = [{ id: 'r', mode: 'absolute', at: '2026-08-20T09:00:00.000Z', urgency: 'normal', repeatUntilAcknowledged: false }];
    source.items[item.id] = item;
    const full = toICS(source, { includeUtmMetadata: true }).ics;
    const target = createWorkspace('Target'); fromICS(full, target);
    expect(target.items[item.id]?.custom.note).toBe('keep me');
    expect(target.items[item.id]?.contexts).toEqual(['home']);
    expect(target.items[item.id]?.reminders).toHaveLength(1);
  });

  it('uses a standard VEVENT for a scheduled item without an explicit end', () => {
    const source = createWorkspace('ICS'); const item = createItem('Call mom');
    item.schedule = { timezone: 'UTC', startAt: '2026-08-21T10:00:00.000Z' }; source.items[item.id] = item;
    const ics = toICS(source).ics;
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('STATUS:CONFIRMED');
    expect(ics).not.toContain('STATUS:NEEDS-ACTION');
  });
});

describe('recurrence and auto-renew', () => {
  it('materializes the first daily rolling occurrence as soon as its activation window opens', () => {
    const workspace = createWorkspace('Daily rolling', new Date('2026-08-31T15:09:53.717Z'));
    const item = createItem('Oooo', 'event', new Date('2026-08-31T11:31:20.123Z'));
    item.schedule = { timezone: 'Europe/Moscow', startAt: '2026-08-31T20:00:00.000Z', endAt: '2026-08-31T21:00:00.000Z', estimatedDuration: 'PT1H' };
    const series = makeSeries(item, 'FREQ=DAILY;INTERVAL=1', { activationOffset: 'P7D', autoRenew: true, closeAt: 'next_activation' });
    workspace.items[series.id] = series;
    reconcileRecurrences(workspace, new Date('2026-08-31T15:09:53.717Z'));
    const occurrences = Object.values(workspace.items).filter((candidate) => candidate.occurrence?.seriesId === series.id);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.schedule?.startAt).toBe('2026-08-31T20:00:00.000Z');
    const updatedAt = workspace.updatedAt;
    reconcileRecurrences(workspace, new Date('2026-08-31T15:10:53.717Z'));
    expect(workspace.updatedAt).toBe(updatedAt);
  });
  it('repairs a current occurrence that an older build auto-closed before its event', () => {
    const now = new Date('2026-08-31T15:25:40.007Z');
    const workspace = createWorkspace('Legacy daily rolling', now);
    const item = createItem('Sleep', 'event', new Date('2026-08-31T14:59:27.245Z'));
    item.schedule = { timezone: 'Europe/Moscow', startAt: '2026-08-31T19:00:00.000Z', endAt: '2026-08-31T20:00:00.000Z', estimatedDuration: 'PT1H' };
    const series = makeSeries(item, 'FREQ=DAILY;INTERVAL=1', { activationOffset: 'P7D', autoRenew: true, closeAt: 'next_activation' });
    series.revision = 7;
    workspace.items[series.id] = series;
    const occurrence = createOccurrence(series, new Date('2026-08-31T19:00:00.000Z'), 0);
    occurrence.state = 'auto_closed';
    occurrence.occurrence!.templateRevision = 4;
    occurrence.closure = { actor: 'system', at: '2026-08-25T19:00:00.000Z', reason: 'auto_renew' };
    occurrence.cycleHistory = [{
      actor: 'system', availableFrom: occurrence.schedule!.availableFrom, closedAt: occurrence.closure.at,
      endAt: occurrence.schedule!.endAt, reason: 'auto_renew', recurrenceId: occurrence.occurrence!.recurrenceId,
      startAt: occurrence.schedule!.startAt, state: 'auto_closed',
    }];
    workspace.items[occurrence.id] = occurrence;

    const result = reconcileRecurrences(workspace, now);
    const repaired = workspace.items[occurrence.id]!;
    expect(repaired.state).toBe('open');
    expect(repaired.closure).toBeUndefined();
    expect(repaired.occurrence?.templateRevision).toBe(7);
    expect(repaired.cycleHistory).toEqual([]);
    expect(result.updated.map((entry) => entry.id)).toContain(occurrence.id);
  });
  it('keeps a local series at the same wall-clock time across DST', () => {
    const item = createItem('Berlin weekly');
    // 09:00 in Berlin, one week before the 2026 spring DST transition.
    item.schedule = { timezone: 'Europe/Berlin', startAt: '2026-03-22T08:00:00.000Z' };
    const series = makeSeries(item, 'FREQ=WEEKLY;COUNT=3', { timezone: 'Europe/Berlin' });
    expect(buildRecurrenceRule(series).all().map((date) => date.toISOString())).toEqual([
      '2026-03-22T08:00:00.000Z',
      '2026-03-29T07:00:00.000Z',
      '2026-04-05T07:00:00.000Z',
    ]);
  });

  it('materializes a due-only recurring item without inventing a scheduled start', () => {
    const now = new Date('2026-08-28T10:00:00.000Z');
    const workspace = createWorkspace('Due-only recurrence', now);
    const item = createItem('Weekly deadline', 'task', now);
    item.schedule = { timezone: 'UTC', dueAt: '2026-08-28T11:00:00.000Z' };
    const series = makeSeries(item, 'FREQ=WEEKLY', { activationOffset: 'P3D' });
    workspace.items[series.id] = series;

    const result = reconcileRecurrences(workspace, now);
    expect(result.created).toHaveLength(1);
    expect(result.created[0]!.schedule?.startAt).toBeUndefined();
    expect(result.created[0]!.schedule?.dueAt).toBe('2026-08-28T11:00:00.000Z');
  });

  it('keeps a recurring habit as one item and stores only completed dates', () => {
    const workspace = createWorkspace('Habits', new Date('2026-08-01T00:00:00.000Z'));
    const habit = createItem('Daily walk', 'habit', new Date('2026-08-01T00:00:00.000Z'));
    habit.schedule = { timezone: 'UTC', startAt: '2026-08-01T08:00:00.000Z' };
    const series = makeSeries(habit, 'FREQ=DAILY');
    workspace.items[series.id] = series;

    const result = reconcileRecurrences(workspace, new Date('2026-08-20T09:00:00.000Z'));
    expect(result.created).toHaveLength(0);
    expect(Object.values(workspace.items)).toHaveLength(1);
    expect(workspace.items[series.id]!.habit?.completedDates).toEqual([]);

    const legacy = createOccurrence(series, new Date('2026-08-19T08:00:00.000Z'), 18);
    legacy.state = 'done'; workspace.items[legacy.id] = legacy;
    reconcileRecurrences(workspace, new Date('2026-08-20T10:00:00.000Z'));
    expect(Object.values(workspace.items)).toHaveLength(1);
    expect(workspace.items[series.id]!.habit?.completedDates).toEqual(['2026-08-19']);
    expect(workspace.tombstones[legacy.id]).toBeTruthy();
  });

  it('starts the next completion-anchored cycle from the recorded close time', () => {
    const workspace = createWorkspace('Completion anchor');
    const item = createItem('Water plants');
    item.schedule = { timezone: 'UTC', startAt: '2026-08-20T09:00:00.000Z' };
    const series = makeSeries(item, 'FREQ=DAILY', { anchor: 'completion', activationOffset: 'PT0M' });
    workspace.items[series.id] = series;
    const occurrence = createOccurrence(series, new Date('2026-08-20T09:00:00.000Z'), 0);
    occurrence.state = 'done';
    occurrence.closure = { at: '2026-08-20T16:30:00.000Z', actor: 'user', reason: 'manual' };
    workspace.items[occurrence.id] = occurrence;

    expect(advanceCompletionAnchoredSeries(workspace, occurrence, occurrence.closure.at)).toBe(true);
    expect(workspace.items[series.id]!.schedule?.startAt).toBe('2026-08-21T16:30:00.000Z');
    expect(workspace.items[occurrence.id]!.closure?.at).toBe('2026-08-20T16:30:00.000Z');
  });

  it('keeps one rolling weekly item and records missed cycles inside it', () => {
    const workspace = createWorkspace('Test', new Date('2026-07-01T00:00:00.000Z'));
    const base = createItem('Prepare material by Thursday', 'task', new Date('2026-07-01T00:00:00.000Z'));
    base.schedule = { timezone: 'Europe/Moscow', startAt: '2026-07-02T15:00:00.000Z', dueAt: '2026-07-02T18:00:00.000Z' };
    const series = makeSeries(base, 'FREQ=WEEKLY;BYDAY=TH', { activationOffset: 'P7D', closeAt: 'next_activation', autoRenew: true });
    workspace.items[series.id] = series;

    const first = reconcileRecurrences(workspace, new Date('2026-07-30T12:00:00.000Z'));
    const occurrences = Object.values(workspace.items).filter((item) => item.role === 'occurrence');
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.state).toBe('open');
    expect(occurrences[0]!.cycleHistory).toHaveLength(4);
    expect(occurrences[0]!.cycleHistory?.every((cycle) => cycle.state === 'auto_closed' && cycle.actor === 'system')).toBe(true);
    expect(occurrences.every((item) => item.createdWithVersion === APP_VERSION)).toBe(true);

    const second = reconcileRecurrences(workspace, new Date('2026-07-30T12:00:00.000Z'));
    expect(second.created).toHaveLength(0);
    expect(second.autoClosed).toHaveLength(0);
    expect(first.created).toHaveLength(1);
    expect(second.updated).toHaveLength(0);
  });

  it('shows one weekly item only inside its active window and shifts its reminders', () => {
    const workspace = createWorkspace('Active windows', new Date('2026-08-01T00:00:00.000Z'));
    const item = createItem('Prepare lessons', 'task', new Date('2026-08-01T00:00:00.000Z'));
    item.schedule = { timezone: 'UTC', startAt: '2026-08-17T00:00:00.000Z', dueAt: '2026-08-20T18:00:00.000Z' };
    item.reminders = [{ id: 'window-reminder', mode: 'absolute', at: '2026-08-17T09:00:00.000Z', urgency: 'normal', repeatUntilAcknowledged: false }];
    const series = makeSeries(item, 'FREQ=WEEKLY;BYDAY=MO', { activationOffset: 'PT0M', closeAt: 'due', autoRenew: true });
    workspace.items[series.id] = series;

    reconcileRecurrences(workspace, new Date('2026-08-16T12:00:00.000Z'));
    expect(Object.values(workspace.items).filter((entry) => entry.role === 'occurrence')).toHaveLength(0);

    reconcileRecurrences(workspace, new Date('2026-08-18T12:00:00.000Z'));
    let occurrences = Object.values(workspace.items).filter((entry) => entry.role === 'occurrence');
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.state).toBe('open');
    expect(occurrences[0]!.reminders[0]!.at).toBe('2026-08-17T09:00:00.000Z');

    reconcileRecurrences(workspace, new Date('2026-08-21T12:00:00.000Z'));
    occurrences = Object.values(workspace.items).filter((entry) => entry.role === 'occurrence');
    const stableId = occurrences[0]!.id;
    expect(occurrences.filter((entry) => entry.state === 'open')).toHaveLength(0);
    expect(occurrences[0]!.state).toBe('auto_closed');
    expect(occurrences[0]!.cycleHistory).toHaveLength(1);

    reconcileRecurrences(workspace, new Date('2026-08-24T00:01:00.000Z'));
    occurrences = Object.values(workspace.items).filter((entry) => entry.role === 'occurrence');
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.id).toBe(stableId);
    expect(occurrences.filter((entry) => entry.state === 'open')).toHaveLength(1);
    expect(occurrences.find((entry) => entry.state === 'open')!.reminders[0]!.at).toBe('2026-08-24T09:00:00.000Z');
    expect(occurrences[0]!.cycleHistory).toHaveLength(1);
  });

  it('refreshes every inherited View field after its live series is edited', () => {
    const workspace = createWorkspace('Live view refresh', new Date('2026-08-01T00:00:00.000Z'));
    const item = createItem('Prepare lessons', 'task', new Date('2026-08-01T00:00:00.000Z'));
    item.schedule = { timezone: 'UTC', startAt: '2026-08-24T09:00:00.000Z', endAt: '2026-08-24T10:00:00.000Z', dueAt: '2026-08-24T18:00:00.000Z' };
    const series = makeSeries(item, 'FREQ=WEEKLY;BYDAY=MO', { activationOffset: 'PT0M', closeAt: 'due', autoRenew: true });
    workspace.items[series.id] = series;

    reconcileRecurrences(workspace, new Date('2026-08-24T12:00:00.000Z'));
    const before = Object.values(workspace.items).find((entry) => entry.occurrence?.seriesId === series.id)!;
    const stableId = before.id;
    expect(before.schedule?.dueAt).toBe('2026-08-24T18:00:00.000Z');

    series.schedule!.endAt = '2026-08-24T11:30:00.000Z';
    series.schedule!.dueAt = '2026-08-24T20:30:00.000Z';
    series.schedule!.estimatedDuration = 'PT2H';
    series.title = 'Prepare updated lessons';
    series.bodyMarkdown = 'Use the revised outline.';
    series.priority = 4;
    series.tags = ['school', 'urgent'];
    series.contexts = ['laptop'];
    series.list = 'Teaching';
    series.custom = { course: 'Mathematics' };
    series.progress = { mode: 'counter', current: 2, target: 5, unit: 'chapters' };
    series.reminders = [{ id: 'updated-reminder', mode: 'relative', relativeTo: 'start', offset: '-PT30M', urgency: 'urgent', repeatUntilAcknowledged: false }];
    series.revision += 1;
    series.updatedAt = '2026-08-24T12:01:00.000Z';
    reconcileRecurrences(workspace, new Date('2026-08-24T12:01:00.000Z'));

    const after = Object.values(workspace.items).find((entry) => entry.occurrence?.seriesId === series.id)!;
    expect(after.id).toBe(stableId);
    expect(after.schedule?.endAt).toBe('2026-08-24T11:30:00.000Z');
    expect(after.schedule?.dueAt).toBe('2026-08-24T20:30:00.000Z');
    expect(after.schedule?.estimatedDuration).toBe('PT2H');
    expect(after).toMatchObject({
      title: 'Prepare updated lessons',
      bodyMarkdown: 'Use the revised outline.',
      priority: 4,
      tags: ['school', 'urgent'],
      contexts: ['laptop'],
      list: 'Teaching',
      custom: { course: 'Mathematics', __closeAt: 'due' },
      progress: { mode: 'counter', current: 2, target: 5, unit: 'chapters' },
      reminders: [{ id: 'updated-reminder', mode: 'relative', relativeTo: 'start', offset: '-PT30M', urgency: 'urgent', repeatUntilAcknowledged: false }],
    });
    expect(after.occurrence?.templateRevision).toBe(series.revision);
  });

  it('collapses legacy auto-renew duplicates into one stable item without losing outcomes', () => {
    const workspace = createWorkspace('Legacy rolling series', new Date('2026-08-01T00:00:00.000Z'));
    const item = createItem('Call mom', 'task', new Date('2026-08-01T00:00:00.000Z'));
    item.schedule = { timezone: 'UTC', startAt: '2026-08-07T09:00:00.000Z', dueAt: '2026-08-09T18:00:00.000Z' };
    const series = makeSeries(item, 'FREQ=WEEKLY;BYDAY=FR', { activationOffset: 'PT0M', closeAt: 'due', autoRenew: true });
    workspace.items[series.id] = series;

    const first = createOccurrence(series, new Date('2026-08-07T09:00:00.000Z'), 0);
    first.state = 'done';
    first.closure = { at: '2026-08-08T12:00:00.000Z', actor: 'user', reason: 'manual' };
    const second = createOccurrence(series, new Date('2026-08-14T09:00:00.000Z'), 1);
    second.state = 'auto_closed';
    second.closure = { at: '2026-08-16T18:00:00.000Z', actor: 'system', reason: 'auto_renew' };
    const latest = createOccurrence(series, new Date('2026-08-21T09:00:00.000Z'), 2);
    workspace.items[first.id] = first;
    workspace.items[second.id] = second;
    workspace.items[latest.id] = latest;

    const result = reconcileRecurrences(workspace, new Date('2026-08-22T12:00:00.000Z'));
    const occurrences = Object.values(workspace.items).filter((entry) => entry.occurrence?.seriesId === series.id);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.id).toBe(latest.id);
    expect(occurrences[0]!.state).toBe('open');
    expect(occurrences[0]!.cycleHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ recurrenceId: '2026-08-07T09:00:00.000Z', state: 'done', actor: 'user' }),
      expect.objectContaining({ recurrenceId: '2026-08-14T09:00:00.000Z', state: 'auto_closed', actor: 'system' }),
    ]));
    expect(result.removedIds.sort()).toEqual([first.id, second.id].sort());
  });

  it('handles end-of-month rules and exclusions', () => {
    const workspace = createWorkspace();
    const item = createItem('Month end');
    item.schedule = { timezone: 'UTC', startAt: '2026-01-31T09:00:00.000Z' };
    const series = makeSeries(item, 'FREQ=MONTHLY;BYMONTHDAY=-1', { exdates: ['2026-02-28T09:00:00.000Z'], activationOffset: 'P1D' });
    workspace.items[series.id] = series;
    reconcileRecurrences(workspace, new Date('2026-04-01T00:00:00.000Z'));
    const recurrenceIds = Object.values(workspace.items).flatMap((candidate) => candidate.occurrence?.recurrenceId ?? []);
    expect(recurrenceIds.some((value) => value.startsWith('2026-02-28'))).toBe(false);
    expect(recurrenceIds.some((value) => value.startsWith('2026-03-31'))).toBe(true);
  });
});

describe('calendar projection and mutations', () => {
  it('projects future recurrence without creating workspace items, then materializes on interaction', () => {
    const workspace = createWorkspace(); const item = createItem('Weekly');
    item.schedule = { timezone: 'Europe/Moscow', startAt: '2026-10-20T07:00:00.000Z', endAt: '2026-10-20T08:00:00.000Z' };
    const series = makeSeries(item, 'FREQ=WEEKLY;COUNT=4'); workspace.items[series.id] = series;
    const before = Object.keys(workspace.items).length;
    const rows = projectOccurrences(workspace, new Date('2026-10-19T00:00:00Z'), new Date('2026-11-20T00:00:00Z'));
    expect(rows).toHaveLength(4); expect(rows.every((row) => row.virtual)).toBe(true); expect(Object.keys(workspace.items)).toHaveLength(before);
    const materialized = materializeProjectedOccurrence(workspace, rows[1]!);
    expect(materialized.role).toBe('occurrence'); expect(Object.keys(workspace.items)).toHaveLength(before + 1);
  });

  it('moves a mixed calendar group by one delta and restores it atomically', () => {
    const workspace = createWorkspace();
    const timed = createItem('Timed'); timed.schedule = { timezone: 'UTC', startAt: '2026-08-13T08:00:00Z', endAt: '2026-08-13T09:00:00Z' };
    const due = createItem('Due'); due.schedule = { timezone: 'UTC', dueAt: '2026-08-14T10:00:00Z' };
    workspace.items[timed.id] = timed; workspace.items[due.id] = due;
    const result = moveCalendarItems(workspace, [timed.id, due.id], 86_400_000);
    expect(timed.schedule.startAt).toContain('2026-08-14'); expect(due.schedule.dueAt).toContain('2026-08-15');
    restoreCalendarSchedules(workspace, result.before);
    expect(timed.schedule.startAt).toContain('2026-08-13'); expect(due.schedule.dueAt).toContain('2026-08-14');
  });

  it('resizes both visible boundaries of a timed item', () => {
    const workspace = createWorkspace(); const item = createItem('Resizable');
    item.schedule = { timezone: 'UTC', startAt: '2026-08-13T08:00:00Z', endAt: '2026-08-13T09:00:00Z' };
    workspace.items[item.id] = item;
    resizeCalendarItem(workspace, item.id, '2026-08-13T10:00:00Z', new Date('2026-08-13T07:00:00Z'), '2026-08-13T07:30:00Z');
    expect(item.schedule.startAt).toBe('2026-08-13T07:30:00Z');
    expect(item.schedule.endAt).toBe('2026-08-13T10:00:00Z');
  });

  it('supports this occurrence and this-and-future recurrence moves', () => {
    const workspace = createWorkspace(); const item = createItem('Series'); item.schedule = { timezone: 'UTC', startAt: '2026-08-13T08:00:00Z' };
    const series = makeSeries(item, 'FREQ=WEEKLY;COUNT=8'); workspace.items[series.id] = series;
    const projected = projectOccurrences(workspace, new Date('2026-08-01'), new Date('2026-10-31'));
    moveRecurringOccurrence(workspace, projected[1]!, 3_600_000, 'this_occurrence');
    expect(Object.values(workspace.items).some((entry) => entry.recurrenceOverride?.kind === 'this_occurrence')).toBe(true);
    moveRecurringOccurrence(workspace, projected[3]!, 86_400_000, 'this_and_future');
    expect(Object.values(workspace.items).some((entry) => entry.recurrenceOverride?.kind === 'future_split')).toBe(true);
  });
});

describe('automation engine', () => {
  it('applies allowlisted actions and logs an idempotent run', () => {
    const workspace = createWorkspace();
    const item = createItem('Urgent'); item.priority = 4; workspace.items[item.id] = item;
    const rule: AutomationRule = {
      id: createId(), name: 'Tag urgent', enabled: true, trigger: { type: 'item.created' },
      condition: { source: 'priority >= 4' }, actions: [{ type: 'set_field', path: 'custom.bucket', value: 'urgent' }],
      missedPolicy: 'run_each', maxDepth: 3, cooldownMs: 0,
    };
    workspace.automations[rule.id] = rule;
    const event: DomainEvent = { id: 'event-1', type: 'item.created', at: item.createdAt, itemId: item.id, after: item, causationId: 'cause-1', depth: 0 };
    expect(runAutomationEvents(workspace, [event]).actionsApplied).toBe(1);
    expect(workspace.items[item.id]!.custom.bucket).toBe('urgent');
    expect(runAutomationEvents(workspace, [event]).actionsApplied).toBe(0);
  });

  it('disables a looping rule at its depth limit', () => {
    const workspace = createWorkspace();
    const item = createItem('Loop'); workspace.items[item.id] = item;
    const rule: AutomationRule = {
      id: createId(), name: 'Loop', enabled: true, trigger: { type: 'item.updated' }, condition: { source: 'true' },
      actions: [{ type: 'set_field', path: 'custom.loop', value: true }], missedPolicy: 'run_each', maxDepth: 2, cooldownMs: 0,
    };
    workspace.automations[rule.id] = rule;
    runAutomationEvents(workspace, [{ id: 'loop-1', type: 'item.updated', at: item.createdAt, itemId: item.id, causationId: 'loop', depth: 0 }]);
    expect(workspace.automations[rule.id]!.enabled).toBe(false);
    expect(workspace.automationLog.some((entry) => entry.outcome === 'loop_blocked')).toBe(true);
  });
});

describe('interoperability', () => {
  it('quarantines legacy recurrence without an anchor instead of blocking the workspace', () => {
    const old = createWorkspace('Legacy recurrence');
    old.schemaVersion = '1.17.0';
    const item = createItem('Broken series');
    item.role = 'series_template';
    item.recurrence = { rrule: 'FREQ=DAILY', rdates: [], exdates: [], timezone: 'UTC', activationOffset: 'P0D', closeAt: 'next_activation', anchor: 'schedule', autoRenew: true };
    delete item.schedule;
    old.items[item.id] = item;
    const migrated = migrateWorkspace(old).value;
    expect(migrated.items[item.id]).toMatchObject({ role: 'standalone', title: 'Broken series' });
    expect(migrated.items[item.id]?.recurrence).toBeUndefined();
    expect(migrated.items[item.id]?.extensions?.quarantine).toMatchObject({ recurrence: { rrule: 'FREQ=DAILY' } });
    expect(migrated.migrationIssues).toContainEqual(expect.objectContaining({ entityId: item.id, code: 'recurrence_missing_anchor', disabledCapability: 'recurrence', status: 'needs_repair' }));
    expect(() => reconcileRecurrences(migrated)).not.toThrow();
  });

  it('migrates 1.0 JSON and keeps unknown item fields in a namespaced extension', () => {
    const old = createWorkspace();
    old.schemaVersion = '1.0.0';
    delete (old as Partial<typeof old>).listDefinitions;
    delete (old.calendarPreferences as Partial<typeof old.calendarPreferences>).sleepSchedule;
    // A previously shipped UI briefly stored view-only state here. Unlock must
    // migrate it away rather than rejecting the whole local workspace.
    (old.calendarPreferences as typeof old.calendarPreferences & { staleUiFlag?: boolean }).staleUiFlag = true;
    const item = createItem('Old item') as UniversalItem & { foreignFlag?: string };
    item.schemaVersion = '1.0.0'; item.foreignFlag = 'preserve me'; item.list = 'Health'; old.items[item.id] = item;
    const legacyView = Object.values(old.views)[0]!; legacyView.list = 'Health';
    const legacyHabit = createItem('Legacy habit');
    legacyHabit.habit = { target: 1, unit: 'times', streakMode: 'manual_only', completedDates: [] };
    delete (legacyHabit.habit as Partial<NonNullable<UniversalItem['habit']>>).completedDates;
    old.items[legacyHabit.id] = legacyHabit;
    const migrated = fromCanonicalJSON(JSON.stringify(old));
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.listDefinitions.Health).toMatchObject({ name: 'Health', kind: 'list', priority: 0, createdAt: item.createdAt });
    expect(migrated.views[legacyView.id]?.list).toBe('Health');
    expect(migrated.calendarPreferences.sleepSchedule).toEqual({ wake: '08:00', sleep: '22:00' });
    expect(migrated.calendarPreferences.language).toBe('en');
    expect(migrated.calendarPreferences.diagnosticsEnabled).toBe(true);
    expect(migrated.calendarPreferences.showExplanations).toBe(false);
    expect(migrated.calendarPreferences.appearance).toEqual({ mode: 'system', lightAt: '07:00', darkAt: '20:00', tickSound: true, uiSound: true, soundDefaultsVersion: 1 });
    expect((migrated.calendarPreferences as typeof migrated.calendarPreferences & { staleUiFlag?: boolean }).staleUiFlag).toBeUndefined();
    expect(migrated.items[item.id]!.extensions?.['schema:1.0.0']).toEqual({ foreignFlag: 'preserve me' });
    expect(migrated.items[legacyHabit.id]!.habit?.completedDates).toEqual([]);
    expect(validateWorkspace(migrated).valid).toBe(true);
  });

  it('adds a stable View order to workspaces created before View drag-and-drop', () => {
    const old = createWorkspace('Legacy View order');
    delete (old as Partial<typeof old>).viewOrder;
    // Older workspaces used the same schema version, so they must remain
    // exportable while the app adds this convenience field on its next save.
    expect(validateWorkspace(old).valid).toBe(true);
    const migrated = migrateWorkspace(old).value;
    expect(migrated.viewOrder.map((id) => migrated.views[id]?.name)).toEqual(['Today', 'This week', 'All items']);
    expect(validateWorkspace(migrated).valid).toBe(true);
  });

  it('splits legacy PARA lists into independent Area and Project fields', () => {
    const old = createWorkspace('Legacy PARA');
    const areaItem = createItem('Area item'); areaItem.list = 'Work'; old.items[areaItem.id] = areaItem;
    const projectItem = createItem('Project item'); projectItem.list = 'Vehicle repair'; old.items[projectItem.id] = projectItem;
    const areaView = { ...Object.values(old.views)[0]!, id: createId(), name: 'Work', list: 'Work' };
    const projectView = { ...Object.values(old.views)[0]!, id: createId(), name: 'Vehicle repair', list: 'Vehicle repair' };
    old.views[areaView.id] = areaView; old.views[projectView.id] = projectView;
    old.listDefinitions.Work = { name: 'Work', kind: 'area', priority: 4, createdAt: areaItem.createdAt, updatedAt: areaItem.updatedAt };
    old.listDefinitions['Vehicle repair'] = { name: 'Vehicle repair', kind: 'project', priority: 3, createdAt: projectItem.createdAt, updatedAt: projectItem.updatedAt };
    (old as unknown as { schemaVersion: string; organizationPreferences: unknown }).schemaVersion = '1.9.0';
    (old as unknown as { organizationPreferences: unknown }).organizationPreferences = { unassignedAreaPriority: 0, unassignedProjectPriority: 0, tagPriorities: {} };
    delete (old as Partial<typeof old>).areaDefinitions; delete (old as Partial<typeof old>).projectDefinitions;
    const migrated = fromCanonicalJSON(JSON.stringify(old));
    expect(migrated.items[areaItem.id]).toMatchObject({ areas: ['Work'] });
    expect(migrated.items[areaItem.id]?.list).toBeUndefined();
    expect(migrated.items[projectItem.id]).toMatchObject({ projects: ['Vehicle repair'] });
    expect(migrated.views[areaView.id]).toMatchObject({ area: 'Work' });
    expect(migrated.views[projectView.id]).toMatchObject({ project: 'Vehicle repair' });
    expect(migrated.areaDefinitions.Work?.name).toBe('Work');
    expect(migrated.projectDefinitions['Vehicle repair']?.name).toBe('Vehicle repair');
    expect(migrated.organizationPreferences.areaOrder.indexOf('Work')).toBeLessThan(migrated.organizationPreferences.areaOrder.indexOf(null));
    expect(migrated.organizationPreferences.projectOrder.indexOf('Vehicle repair')).toBeLessThan(migrated.organizationPreferences.projectOrder.indexOf(null));
  });

  it('exports a validated portable package and imports conflicts only as copies', () => {
    const source = createWorkspace('Source'); const item = createItem('Portable'); source.items[item.id] = item;
    source.customFields.price = { id: 'price', key: 'price', label: 'Price', kind: 'number', required: false };
    item.custom.price = 42;
    const json = serializePortablePackage(createPortablePackage(source, { kind: 'items', items: [item], selection: { type: 'single_item', itemId: item.id } }));
    expect(parsePortablePackage(json).package.items).toHaveLength(1);
    const target = createWorkspace('Target'); target.items[item.id] = createItem('Local');
    const preview = buildPortableImportPreview(json, target);
    expect(preview.items[0]!.choice).toBe('skip');
    preview.items[0]!.choice = 'copy';
    const result = applyPortableImport(target, preview);
    expect(result.copiedItems).toBe(1);
    expect(Object.values(target.items).some((entry) => entry.title === 'Portable' && entry.id !== item.id)).toBe(true);
  });

  it('validates an individual item after moving unknown JSON into extensions', () => {
    const item = { ...createItem('Foreign'), futureField: { useful: true } };
    const migrated = migrateItem(item, 'vendor:test').value;
    expect(migrated.extensions?.['vendor:test']).toEqual({ futureField: { useful: true } });
  });

  it('validates and re-imports iCalendar by stable UID', () => {
    const source = createWorkspace();
    const item = createItem('Calendar item', 'event');
    item.schedule = { timezone: 'UTC', startAt: '2026-08-12T10:00:00.000Z', endAt: '2026-08-12T11:00:00.000Z' };
    source.items[item.id] = item;
    const ics = toICS(source).ics;
    expect(ics).toContain(`X-UTM-CREATED-WITH-APP-ID:${APP_ID}`);
    expect(ics).toContain(`X-UTM-CREATED-WITH-APP-NAME:${APP_NAME}`);
    expect(ics).toContain(`X-UTM-CREATED-WITH-VERSION:${APP_VERSION}`);
    const target = createWorkspace();
    expect(fromICS(ics, target).imported).toBe(1);
    expect(fromICS(ics, target).updated).toBe(1);
    expect(Object.keys(target.items)).toHaveLength(1);
    expect(target.items[item.id]?.createdWithAppId).toBe(APP_ID);
    expect(target.items[item.id]?.createdWithAppName).toBe(APP_NAME);
    expect(target.items[item.id]?.createdWithVersion).toBe(APP_VERSION);
    expect(validateWorkspace(target).valid).toBe(true);
  });
});
