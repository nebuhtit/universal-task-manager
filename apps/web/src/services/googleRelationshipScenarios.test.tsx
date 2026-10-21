import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createItem, createOccurrence, createWorkspace, withinPlacementWorkspace, withinTargetsFor,
  type GoogleCalendarEvent, type SavedView, type UniversalItem, type WorkspaceDocument,
} from '@utm/core';
import { applyGoogleSyncPlan, calculateGoogleSyncPlan } from './googleSyncPlan';
import type { GoogleCalendarSyncResult } from './googleCalendar';
import { editRecurringItem } from './recurrenceItemEdit';
import { itemEditorSource } from '../features/items/editor/itemEditorSource';
import { saveItemInWorkspace } from './itemSaveCommand';
import { withQuickEntryCalendar } from '../features/items/quickEntry';
import { prepareGoogleSave } from './googleItemSave';
import { incomingItemRelations } from '../features/items/itemIdentity';
import { IncomingRelations } from '../features/items/editor/sections/IncomingRelations';
import { selectViewItems } from '../features/views/viewSelectors';

// Offline response replay only. A test must never access the user's Google account.
beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Live network is forbidden in this scenario suite'); })));
afterEach(() => vi.unstubAllGlobals());
const now = new Date('2030-09-08T07:00:00Z');
const displayNow = new Date('2030-09-10T11:00:00Z');
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
type Reference = 'series' | 'stored occurrence' | 'missing occurrence';

function fixture(reference: Reference = 'series') {
  const workspace = createWorkspace('Google relationship response replay', now);
  workspace.calendarPreferences.timezone = 'UTC'; workspace.calendarPreferences.language = 'en';
  workspace.calendarPreferences.googleCalendar = {
    connectionId: 'connection', accountEmail: 'test@example.invalid', syncTokens: {},
    calendars: ['source', 'destination', 'third'].map(id => ({ id, name: id, selected: true })),
  };
  const series = createItem('Work', 'event', now); series.id = 'work'; series.role = 'series_template';
  series.schedule = { timezone: 'UTC', startAt: '2030-09-02T09:00:00Z', endAt: '2030-09-02T17:00:00Z', estimatedDuration: 'PT8H' };
  series.recurrence = { rrule: 'FREQ=DAILY', timezone: 'UTC', anchor: 'schedule', closeAt: 'next_activation', autoRenew: true, rdates: [], exdates: [] };
  series.external = { provider: 'google_calendar', connectionId: 'connection', calendarId: 'source', eventId: 'master', sourceUrl: '', readOnly: false, syncedAt: now.toISOString(), etag: 'v1' };
  const stored = createOccurrence(series, new Date('2030-09-02T09:00:00Z'), 0);
  const task = createItem('Linked tax task', 'task', now); task.id = 'task';
  task.schedule = { timezone: 'UTC', plannedDate: '2030-09-10', estimatedDuration: 'PT30M' };
  task.relations = [{ id: 'stable-relation', type: 'scheduled_within', targetId: reference === 'series' ? series.id : reference === 'stored occurrence' ? stored.id : 'occ_work_20300901090000000' }];
  workspace.items = { work: series, task, ...(reference === 'stored occurrence' ? { [stored.id]: stored } : {}) };
  workspace.calendarPreferences.dayView.statistics = { showTime: true, reservedItemIds: ['work'] };
  return { workspace, series, task };
}

function eventFor(series: UniversalItem, changes: Partial<GoogleCalendarEvent> = {}): GoogleCalendarEvent {
  return { id: series.external!.eventId, etag: 'v2', status: 'confirmed', summary: series.title,
    start: { dateTime: series.schedule!.startAt!, timeZone: 'UTC' }, end: { dateTime: series.schedule!.endAt!, timeZone: 'UTC' },
    recurrence: [`RRULE:${series.recurrence!.rrule}`], ...changes };
}

