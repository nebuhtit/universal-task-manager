import { describe, expect, it } from 'vitest';
import {
  APP_ID, APP_NAME, APP_RELEASED_AT, APP_VERSION, advanceCompletionAnchoredSeries, applyPortableImport, backfillItemCreationVersions, buildPortableImportPreview, buildRecurrenceRule,
  compileQuery, compileSort, createId, createItem, createOccurrence, createPortablePackage, createWorkspace, evaluateFormulas, fromCanonicalJSON, fromICS, makeSeries,
  materializeProjectedOccurrence, migrateItem, moveCalendarItems, moveRecurringOccurrence, parseExpression, parsePortablePackage, parseSortSource,
  projectOccurrences, reconcileRecurrences, removeDuplicateReminders, resizeCalendarItem, restoreCalendarSchedules, runAutomationEvents,
  packageToTabular, parseCsv, serializePortablePackage, serializeSortRules, tabularToPackage, toCsv, toICS, validateWorkspace,
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

  it('detects formula cycles', () => {
    const result = evaluateFormulas(createItem('Cost'), [
      { id: 'a', key: 'a', label: 'A', kind: 'formula', required: false, formula: 'custom.b + 1' },
      { id: 'b', key: 'b', label: 'B', kind: 'formula', required: false, formula: 'custom.a + 1' },
    ]);
    expect(Object.values(result.errors).join(' ')).toContain('cycle');
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
    workspace.items[item.id] = item;
    const portable = createPortablePackage(workspace, { kind: 'items', items: [item], selection: { type: 'single_item', itemId: item.id } });
    const table = packageToTabular(portable); const csv = toCsv(table.items);
    expect(csv).toContain("'=Not a formula");
    const parsed = tabularToPackage({ items: parseCsv(csv), customFields: table.customFields }, workspace).package;
    expect(parsed.items[0]?.title).toBe('=Not a formula');
    expect(parsed.items[0]?.custom.cost).toBe(12);
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

  it('preserves every missed weekly cycle and keeps the latest fresh', () => {
    const workspace = createWorkspace('Test', new Date('2026-07-01T00:00:00.000Z'));
    const base = createItem('Prepare material by Thursday', 'task', new Date('2026-07-01T00:00:00.000Z'));
    base.schedule = { timezone: 'Europe/Moscow', startAt: '2026-07-02T15:00:00.000Z', dueAt: '2026-07-02T18:00:00.000Z' };
    const series = makeSeries(base, 'FREQ=WEEKLY;BYDAY=TH', { activationOffset: 'P7D', closeAt: 'next_activation', autoRenew: true });
    workspace.items[series.id] = series;

    const first = reconcileRecurrences(workspace, new Date('2026-07-30T12:00:00.000Z'));
    const occurrences = Object.values(workspace.items).filter((item) => item.role === 'occurrence');
    expect(occurrences).toHaveLength(5);
    expect(occurrences.filter((item) => item.state === 'auto_closed')).toHaveLength(4);
    expect(occurrences.filter((item) => item.state === 'open')).toHaveLength(1);
    expect(occurrences.filter((item) => item.closure?.actor === 'system')).toHaveLength(4);
    expect(occurrences.every((item) => item.createdWithVersion === APP_VERSION)).toBe(true);

    const second = reconcileRecurrences(workspace, new Date('2026-07-30T12:00:00.000Z'));
    expect(second.created).toHaveLength(0);
    expect(second.autoClosed).toHaveLength(0);
    expect(first.created).toHaveLength(5);
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
    expect(occurrences.filter((entry) => entry.state === 'open')).toHaveLength(0);
    expect(occurrences[0]!.state).toBe('auto_closed');

    reconcileRecurrences(workspace, new Date('2026-08-24T00:01:00.000Z'));
    occurrences = Object.values(workspace.items).filter((entry) => entry.role === 'occurrence');
    expect(occurrences.filter((entry) => entry.state === 'open')).toHaveLength(1);
    expect(occurrences.find((entry) => entry.state === 'open')!.reminders[0]!.at).toBe('2026-08-24T09:00:00.000Z');
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
  it('migrates 1.0 JSON and keeps unknown item fields in a namespaced extension', () => {
    const old = createWorkspace();
    old.schemaVersion = '1.0.0';
    delete (old.calendarPreferences as Partial<typeof old.calendarPreferences>).sleepSchedule;
    const item = createItem('Old item') as UniversalItem & { foreignFlag?: string };
    item.schemaVersion = '1.0.0'; item.foreignFlag = 'preserve me'; old.items[item.id] = item;
    const legacyHabit = createItem('Legacy habit');
    legacyHabit.habit = { target: 1, unit: 'times', streakMode: 'manual_only', completedDates: [] };
    delete (legacyHabit.habit as Partial<NonNullable<UniversalItem['habit']>>).completedDates;
    old.items[legacyHabit.id] = legacyHabit;
    const migrated = fromCanonicalJSON(JSON.stringify(old));
    expect(migrated.schemaVersion).toBe('1.7.0');
    expect(migrated.calendarPreferences.sleepSchedule).toEqual({ wake: '08:00', sleep: '22:00' });
    expect(migrated.calendarPreferences.language).toBe('en');
    expect(migrated.calendarPreferences.appearance).toEqual({ mode: 'system', lightAt: '07:00', darkAt: '20:00', tickSound: false });
    expect(migrated.items[item.id]!.extensions?.['schema:1.0.0']).toEqual({ foreignFlag: 'preserve me' });
    expect(migrated.items[legacyHabit.id]!.habit?.completedDates).toEqual([]);
    expect(validateWorkspace(migrated).valid).toBe(true);
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
