import { describe, expect, it } from 'vitest';
import { createItem, createWorkspace, reconcileRecurrences } from '@utm/core';
import { normalizeItemForSave } from './itemEditorModel';

const normalize = (overrides: Partial<Parameters<typeof normalizeItemForSave>[0]> = {}) => {
  const workspace = createWorkspace('Editor'); const item = createItem('  Test item  ', 'task', new Date('2026-08-26T10:00:00Z'));
  return normalizeItemForSave({ item, workspace, tags: 'work, test', contexts: 'desk', isTemplate: false, recurring: false, activeRange: false, repeatFrequency: 'WEEKLY', repeatIntervalDraft: '1', repeatDays: [], now: new Date('2026-08-26T12:00:00Z'), ...overrides });
};
describe('item editor normalization', () => {
  it('normalizes scalar editor drafts before save', () => { const result = normalize(); expect(result.title).toBe('Test item'); expect(result.tags).toEqual(['work', 'test']); expect(result.updatedAt).toBe('2026-08-26T12:00:00.000Z'); });
  it('rejects an end before the opening date', () => { const item = createItem('Invalid'); item.schedule = { timezone: 'UTC', startAt: '2026-08-26T12:00:00Z', endAt: '2026-08-26T11:00:00Z' }; expect(() => normalize({ item })).toThrow('Event ends cannot be earlier'); });
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
});