function replay(workspace: WorkspaceDocument, events: Record<string, GoogleCalendarEvent[]>, fullSync: boolean, reverse = false) {
  const google = workspace.calendarPreferences.googleCalendar!;
  const result: GoogleCalendarSyncResult = {
    calendars: clone(google.calendars), syncTokens: Object.fromEntries(google.calendars.map(calendar => [calendar.id, 'cursor'])), syncedAt: now.toISOString(),
    syncWindow: { timeMin: '2030-09-01T00:00:00Z', timeMax: '2030-10-01T00:00:00Z', refreshedAt: now.toISOString() },
    batches: Object.entries(events).map(([calendarId, events]) => ({ calendarId, events, connectionId: google.connectionId, syncedAt: now.toISOString(), fullSync })),
  };
  if (reverse) result.batches.reverse();
  const plan = calculateGoogleSyncPlan({ workspace: clone(workspace), result, recovered: [] });
  applyGoogleSyncPlan(workspace, plan);
}

function assertLinks(workspace: WorkspaceDocument, sourceId = 'work') {
  const task = workspace.items.task!;
  expect(task.relations).toHaveLength(1); expect(task.relations[0]!.id).toBe('stable-relation');
  expect(withinTargetsFor(workspace, task)).toEqual(['work']);
  const incoming = incomingItemRelations(workspace, workspace.items[sourceId]!);
  expect(incoming.filter(link => link.source.id === task.id)).toHaveLength(1);
  expect(renderToStaticMarkup(<IncomingRelations item={workspace.items[sourceId]!} workspace={workspace} />)).toContain(task.title);
  const view: SavedView = { id: 'linked', name: 'Linked', renderer: 'list', fields: ['title'], sort: [], query: { source: 'id == "task"' } };
  // Production commits replace the immutable workspace identity. The mutable
  // replay harness must also give cached selectors a fresh snapshot per commit.
  expect(selectViewItems(clone(workspace), view, displayNow).map(item => item.id)).toEqual(['task']);
}

