import { describe, expect, it } from 'vitest';
import { createItem, createWorkspace, evaluateItemScripts, expressionContinuouslyDependsOnCurrentTime, migrateItem, validateItem, toCanonicalJSON, fromCanonicalJSON, createOccurrence, makeSeries, applyGoogleCalendarSync, reconcileRecurrences } from './index.js';
import { eventProgramStatus, programOverflow, syncEventProgramScript, trimEventProgram } from './event-program.js';

const fixture = () => {
  const item = createItem('School', 'event');
  item.schedule = { timezone: 'UTC', startAt: '2026-09-21T17:00:00.000Z', endAt: '2026-09-21T21:00:00.000Z', estimatedDuration: 'PT1H' };
  item.eventProgram = { blocks: [
    { id: 'lesson', title: 'Lesson', startOffsetSeconds: 0, endOffsetSeconds: 2700 },
    { id: 'break', title: 'Break', startOffsetSeconds: 2700, endOffsetSeconds: 3600 },
    { id: 'tea', title: 'Tea', startOffsetSeconds: 4500, endOffsetSeconds: 14400 },
  ] };
  return item;
};
const at = (time: string) => new Date(`2026-09-21T${time}:00.000Z`);
describe('event program', () => {
  it('reports current blocks, gaps, simultaneous transitions and final completion', () => {
    const item = fixture();
    expect(eventProgramStatus(item, at('16:30'))).toContain('Waiting — in 30m 0s: starts: Lesson');
    expect(eventProgramStatus(item, at('17:30'))).toBe('Lesson — in 15m 0s: ends: Lesson; starts: Break');
    expect(eventProgramStatus(item, at('17:45'))).toContain('Break —');
    expect(eventProgramStatus(item, at('18:00'))).toBe('Free time — in 15m 0s: starts: Tea');
    item.eventProgram!.blocks.push({ id: 'parallel', title: 'Music', startOffsetSeconds: 4500, endOffsetSeconds: 5000 });
    expect(eventProgramStatus(item, at('18:15'))).toContain('Tea · Music');
    expect(eventProgramStatus(item, at('21:00'))).toBe('Program finished');
  });
  it('moves with its anchor and identifies blocks to trim without changing the original', () => {
    const item = fixture(); item.schedule!.startAt = '2026-09-22T23:00:00Z'; item.schedule!.endAt = '2026-09-23T03:00:00Z';
    expect(eventProgramStatus(item, new Date('2026-09-22T23:30:00Z'))).toContain('Lesson —');
    item.schedule!.endAt = '2026-09-22T23:50:00Z';
    expect(programOverflow(item).map((block) => block.id)).toEqual(['break', 'tea']);
    const trimmed = trimEventProgram(item);
    expect(trimmed.eventProgram!.blocks.map((block) => [block.id, block.endOffsetSeconds])).toEqual([['lesson', 2700], ['break', 3000]]);
    expect(item.eventProgram!.blocks).toHaveLength(3);
    expect(trimmed.schedule!.estimatedDuration).toBe('PT1H');
  });
  it('generates exactly one safe, live script without collisions and removes only the managed script', () => {
    const item = fixture(); item.scripts = [{ id: 'user', key: 'event_program', label: 'Mine', source: '1', resultKind: 'number' }];
    syncEventProgramScript(item); const id = item.scripts![1]!.id;
    syncEventProgramScript(item);
    expect(item.scripts).toHaveLength(2); expect(item.scripts![1]!.id).toBe(id);
    expect(expressionContinuouslyDependsOnCurrentTime(item.scripts![1]!.source)).toBe(true);
    expect(evaluateItemScripts(item, undefined, at('17:30')).values.event_program_2).toContain('Lesson');
    item.eventProgram = { blocks: [] }; syncEventProgramScript(item);
    expect(item.scripts!.map((script) => script.id)).toEqual(['user']);
  });
  it('validates durations and preserves program through canonical backup and older schema migration', () => {
    const item = fixture(); syncEventProgramScript(item);
    expect(validateItem(item).valid).toBe(true);
    const workspace = createWorkspace(); workspace.items[item.id] = item;
    expect(fromCanonicalJSON(toCanonicalJSON(workspace)).items[item.id]!.eventProgram).toEqual(item.eventProgram);
    expect(migrateItem({ ...item, schemaVersion: '1.23.0' }).value.eventProgram).toEqual(item.eventProgram);
    item.eventProgram!.blocks[0]!.endOffsetSeconds = 0;
    expect(validateItem(item).valid).toBe(false);
  });
  it('inherits independent blocks in a new recurrence', () => {
    const series = makeSeries(fixture(), 'FREQ=DAILY');
    const occurrence = createOccurrence(series, new Date('2026-09-22T17:00:00Z'), 1);
    expect(occurrence.eventProgram).toEqual(series.eventProgram);
    occurrence.eventProgram!.blocks[0]!.title = 'Changed';
    expect(series.eventProgram!.blocks[0]!.title).toBe('Lesson');
  });
  it('keeps imported event programs and scripts when Google shortens the event', () => {
    const workspace = createWorkspace();
    const batch = { calendarId: 'calendar', connectionId: 'account', syncedAt: '2026-09-21T12:00:00Z', fullSync: false, events: [{ id: 'event', etag: '1', summary: 'School', start: { dateTime: '2026-09-21T17:00:00Z' }, end: { dateTime: '2026-09-21T21:00:00Z' } }] };
    applyGoogleCalendarSync(workspace, batch);
    const item = Object.values(workspace.items)[0]!; item.eventProgram = fixture().eventProgram!; syncEventProgramScript(item);
    applyGoogleCalendarSync(workspace, { ...batch, events: [{ ...batch.events[0]!, etag: '2', end: { dateTime: '2026-09-21T18:00:00Z' } }] });
    const updated = workspace.items[item.id]!;
    expect(updated.eventProgram).toEqual(item.eventProgram); expect(updated.scripts).toEqual(item.scripts);
    expect(programOverflow(updated).map((block) => block.id)).toEqual(['tea']);
  });
  it('preserves an individual program across series refresh but inherits anew next cycle', () => {
    const workspace = createWorkspace();
    const series = makeSeries(fixture(), 'FREQ=DAILY', { activationOffset: 'PT0M', closeAt: 'next_activation', autoRenew: true });
    workspace.items[series.id] = series;
    reconcileRecurrences(workspace, at('18:00'));
    const occurrence = Object.values(workspace.items).find((entry) => entry.occurrence?.seriesId === series.id)!;
    occurrence.eventProgram!.blocks[0]!.title = 'Individual';
    occurrence.extensions = { ...occurrence.extensions, 'utm:eventProgramOverride': occurrence.occurrence!.recurrenceId };
    syncEventProgramScript(occurrence);
    series.revision += 1; reconcileRecurrences(workspace, at('18:01'));
    expect(workspace.items[occurrence.id]!.eventProgram!.blocks[0]!.title).toBe('Individual');
    reconcileRecurrences(workspace, new Date('2026-09-22T18:00:00Z'));
    expect(workspace.items[occurrence.id]!.eventProgram!.blocks[0]!.title).toBe('Lesson');
  });
});
