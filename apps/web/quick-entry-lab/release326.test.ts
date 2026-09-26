import { describe, expect, it } from 'vitest';
import { parseEntry } from './parser';
import { organizationSuggestions } from './organization';
import { quickSessionCommand } from './commandGuide';
import { createQuickEntryItem, syncQuickEntrySource, quickEntrySource, applyQuickEntryText } from '../src/features/items/quickEntry';
import { createWorkspace, createItem, migrateWorkspace } from '@utm/core';
import { attachQuickTimer, storeQuickTimer } from '../src/features/items/QuickTimerDialog';
import { agendaMoment, nextAgendaMidnight } from '../src/components/layout/agendaMoment';
const now = new Date('2026-09-26T09:00:00Z');
describe('3.2.6', () => {
  it.each(['нн', 'alarm', 'rr'])('parses alarm %s and bare anchor', alias => {
    const alarm = parseEntry('Meeting tomorrow 15:00 ' + alias + ' 30m', now);
    expect(alarm.errors).toEqual([]);
    expect(alarm.reminders[0]).toMatchObject({ delivery: 'alarm', minutes: -30 });
    expect(parseEntry('Meeting tomorrow 15:00 ' + alias, now).reminders[0]).toMatchObject({ delivery: 'alarm', minutes: 0, anchor: 'start' });
    expect(parseEntry('Meeting ' + alias, now).errors.length).toBeGreaterThan(0);
  });
  it('preserves both delivery kinds and exports alarms', () => {
    const item = createQuickEntryItem('Meeting tomorrow 15:00 н 30m нн 30m', now, undefined, []);
    expect(item.reminders).toHaveLength(2);
    expect(item.reminders.map(r => r.delivery ?? 'notification')).toEqual(['notification', 'alarm']);
    const ws = createWorkspace('Test'); ws.items[item.id] = item;
    expect(migrateWorkspace(JSON.parse(JSON.stringify(ws))).value.items[item.id]!.reminders[1]!.delivery).toBe('alarm');
  });
  it('round trips a zero-offset alarm after changing delivery in the editor', () => {
    const item = createQuickEntryItem('Meeting tomorrow 15:00 нн', now, undefined, []);
    const changed = syncQuickEntrySource(item, { ...item, reminders: item.reminders.map(r => ({ ...r, delivery: 'notification' })) });
    const result = applyQuickEntryText(changed, quickEntrySource(changed)!.text, now);
    expect(result.draft.errors).toEqual([]);
    expect(result.item.reminders[0]?.delivery ?? 'notification').toBe('notification');
  });
  it('keeps all suggestions, relationship order and incremental filtering', () => {
    const catalog = { area: ['A', 'B'], project: ['Other', 'Second', 'First'], tag: Array.from({length: 70}, (_, i) => 'Tag' + i), projectAreas: {First:['A'],Second:['B']} };
    const input = 'Task э "A" э "B" п ';
    expect(organizationSuggestions(input, input.length, catalog)?.options.map(o => o.label)).toEqual(['First','Second','Other']);
    expect(organizationSuggestions('Task #', 6, catalog)?.options).toHaveLength(70);
    expect(organizationSuggestions('Task #Tag6', 10, catalog)?.options).toHaveLength(11);
  });
  it('recognizes only standalone unquoted timer commands', () => {
    expect(quickSessionCommand(' т ')).toBe('timer');
    expect(quickSessionCommand('с')).toBe('stopwatch');
    expect(quickSessionCommand('"timer"')).toBeUndefined();
    expect(quickSessionCommand('timer tomorrow')).toBeUndefined();
  });
  it('retains an unattached result through serialization and attaches once', () => {
    let ws = createWorkspace('Timer'); const item = createItem('Task'); ws.items[item.id] = item;
    storeQuickTimer(ws, {id:'session',mode:'stopwatch',startedAt:now.toISOString(),stoppedAt:new Date(+now+60000).toISOString(),durationSeconds:60});
    ws = migrateWorkspace(JSON.parse(JSON.stringify(ws))).value;
    expect(ws.quickTimer?.pending?.[0]?.durationSeconds).toBe(60);
    ws.quickTimer!.itemId = item.id;
    attachQuickTimer(ws); attachQuickTimer(ws);
    expect(ws.items[item.id]!.actualTimeEntries).toHaveLength(1);
  });
  it('changes tomorrow to today at workspace midnight', () => {
    const before = Date.parse('2026-09-26T20:59:00Z'), event = Date.parse('2026-09-27T06:00:00Z');
    expect(agendaMoment(event, before, 'Europe/Moscow')).toEqual({text:'9:00',tomorrow:true});
    expect(nextAgendaMidnight(before, 'Europe/Moscow')).toBe(Date.parse('2026-09-26T21:00:00Z'));
    expect(agendaMoment(event, before+60000, 'Europe/Moscow')).toEqual({text:'9:00',tomorrow:false});
  });
});