describe('Google sync response replay: relationship stability', () => {
  for (const reference of ['series', 'stored occurrence', 'missing occurrence'] as const) {
    for (const fullSync of [false, true]) {
      it(`${reference}: retains links through rename, time/date changes and repeated ${fullSync ? 'full' : 'delta'} refreshes`, () => {
        const { workspace, series, task } = fixture(reference);
        const originalRelation = clone(task.relations);
        const edits: Array<Partial<GoogleCalendarEvent>> = [
          {}, { summary: 'Office renamed remotely' },
          { summary: 'Office renamed remotely', start: { dateTime: '2030-09-02T13:00:00Z' }, end: { dateTime: '2030-09-02T19:00:00Z' } },
          { summary: 'Different date', start: { dateTime: '2030-09-03T10:00:00Z' }, end: { dateTime: '2030-09-03T16:00:00Z' } },
        ];
        for (const edit of edits) {
          const event = eventFor(workspace.items.work!, edit);
          for (let repeat = 0; repeat < 3; repeat++) {
            replay(workspace, { source: [event], destination: [], third: [] }, fullSync, repeat % 2 === 1);
            assertLinks(workspace);
            expect(task.relations).toEqual(originalRelation);
            expect(workspace.items.work!.title).toBe(event.summary);
            const placed = withinPlacementWorkspace(clone(workspace), displayNow).items.task!;
            expect(placed.schedule?.startAt).toBe(`2030-09-10T${event.start!.dateTime!.slice(11, 19)}.000Z`);
            expect(Object.values(workspace.items).filter(item => item.role === 'series_template')).toHaveLength(1);
          }
        }
        expect(workspace.items.work!.id).toBe(series.id);
      });
    }
  }

  it.each([false, true])('keeps stable IDs after source → destination → third → source moves and Google echoes, reverse batches: %s', async reverse => {
    const { workspace, task } = fixture('missing occurrence');
    const originalRelation = clone(task.relations);
    for (const destination of ['destination', 'third', 'source']) {
      const baseline = clone(workspace.items.work!);
      const changed = withQuickEntryCalendar(clone(baseline), { id: destination, name: destination });
      const options = { calendarId: destination, busy: true, baseline, moveWholeSeries: true };
      saveItemInWorkspace(workspace, changed, { google: options }, now);
      workspace.items.work!.extensions ??= {};
      workspace.items.work!.extensions!['utm:googleSave'] = await prepareGoogleSave({ workspaceId: workspace.workspaceId, accountEmail: 'test@example.invalid', item: workspace.items.work!, options });
      const event = eventFor(workspace.items.work!);
      const batches = { [baseline.external!.calendarId]: [{ id: 'master', status: 'cancelled' } as GoogleCalendarEvent], [destination]: [event] };
      // Fixture boundary: model a successful /move acknowledgement; actual
      // transport/acknowledgement callbacks are tested in googleSeriesMove.test.ts.
      workspace.items.work!.external!.calendarId = destination;
      delete workspace.items.work!.extensions!['utm:googleSave'];
      for (const full of [true, false, true]) { replay(workspace, batches, full, reverse); assertLinks(workspace); }
      expect(workspace.items.work!.external?.calendarId).toBe(destination);
      expect(Object.values(workspace.items).filter(item => item.role === 'series_template')).toHaveLength(1);
      expect(workspace.items.task!.relations).toEqual(originalRelation);
    }
  });

  // Confirmed audit regression, intentionally not fixed: user excluded sync changes.
  // Expected-failure tests turn red if the bug disappears, prompting removal of .fails.
  it.fails.each([false, true])('KNOWN BUG: preserves an unacknowledged move while Google cancels the source and returns the destination, reverse batches: %s', async reverse => {
    const { workspace, series } = fixture('missing occurrence');
    const options = { calendarId: 'destination', busy: true, baseline: clone(series), moveWholeSeries: true };
    series.extensions ??= {};
    series.extensions['utm:googleSave'] = await prepareGoogleSave({ workspaceId: workspace.workspaceId, accountEmail: 'test@example.invalid', item: series, options });
    replay(workspace, { source: [{ id: 'master', status: 'cancelled' }], destination: [eventFor(series)] }, false, reverse);
    assertLinks(workspace);
    expect(workspace.items.work!.extensions?.['utm:googleSave']).toBeDefined();
    expect(Object.values(workspace.items).filter(item => item.external?.eventId === 'master')).toHaveLength(1);
  });

  it.fails('KNOWN BUG: uses a remotely changed recurrence rule for related task placement after refresh', () => {
    const { workspace, series } = fixture('missing occurrence');
    replay(workspace, { source: [eventFor(series, { recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO'] })] }, true);
    assertLinks(workspace);
    // September 10 is Tuesday: the remote Monday-only series has no block here.
    expect(withinPlacementWorkspace(clone(workspace), displayNow).items.task!.schedule?.startAt).toBeUndefined();
    expect(workspace.items.work!.recurrence?.rrule).toBe('FREQ=WEEKLY;BYDAY=MO');
  });

  for (const change of ['rename', 'time', 'date', 'duration'] as const) {
    it(`keeps family relationships after changing only one occurrence's ${change} and replaying its Google exception`, () => {
      const { workspace, series, task } = fixture('missing occurrence');
      const selected = createOccurrence(series, new Date('2030-09-10T09:00:00Z'), 8);
      workspace.items[selected.id] = selected;
      const draft = clone(itemEditorSource(workspace, selected));
      if (change === 'rename') draft.title = 'A renamed exception';
      if (change === 'time') { draft.schedule!.startAt = '2030-09-10T13:00:00Z'; draft.schedule!.endAt = '2030-09-10T19:00:00Z'; }
      if (change === 'date') { draft.schedule!.startAt = '2030-09-11T09:00:00Z'; draft.schedule!.endAt = '2030-09-11T17:00:00Z'; }
      if (change === 'duration') { draft.schedule!.endAt = '2030-09-10T10:00:00Z'; draft.schedule!.estimatedDuration = 'PT1H'; }
      const originalRelation = clone(task.relations);
      const changed = editRecurringItem(workspace, draft, { occurrenceId: selected.id, scope: 'this_occurrence' }, now).item;
      const exception: GoogleCalendarEvent = { id: 'master_20300910T090000Z', summary: changed.title, recurringEventId: 'master',
        originalStartTime: { dateTime: '2030-09-10T09:00:00Z' }, start: { dateTime: changed.schedule!.startAt! }, end: { dateTime: changed.schedule!.endAt! } };
      for (const full of [false, true, false]) {
        replay(workspace, { source: [eventFor(series), exception] }, full);
        assertLinks(workspace);
        expect(workspace.items.task!.relations).toEqual(originalRelation);
        expect(workspace.items[selected.id]!.recurrenceOverride?.kind).toBe('this_occurrence');
        expect(Object.values(workspace.items).filter(item => item.role === 'series_template')).toHaveLength(1);
      }
    });
  }

  it('retains relationships when Google cancels one cycle and does not invent its missing time slot', () => {
    const { workspace, series } = fixture('missing occurrence');
    for (const full of [false, true]) {
      replay(workspace, { source: [eventFor(series), { id: 'cancelled-cycle', status: 'cancelled', recurringEventId: 'master', originalStartTime: { dateTime: '2030-09-10T09:00:00Z' } }] }, full);
      assertLinks(workspace);
      expect(withinPlacementWorkspace(clone(workspace), displayNow).items.task!.schedule?.startAt).toBeUndefined();
    }
  });

  it('rejects a recurrence-rule edit scoped to one occurrence without changing links or dates', () => {
    const { workspace, series } = fixture('missing occurrence');
    const selected = createOccurrence(series, new Date('2030-09-10T09:00:00Z'), 8); workspace.items[selected.id] = selected;
    const draft = clone(itemEditorSource(workspace, selected)); draft.recurrence!.rrule = 'FREQ=WEEKLY';
    const before = JSON.stringify(workspace);
    expect(() => editRecurringItem(workspace, draft, { occurrenceId: selected.id, scope: 'this_occurrence' }, now)).toThrow('This and future');
    expect(JSON.stringify(workspace)).toBe(before); assertLinks(workspace);
  });

  for (const change of ['rename', 'time', 'date', 'recurrence', 'reminder'] as const) {
    it(`keeps family relationships after a local future-series ${change} and subsequent Google refreshes`, () => {
      const { workspace, series, task } = fixture('missing occurrence');
      const selected = createOccurrence(series, new Date('2030-09-09T09:00:00Z'), 7);
      workspace.items[selected.id] = selected;
      const draft = clone(itemEditorSource(workspace, selected));
      if (change === 'rename') draft.title = 'Renamed future Work';
      if (change === 'time') { draft.schedule!.startAt = '2030-09-09T12:00:00Z'; draft.schedule!.endAt = '2030-09-09T19:00:00Z'; }
      if (change === 'date') { draft.schedule!.startAt = '2030-09-10T09:00:00Z'; draft.schedule!.endAt = '2030-09-10T17:00:00Z'; }
      if (change === 'recurrence') draft.recurrence!.rrule = 'FREQ=WEEKLY;BYDAY=TU';
      if (change === 'reminder') draft.reminders = [{ id: 'notice', mode: 'relative', relativeTo: 'start', offset: '-PT10M', repeatUntilAcknowledged: false }];
      const originalRelation = clone(task.relations);
      const next = editRecurringItem(workspace, draft, { occurrenceId: selected.id, scope: 'this_and_future' }, now).item;
      expect(next.id).not.toBe(series.id);
      next.external = { ...series.external!, eventId: 'future-master' };
      for (const full of [false, true, false]) {
        replay(workspace, { source: [eventFor(workspace.items.work!), eventFor(next)] }, full);
        assertLinks(workspace, next.id); expect(workspace.items.task!.relations).toEqual(originalRelation);
      }
      expect(Object.values(workspace.items).filter(item => item.role === 'series_template')).toHaveLength(2);
    });
  }

  it('does not bind a task to an unrelated same-name series', () => {
    const { workspace, series } = fixture('missing occurrence');
    const other = clone(series); other.id = 'independent'; other.external!.eventId = 'other-master';
    workspace.items[other.id] = other;
    replay(workspace, { source: [eventFor(series), eventFor(other)] }, true);
    assertLinks(workspace);
    expect(incomingItemRelations(workspace, workspace.items.independent!)).toEqual([]);
  });

  it('preserves relationships through a future split, refresh, calendar move, rename and another refresh', () => {
    const { workspace, series } = fixture('missing occurrence');
    const selected = createOccurrence(series, new Date('2030-09-09T09:00:00Z'), 7); workspace.items[selected.id] = selected;
    const draft = clone(itemEditorSource(workspace, selected)); draft.title = 'Office';
    draft.schedule!.startAt = '2030-09-09T10:00:00Z'; draft.schedule!.endAt = '2030-09-09T18:00:00Z';
    const next = editRecurringItem(workspace, draft, { occurrenceId: selected.id, scope: 'this_and_future' }, now).item;
    next.external = { ...series.external!, eventId: 'future-master' };
    replay(workspace, { source: [eventFor(series), eventFor(next)] }, true);
    const baseline = clone(workspace.items[next.id]!);
    const changed = withQuickEntryCalendar(clone(baseline), { id: 'destination', name: 'Destination' });
    saveItemInWorkspace(workspace, changed, { google: { calendarId: 'destination', busy: true, baseline, moveWholeSeries: true } }, now);
    // Model the acknowledged /move result before reading Google again.
    workspace.items[next.id]!.external!.calendarId = 'destination';
    const moved = eventFor(workspace.items[next.id]!, { summary: 'Office after move' });
    for (const full of [false, true, false]) {
      replay(workspace, { source: [eventFor(workspace.items.work!), { id: moved.id, status: 'cancelled' }], destination: [moved] }, full);
      assertLinks(workspace, next.id);
      expect(workspace.items[next.id]!.external?.calendarId).toBe('destination');
      expect(workspace.items[next.id]!.title).toBe('Office after move');
      expect(workspace.items[next.id]!.recurrenceOverride?.sourceSeriesId).toBe('work');
      expect(Object.values(workspace.items).filter(item => item.role === 'series_template')).toHaveLength(2);
    }
  });

  it('keeps Moscow local times and relationships after receiving offset-based remote times', () => {
    const { workspace, series } = fixture('missing occurrence');
    workspace.calendarPreferences.timezone = 'Europe/Moscow';
    series.schedule = { ...series.schedule, timezone: 'Europe/Moscow', startAt: '2030-09-02T06:00:00Z', endAt: '2030-09-02T14:00:00Z' };
    series.recurrence!.timezone = 'Europe/Moscow';
    const event = eventFor(series, { start: { dateTime: '2030-09-02T10:00:00+03:00', timeZone: 'Europe/Moscow' }, end: { dateTime: '2030-09-02T18:00:00+03:00', timeZone: 'Europe/Moscow' } });
    for (const full of [false, true]) {
      replay(workspace, { source: [event] }, full); assertLinks(workspace);
      expect(withinPlacementWorkspace(clone(workspace), displayNow).items.task!.schedule?.startAt).toBe('2030-09-10T07:00:00.000Z');
    }
  });

  it('shows the relationship even when a weekly rule has no block on the task date', () => {
    const { workspace } = fixture('missing occurrence');
    workspace.items.work!.recurrence!.rrule = 'FREQ=WEEKLY;BYDAY=MO';
    replay(workspace, { source: [eventFor(workspace.items.work!)] }, true);
    assertLinks(workspace);
    expect(withinPlacementWorkspace(workspace, displayNow).items.task!.schedule?.startAt).toBeUndefined();
  });
});
