import { describe, expect, it } from 'vitest';
import { createItem, createWorkspace, reconcileRecurrences } from '@utm/core';
import { duplicateItemDraft, normalizeItemForSave } from './itemEditorModel';

const normalize = (overrides: Partial<Parameters<typeof normalizeItemForSave>[0]> = {}) => {
  const workspace = createWorkspace('Editor'); const item = createItem('  Test item  ', 'task', new Date('2026-08-26T10:00:00Z'));
  return normalizeItemForSave({ item, workspace, tags: 'work, test', contexts: 'desk', isTemplate: false, recurring: false, activeRange: false, repeatFrequency: 'WEEKLY', repeatIntervalDraft: '1', repeatDays: [], now: new Date('2026-08-26T12:00:00Z'), ...overrides });
};
describe('item editor normalization', () => {
  it('duplicates with new identity and creation time but without history or Google link', () => {
    const source = createItem('Meeting', 'task', new Date('2026-08-26T10:00:00Z'));
    source.external = { provider: 'google_calendar', connectionId: 'conn', calendarId: 'cal', eventId: 'event', sourceUrl: 'https://calendar.google.com', syncedAt: '2026-08-26T10:00:00Z', readOnly: false };
    source.state = 'done'; source.closure = { at: '2026-08-26T11:00:00Z', actor: 'user', reason: 'manual' };
    source.actualTimeEntries = []; source.completionEntries = [];
    source.extensions = { 'utm:googleSave': { kind: 'update' }, retained: true };
    const copy = duplicateItemDraft(source, new Date('2026-09-23T13:00:00Z'));
    expect(copy).toMatchObject({ title: 'Meeting 2', createdAt: '2026-09-23T13:00:00.000Z', updatedAt: '2026-09-23T13:00:00.000Z', state: 'open', role: 'standalone', revision: 1 });
    expect(copy.id).not.toBe(source.id);
    expect(copy.external).toBeUndefined(); expect(copy.closure).toBeUndefined(); expect(copy.actualTimeEntries).toBeUndefined(); expect(copy.completionEntries).toBeUndefined();
    expect(copy.extensions).toEqual({ retained: true });
  });
  it('generates the program script on save without Apply and rejects unconfirmed overflow', () => {
    const item = createItem('Program');
    item.schedule = { timezone: 'UTC', startAt: '2030-09-20T12:00:00Z' };
    item.eventProgram = { blocks: [{ id: 'one', title: 'One', startOffsetSeconds: 0, endOffsetSeconds: 3600 }] };
    const saved = normalize({ item });
    expect(saved.schedule?.endAt).toBe('2030-09-20T13:00:00.000Z');
    expect(saved.scripts?.filter((script) => script.managedBy === 'event_program')).toHaveLength(1);
    item.schedule.endAt = '2030-09-20T12:30:00Z';
    expect(() => normalize({ item })).toThrow('outside the event');
    const workspace = createWorkspace(); workspace.items[item.id] = structuredClone(item);
    expect(normalize({ item, workspace }).eventProgram).toEqual(item.eventProgram);
  });
  it('allows scheduled tasks to be completed but keeps ordinary calendar events non-completable', () => {
    const item = createItem('Local'); item.schedule = { timezone: 'UTC', startAt: '2030-09-20T12:00:00Z' };
    expect(normalize({ item }).schedule?.endAt).toBeUndefined();
    item.schedule.endAt = '2030-09-20T13:00:00Z'; item.state = 'done';
    expect(normalize({ item }).state).toBe('done');
    const event = createItem('Meeting', 'event'); event.schedule = structuredClone(item.schedule); event.state = 'done';
    expect(() => normalize({ item: event })).toThrow('cannot be marked completed');
  });
  it('keeps dates required while a Google creation response is uncertain', () => {
    const item = createItem('Pending'); const workspace = createWorkspace('Pending');
    workspace.items[item.id] = { ...item, extensions: { 'utm:googleSave': { kind: 'create' } } };
    item.schedule = { timezone: 'UTC', startAt: '2030-09-20T12:00:00Z' };
    expect(() => normalize({ item, workspace })).toThrow('require both');
  });
  it('keeps a linked item with Due after Event ends is cleared', () => {
    const item = createItem('Linked'); const workspace = createWorkspace('Linked');
    item.schedule = { timezone: 'UTC', startAt: '2030-09-20T12:00:00Z', dueAt: '2030-09-24T12:00:00Z', estimatedDuration: 'PT45M' };
    item.external = { provider: 'google_calendar', connectionId: 'conn', calendarId: 'cal', eventId: 'event', sourceUrl: 'https://calendar.google.com', syncedAt: '2030-09-20T12:00:00Z', readOnly: false };
    workspace.items[item.id] = structuredClone(item);
    expect(normalize({ item, workspace }).schedule?.endAt).toBeUndefined();
  });
  it('normalizes scalar editor drafts before save', () => { const result = normalize(); expect(result.title).toBe('Test item'); expect(result.tags).toEqual(['work', 'test']); expect(result.updatedAt).toBe('2026-08-26T12:00:00.000Z'); });
  it('preserves the non-actionable note marker', () => { const item = createItem('Reference'); item.isNote = true; expect(normalize({ item }).isNote).toBe(true); });
  it('rejects an end before the opening date', () => { const item = createItem('Invalid'); item.schedule = { timezone: 'UTC', startAt: '2026-08-26T12:00:00Z', endAt: '2026-08-26T11:00:00Z' }; expect(() => normalize({ item })).toThrow('Event ends must be after'); });
  it('rejects a due date before the opening date', () => { const item = createItem('Invalid due'); item.schedule = { timezone: 'UTC', startAt: '2026-08-26T12:00:00Z', dueAt: '2026-08-26T11:00:00Z' }; expect(() => normalize({ item })).toThrow('Due / Active range ends cannot be earlier'); });
  it('materializes a stable recurring series rule', () => { const item = createItem('Weekly'); item.schedule = { timezone: 'UTC', startAt: '2026-08-26T12:00:00Z' }; const result = normalize({ item, recurring: true, repeatFrequency: 'WEEKLY', repeatIntervalDraft: '', repeatDays: ['MO'] }); expect(result.role).toBe('series_template'); expect(result.recurrence?.rrule).toContain('INTERVAL=1'); });
  it('keeps Due as the independent anchor of a due-only recurring series', () => {
    const now = new Date('2026-08-31T01:00:00.000Z');
    const workspace = createWorkspace('Due recurrence', now);
    const item = createItem('Weekly deadline', 'task', now);
    item.schedule = { timezone: 'UTC', dueAt: '2026-08-31T02:00:00.000Z', estimatedDuration: 'PT10M' };
    const result = normalize({ item, workspace, recurring: true, repeatFrequency: 'WEEKLY', repeatIntervalDraft: '2', repeatDays: ['MO'], now });
    expect(result.schedule?.startAt).toBeUndefined();
    workspace.items[result.id] = result;
    expect(reconcileRecurrences(workspace, now).created).toHaveLength(1);
  });
  it('removes recurrence when a series is saved as a standalone item', () => { const item = createItem('Standalone'); item.role = 'series_template'; item.recurrence = { rrule: 'FREQ=DAILY;INTERVAL=1', rdates: [], exdates: [], timezone: 'UTC', activationOffset: 'P1D', closeAt: 'next_activation', anchor: 'schedule', autoRenew: true }; const result = normalize({ item, recurring: false }); expect(result.role).toBe('standalone'); expect(result.recurrence).toBeUndefined(); });
  it('does not copy the template marker unless explicitly enabled', () => { const item = createItem('From template'); item.extensions = { 'utm:template': true, retained: 'yes' }; const result = normalize({ item, isTemplate: false }); expect(result.extensions?.['utm:template']).toBeUndefined(); expect(result.extensions?.retained).toBe('yes'); });
  it('rejects invalid script keys before save', () => { const item = createItem('Script'); item.scripts = [{ id: 'script-1', key: 'Not Valid', label: 'Result', source: '1 + 1', resultKind: 'number' }]; expect(() => normalize({ item })).toThrow('must start with a letter'); });
  it('preserves a running habit timer and completed stopwatch sessions', () => { const item = createItem('Timed habit'); item.habit = { target: 1, unit: 'times', streakMode: 'manual_only', completedDates: [], activeTimerStartedAt: '2026-08-26T11:00:00.000Z', timerSessions: [{ id: 'session-1', startedAt: '2026-08-26T10:00:00.000Z', endedAt: '2026-08-26T10:05:00.000Z', durationSeconds: 300 }] }; const result = normalize({ item }); expect(result.habit?.activeTimerStartedAt).toBe('2026-08-26T11:00:00.000Z'); expect(result.habit?.timerSessions).toEqual(item.habit.timerSessions); });
  it('preserves an automatic count-goal closure without creating a second completion', () => {
    const item = createItem('Counted');
    item.state = 'done';
    item.closure = { at: '2026-08-26T11:00:00Z', actor: 'automation', reason: 'rule' };
    item.progress = { mode: 'counter', current: 1, target: 1 };
    item.completionEntries = [{ id: 'one', at: '2026-08-26T11:00:00Z', kind: 'manual', comment: '' }];
    const result = normalize({ item });
    expect(result.closure?.reason).toBe('rule');
    expect(result.completionEntries).toHaveLength(1);
  });
});
