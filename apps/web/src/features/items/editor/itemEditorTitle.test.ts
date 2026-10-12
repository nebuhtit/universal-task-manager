import { describe, expect, it } from 'vitest';
import { canManuallyComplete, createItem, createWorkspace, withinPlacementWorkspace } from '@utm/core';
import { markCreationDefaultBounds, clearCreationDefaultBounds } from '../creationDefaultBounds';
import { applyEditorTitleDraft } from './itemEditorTitle';
import { createQuickEntryItem, formatQuickEntryForEditor, quickEntrySource } from '../quickEntry';

describe('item editor title draft', () => {
  it('does not recreate an event end from Live Text duration for a related availability task', () => {
    const now = new Date('2026-10-09T07:00:00Z');
    const item = createItem('Task', 'task', now);
    item.canBeCompleted = true;
    item.schedule = { timezone: 'UTC', startAt: '2026-10-07T14:19:00Z', dueAt: '2026-10-18T06:00:00Z', estimatedDuration: 'PT30M' };
    for (const command of ['rr', 'рр']) {
      const result = applyEditorTitleDraft(item, item, `Task начало 07.10.2026 17:19 дл 30м ${command} [Work](item:work)`, '', now);
      expect(result.schedule?.endAt).toBeUndefined();
      expect(result.schedule?.estimatedDuration).toBe('PT30M');
      expect(result.canBeCompleted).toBe(true);
    }
  });
  it.each(['rr', 'рр'])('keeps %s on a plain-title task and places it in the next Work, not the form default time', command => {
    const now = new Date('2026-10-09T07:00:00Z');
    const workspace = createWorkspace('Test', now);
    workspace.calendarPreferences.timezone = 'UTC';
    const work = createItem('Work', 'event', now);
    work.id = 'work';
    work.schedule = { timezone: 'UTC', startAt: '2026-10-10T09:00:00Z', endAt: '2026-10-10T17:00:00Z' };
    workspace.items.work = work;
    const original = createItem('Task', 'task', now);
    original.schedule = { timezone: 'UTC', startAt: now.toISOString(), endAt: new Date(+now + 600000).toISOString() };
    const item = markCreationDefaultBounds(original);
    const result = applyEditorTitleDraft(item, item, `Task дл 30м ${command} [Work](item:work)`, '', now, workspace);
    expect(result.relations).toMatchObject([{ type: 'scheduled_within', targetId: 'work' }]);
    expect(result.canBeCompleted).toBe(true);
    expect(result.schedule).toMatchObject({ plannedDate: '2026-10-10', estimatedDuration: 'PT30M' });
    expect(result.schedule?.startAt).toBeUndefined();
    expect(quickEntrySource(result)?.text).toContain('item:work');
    const removed = applyEditorTitleDraft(result, result, 'Task дл 30м', '', now, workspace);
    expect(removed.relations).toHaveLength(0);
    const saved = JSON.parse(JSON.stringify(result));
    workspace.items[saved.id] = saved;
    const placed = withinPlacementWorkspace(workspace, now).items[saved.id]!;
    expect(placed.schedule?.startAt).toBe('2026-10-10T09:00:00.000Z');
    expect(canManuallyComplete(placed)).toBe(true);
    expect(item.schedule?.startAt).toBe(now.toISOString());
  });

  it('anchors an old undated task against the time of selecting a relation', () => {
    const now = new Date('2026-10-09T10:00:00Z');
    const workspace = createWorkspace('Test', now); workspace.calendarPreferences.timezone = 'UTC';
    const work = createItem('Work', 'event', now); work.id = 'work';
    work.schedule = { timezone: 'UTC', startAt: '2026-10-09T09:00:00Z', endAt: '2026-10-09T17:00:00Z' };
    workspace.items.work = work;
    const item = createItem('Task', 'task', new Date('2026-10-01T07:00:00Z'));
    const result = applyEditorTitleDraft(item, item, 'Task дл 30м rr [Work](item:work)', '', now, workspace);
    workspace.items[result.id] = result;
    expect(withinPlacementWorkspace(workspace, now).items[result.id]?.schedule?.startAt).toBe(now.toISOString());
    expect(result.createdAt).toBe(item.createdAt);
  });

  it('preserves explicitly chosen bounds and completion when adding a relation', () => {
    const now = new Date('2026-10-09T07:00:00Z');
    const item = createItem('Task', 'task', now);
    item.schedule = { timezone: 'UTC', startAt: now.toISOString(), endAt: new Date(+now + 600000).toISOString() };
    const explicit = clearCreationDefaultBounds(markCreationDefaultBounds(item));
    const result = applyEditorTitleDraft(explicit, explicit, 'Task rr [Work](item:work)', '', now);
    expect(result.schedule).toEqual(item.schedule);
    expect(result.canBeCompleted).toBe(true);
    const event = { ...explicit, preset: 'event' as const, canBeCompleted: false };
    expect(applyEditorTitleDraft(event, event, 'Event rr [Work](item:work)', '', now).canBeCompleted).toBe(false);
  });
  it('keeps a compact weekday anchored to its stored date after reopening on a later week', () => {
    const created = new Date(2026, 9, 5, 8);
    const item = createQuickEntryItem('Meeting начало 05.10.2026 12:00 дл 1ч ттб 45м', created);
    const text = formatQuickEntryForEditor(quickEntrySource(item)!.text).replace('05.10.2026', 'пн');
    // Canonical weekday form is how relative input is materialized by capture.
    item.extensions!['utm:quickEntrySource'] = { text: quickEntrySource(item)!.text.replace('05.10.2026', 'пн 05.10.2026'), timezone: item.schedule!.timezone, grammarVersion: 2 };
    const result = applyEditorTitleDraft(item, structuredClone(item), text.replace('Meeting', 'Updated'), '', new Date(2026, 9, 13, 8));
    expect(result.title).toBe('Updated');
    expect(result.schedule).toEqual(item.schedule);
    expect(result.reminders.map(({ id, ...rest }) => rest)).toEqual(item.reminders.map(({ id, ...rest }) => rest));
  });

  it('rejects travel with missing bounds without mutating a new item', () => {
    const item = createItem('');
    const before = structuredClone(item);
    expect(() => applyEditorTitleDraft(item, before, 'Test ttb 45m', '', new Date())).toThrow('Для дороги нужно время начала.');
    expect(item).toEqual(before);
  });

  it('uses form dates for hidden departure reminders when the replacement title has travel only', () => {
    const now = new Date(2026, 9, 5, 8);
    const item = createQuickEntryItem('Meeting начало 05.10.2026 12:00 дл 1ч ттб 45м', now);
    const result = applyEditorTitleDraft(item, structuredClone(item), 'Updated ttb 30m', '', now);
    expect(result.title).toBe('Updated');
    expect(result.schedule).toMatchObject({ startAt: item.schedule!.startAt, endAt: item.schedule!.endAt, travelDuration: 'PT30M', travelBackDuration: 'PT30M' });
    expect(result.reminders.map(r => r.at)).toEqual([new Date(2026, 9, 5, 9, 30).toISOString(), new Date(2026, 9, 4, 11, 30).toISOString()]);
  });
  it('commits plain title text without clearing dates or reminders', () => {
    const item = createItem('Before');
    item.schedule = { timezone: 'UTC', startAt: '2030-09-20T12:00:00Z', endAt: '2030-09-20T13:00:00Z' };
    item.reminders = [{ id: 'r', mode: 'relative', relativeTo: 'start', offset: '-PT10M', repeatUntilAcknowledged: false }];
    const result = applyEditorTitleDraft(item, structuredClone(item), 'After', '', new Date('2030-09-01T00:00:00Z'));
    expect(result.title).toBe('After');
    expect(result.schedule).toEqual(item.schedule);
    expect(result.reminders).toEqual(item.reminders);
  });

  it('applies a title command exactly when the draft is committed', () => {
    const item = createItem('Before');
    item.schedule = { timezone: 'UTC', startAt: '2030-09-20T12:00:00Z', endAt: '2030-09-20T13:00:00Z' };
    const result = applyEditorTitleDraft(item, structuredClone(item), 'After длительность 30м', '', new Date('2030-09-01T00:00:00Z'));
    expect(result.title).toBe('After');
    expect(result.schedule?.estimatedDuration).toBe('PT30M');
    expect(result.schedule?.startAt).toBe(item.schedule.startAt);
  });

  it.each(['Updated ттб 45м', 'Updated ttb 45m'])('uses existing event bounds for both travel legs in %s', text => {
    const item = createItem('Before');
    item.schedule = { timezone: 'UTC', startAt: '2030-09-20T12:00:00Z', endAt: '2030-09-20T13:00:00Z' };
    const result = applyEditorTitleDraft(item, structuredClone(item), text, '', new Date('2030-09-01T00:00:00Z'));
    expect(result.title).toBe('Updated');
    expect(result.schedule).toMatchObject({
      startAt: item.schedule.startAt,
      endAt: item.schedule.endAt,
      travelDuration: 'PT45M',
      travelBackDuration: 'PT45M',
    });
  });
});
