import { describe, expect, it } from 'vitest';
import { createWorkspace, googleCalendarEventToItem, validateWorkspace, type GoogleCalendarEvent } from '@utm/core';
import { adoptGoogleUniversalItem, googleRecurrence } from './googleUniversalItem';
import { itemEditorSource } from '../features/items/editor/itemEditorSource';
import { saveItemInWorkspace } from './itemSaveCommand';

const master: GoogleCalendarEvent = { id: 'master', summary: 'Weekly', start: { dateTime: '2030-09-01T08:00:00Z', timeZone: 'Europe/Moscow' }, end: { dateTime: '2030-09-01T09:00:00Z', timeZone: 'Europe/Moscow' }, recurrence: ['RRULE:FREQ=WEEKLY'], etag: 'v1' };
function setup() {
  const workspace = createWorkspace(); workspace.items = {};
  const event = { ...master, id: 'instance', recurringEventId: 'master', originalStartTime: { dateTime: '2030-09-08T08:00:00Z' }, start: { dateTime: '2030-09-08T08:00:00Z' }, end: { dateTime: '2030-09-08T09:00:00Z' } };
  delete event.recurrence;
  const item = googleCalendarEventToItem(event, 'calendar', 'connection', '2030-09-01T00:00:00Z', 'Europe/Moscow')!;
  item.schedule!.travelDuration = 'PT15M'; item.tags = ['Keep']; item.actualTimeEntries = [{ id: 'local', durationSeconds: 60, source: 'manual', comment: 'Keep' }];
  workspace.items[item.id] = item;
  return { workspace, item, event };
}
describe('universal imported Google editing', () => {
  it('keeps the selected ID, local fields and history while enabling both recurrence scopes', () => {
    const { workspace, item, event } = setup();
    const adopted = adoptGoogleUniversalItem(workspace, item.id, event, master);
    expect(adopted.id).toBe(item.id); expect(adopted.external?.readOnly).toBe(false);
    expect(adopted.tags).toEqual(['Keep']); expect(adopted.actualTimeEntries).toHaveLength(1);
    expect(adopted.schedule?.travelDuration).toBe('PT15M'); expect(adopted.recurrenceOverride).toBeUndefined();
    expect(validateWorkspace(workspace).valid).toBe(true);
    const edit = structuredClone(itemEditorSource(workspace, adopted)); edit.title = 'Future title';
    saveItemInWorkspace(workspace, edit, { recurrenceEdit: { occurrenceId: adopted.id, scope: 'this_and_future' } }, new Date('2030-09-02T00:00:00Z'));
    expect(workspace.items[adopted.id]!.title).toBe('Future title');
    expect(workspace.items[adopted.id]!.actualTimeEntries).toHaveLength(1);
  });
  it('retains Google recurrence exclusions including timezone dates', () => {
    const recurrence = googleRecurrence({ ...master, recurrence: ['RRULE:FREQ=WEEKLY', 'EXDATE;TZID=Europe/Moscow:20300908T110000', 'RDATE:20300910T080000Z'] }, 'Europe/Moscow');
    expect(recurrence.exdates).toEqual(['2030-09-08T08:00:00.000Z']);
    expect(recurrence.rdates).toEqual(['2030-09-10T08:00:00.000Z']);
  });
  it('leaves the workspace unchanged for an unsupported recurrence', () => {
    const { workspace, item, event } = setup(); const before = JSON.stringify(workspace);
    expect(() => adoptGoogleUniversalItem(workspace, item.id, event, { ...master, recurrence: ['RRULE:FREQ=WEEKLY', 'EXRULE:FREQ=MONTHLY'] })).toThrow();
    expect(JSON.stringify(workspace)).toBe(before);
  });
});
