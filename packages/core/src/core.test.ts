import { describe, expect, it } from 'vitest';
import {
  APP_ID, APP_NAME, APP_RELEASED_AT, APP_VERSION, applyPortableImport, backfillItemCreationVersions, buildPortableImportPreview,
  compileQuery, compileSort, createId, createItem, createPortablePackage, createWorkspace, evaluateFormulas, fromCanonicalJSON, fromICS, makeSeries,
  migrateItem, parseExpression, parsePortablePackage, parseSortSource, reconcileRecurrences, removeDuplicateReminders, runAutomationEvents,
  serializePortablePackage, serializeSortRules, toICS, validateWorkspace,
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
    expect(() => parseExpression('globalThis.fetch("https://example.com")')).not.toThrow();
    expect(() => compileQuery('globalThis.fetch("https://example.com")')(item)).toThrow('Function is not allowed');
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

describe('recurrence and auto-renew', () => {
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
    const item = createItem('Old item') as UniversalItem & { foreignFlag?: string };
    item.schemaVersion = '1.0.0'; item.foreignFlag = 'preserve me'; old.items[item.id] = item;
    const migrated = fromCanonicalJSON(JSON.stringify(old));
    expect(migrated.schemaVersion).toBe('1.1.0');
    expect(migrated.items[item.id]!.extensions?.['schema:1.0.0']).toEqual({ foreignFlag: 'preserve me' });
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
