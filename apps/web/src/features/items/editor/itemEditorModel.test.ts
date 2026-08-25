import { describe, expect, it } from 'vitest';
import { createItem, createWorkspace } from '@utm/core';
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
  it('removes recurrence when a series is saved as a standalone item', () => { const item = createItem('Standalone'); item.role = 'series_template'; item.recurrence = { rrule: 'FREQ=DAILY;INTERVAL=1', rdates: [], exdates: [], timezone: 'UTC', activationOffset: 'P1D', closeAt: 'next_activation', anchor: 'schedule', autoRenew: true }; const result = normalize({ item, recurring: false }); expect(result.role).toBe('standalone'); expect(result.recurrence).toBeUndefined(); });
  it('does not copy the template marker unless explicitly enabled', () => { const item = createItem('From template'); item.extensions = { 'utm:template': true, retained: 'yes' }; const result = normalize({ item, isTemplate: false }); expect(result.extensions?.['utm:template']).toBeUndefined(); expect(result.extensions?.retained).toBe('yes'); });
  it('rejects invalid script keys before save', () => { const item = createItem('Script'); item.scripts = [{ id: 'script-1', key: 'Not Valid', label: 'Result', source: '1 + 1', resultKind: 'number' }]; expect(() => normalize({ item })).toThrow('must start with a letter'); });
});
