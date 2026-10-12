import { expect, it, vi } from 'vitest';
import { createItem, createWorkspace } from '@utm/core';
import { calendarSuggestions, calendarToken, extractCalendarSelection } from '../../../quick-entry-lab/calendars';
import { parseLiveEntry } from '../../../quick-entry-lab/parser';
import { withinSuggestions } from '../../../quick-entry-lab/relations';
import { applyQuickEntryEditorText, applyQuickEntryText, createQuickEntryItem, formatQuickEntryForEditor, quickEntryCalendar, quickEntryEditorText, quickEntrySource, withQuickEntryCalendar } from './quickEntry';
import { applyEditorTitleDraft } from './editor/itemEditorTitle';
import { liveTextIndex } from './liveTextIndex';

const now = new Date('2026-10-12T09:00:00Z');
const work = { id: 'work calendar@group.calendar.google.com', name: 'Работа завтра 15:00' };
const home = { id: 'home@example.com', name: 'Home' };

it.each(['cc', 'кк'])('suggests calendars on %s, filters by letters and retains duplicate names by ID', command => {
  const choices = [home, work, { ...work, id: 'second-id' }];
  const load = vi.fn(() => choices);
  expect(calendarSuggestions('Task', 4, load)).toBeNull();
  expect(load).not.toHaveBeenCalled();
  for (const query of ['', ' ', ' Р', ' Ра']) {
    const input = `Task ${command}${query}`;
    const options = calendarSuggestions(input, input.length, load)!.options;
    expect(options).toHaveLength(query.trim() ? 2 : 3);
  }
  const input = `Task ${command} Ра`;
  const options = calendarSuggestions(input, input.length, choices)!.options;
  expect(new Set(options.map(option => extractCalendarSelection(option.insert).selection!.id)).size).toBe(2);
});

it.each(['cc', 'кк'])('parses a selected %s calendar without interpreting its name as dates', command => {
  const text = `Meeting tomorrow 15:00 duration 1h ${calendarToken(work).replace(/^cc/, command)}`;
  const draft = parseLiveEntry(text, now);
  expect(draft).toMatchObject({ title: 'Meeting', calendarId: work.id, durationMinutes: 60, errors: [] });
  const item = createQuickEntryItem(text, now);
  expect(item.title).toBe('Meeting');
  expect(quickEntryCalendar(item)).toEqual(work);
  const edited = applyQuickEntryEditorText(item, formatQuickEntryForEditor(quickEntryEditorText(item)), now).item;
  expect(quickEntryCalendar(edited)).toEqual(work);
  expect(edited.schedule).toEqual(item.schedule);
  expect(edited.reminders.map(({ id, ...value }) => value)).toEqual(item.reminders.map(({ id, ...value }) => value));
});

it('uses the last calendar, protects quoted prose and does not discard malformed IDs', () => {
  const source = `${calendarToken(work)} Task ${calendarToken(home)}`;
  expect(extractCalendarSelection(source)).toMatchObject({ displayText: ' Task', selection: home });
  const prose = `«${calendarToken(work)}»`;
  expect(extractCalendarSelection(prose)).toMatchObject({ displayText: prose, selection: undefined });
  const invalid = 'Task cc [Broken](calendar:%zz)';
  expect(extractCalendarSelection(invalid).displayText).toBe(invalid);
});

it('persists calendar identity through capture, View creation defaults, plain-title edits, removal and selector changes', () => {
  const workspace = createWorkspace('test', now);
  const base = createItem('Existing', 'task', now); base.areas = ['Work'];
  const text = `Updated дл 30м ${calendarToken(work)} rr [Work](item:work)`;
  const created = applyQuickEntryText(base, text, now).item;
  expect(created.areas).toEqual(['Work']);
  expect(quickEntryCalendar(created)).toEqual(work);
  expect(created.relations).toMatchObject([{ type: 'scheduled_within', targetId: 'work' }]);
  const edited = applyEditorTitleDraft(base, base, `Updated ${calendarToken(work)}`, '', now, workspace);
  expect(edited.title).toBe('Updated');
  expect(quickEntryCalendar(edited)).toEqual(work);
  expect(quickEntryEditorText(edited)).toContain(calendarToken(work));
  const swapped = withQuickEntryCalendar(created, home);
  expect(quickEntryCalendar(swapped)).toEqual(home);
  expect(extractCalendarSelection(quickEntrySource(swapped)!.text).selection).toEqual(home);
  const reopened = JSON.parse(JSON.stringify(swapped));
  expect(quickEntryCalendar(reopened)).toEqual(home);
  const removed = applyQuickEntryEditorText(reopened, extractCalendarSelection(quickEntryEditorText(reopened)).displayText, now).item;
  expect(quickEntryCalendar(removed)).toBeUndefined();
  expect(removed.relations).toEqual(created.relations);
});

it('puts reserved blocks first for bare rr/рр and search, including pinned occurrences and saved Views', () => {
  const workspace = createWorkspace('test', now);
  const add = (id: string, title: string) => { const item = createItem(title, 'task', now); item.id = id; workspace.items[id] = item; return item; };
  add('ordinary', 'A Work');
  add('work', 'Work');
  const occurrence = add('work-occ', 'Work'); occurrence.occurrence = { seriesId: 'work', recurrenceId: now.toISOString(), sequence: 0, templateRevision: 1 };
  add('clean', 'Cleaning');
  workspace.calendarPreferences.dayView.statistics = { showTime: true, reservedItemIds: ['work-occ'] };
  workspace.views.saved = { id: 'saved', name: 'View', query: { source: 'true' }, renderer: 'list', fields: ['title'], sort: [], statistics: { showTime: true, reservedItemIds: ['clean'] } };
  const index = liveTextIndex(workspace);
  for (const command of ['rr', 'рр']) {
    expect(withinSuggestions(command, command.length, index.candidates)!.options.map(option => option.label)).toEqual(['Cleaning', 'Work', 'A Work']);
    const text = `${command} W`;
    expect(withinSuggestions(text, text.length, index.candidates)!.options.map(option => option.label)).toEqual(['Work', 'A Work']);
  }
  const changed = structuredClone(workspace);
  changed.calendarPreferences.dayView.statistics!.reservedItemIds = [];
  expect(liveTextIndex(changed).candidates.find(item => item.id === 'work')!.preferred).toBe(false);
});

it('shares writable calendar choices and invalidates the index after permission changes', () => {
  const workspace = createWorkspace('test', now);
  workspace.calendarPreferences.googleCalendar = { connectionId: 'test', syncTokens: {}, calendars: [
    { ...home, selected: true, accessRole: 'owner' }, { ...work, selected: false, accessRole: 'writer' },
    { id: 'read-only', name: 'Read only', selected: true, accessRole: 'reader' },
    { id: 'legacy', name: 'Legacy', selected: true },
  ] };
  expect(liveTextIndex(workspace).calendars.map(calendar => calendar.id)).toEqual([home.id, work.id, 'legacy']);
  const changed = structuredClone(workspace);
  changed.calendarPreferences.googleCalendar!.calendars[0]!.accessRole = 'reader';
  expect(liveTextIndex(changed).calendars.map(calendar => calendar.id)).not.toContain(home.id);
});
