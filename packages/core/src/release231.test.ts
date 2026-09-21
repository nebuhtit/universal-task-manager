import { describe, expect, it } from 'vitest';
import { createItem, createWorkspace } from './types.js';
import { compileQuery } from './dsl.js';
import { migrateWorkspace } from './schema.js';
import { initializeItemHistory } from './item-history.js';

describe('2.3.1 compatibility', () => {
  it('excludes both imported and linked Google events, not local events', () => {
    const item = createItem('Local');
    const query = compileQuery('isGoogleEvent != true');
    expect(query(item)).toBe(true);
    for (const readOnly of [true, false]) {
      item.external = { provider: 'google_calendar', eventId: 'event', calendarId: 'calendar', connectionId: 'account', sourceUrl: '', readOnly, syncedAt: '2026-09-21T12:00:00Z' };
      expect(query(item)).toBe(false);
      expect(compileQuery('isGoogleEvent == true')(item)).toBe(true);
    }
  });
  it('migrates custom OR filters once, preserving order, preferences and later user edits', () => {
    const workspace = createWorkspace('Test');
    workspace.views.inbox = { id: 'inbox', name: 'Inbox', query: { source: 'state == "open" || includes(tags, "IMPORTANT")' }, renderer: 'list', fields: ['title'], sort: [] };
    workspace.viewOrder = ['inbox', ...workspace.viewOrder].reverse();
    workspace.calendarPreferences.headerDateFormat = 'numeric';
    const next = migrateWorkspace(workspace).value;
    expect(next.viewOrder).toEqual(workspace.viewOrder);
    expect(next.views.inbox?.query.source).toBe('(state == "open" || includes(tags, "IMPORTANT")) && isGoogleEvent != true');
    expect(next.calendarPreferences.headerDateFormat).toBe('numeric');
    expect(migrateWorkspace(next).value.views.inbox).toEqual(next.views.inbox);
    next.views.inbox!.query.source = 'true';
    expect(migrateWorkspace(next).value.views.inbox!.query.source).toBe('true');
  });
  it('does not merge unrelated measurements with equal times and preserves state', () => {
    const item = createItem('Independent');
    item.actualTimeEntries = ['one', 'two'].map((id) => ({ id, at: '2026-09-21T12:00:00Z', durationSeconds: 60, source: 'manual', comment: id }));
    initializeItemHistory(item); initializeItemHistory(item);
    expect(item.completionEntries).toHaveLength(2);
    expect(item.schedule?.actualDuration).toBe('PT120S');
    expect(item.state).toBe('open');
  });
  it('integrates habit sessions once without resurrecting deleted journal entries', () => {
    const item = createItem('Habit');
    item.habit = { target: 1, unit: 'times', streakMode: 'manual_only', completedDates: [], timerSessions: [{ id: 's', startedAt: '2026-09-21T12:00:00Z', endedAt: '2026-09-21T12:02:00Z', durationSeconds: 120 }] };
    initializeItemHistory(item); initializeItemHistory(item);
    expect(item.actualTimeEntries).toHaveLength(1); expect(item.completionEntries).toHaveLength(1);
    expect(item.habit.completedDates).toEqual([]);
    item.actualTimeEntries = []; item.completionEntries = [];
    initializeItemHistory(item);
    expect(item.actualTimeEntries).toEqual([]); expect(item.completionEntries).toEqual([]);
  });
});
