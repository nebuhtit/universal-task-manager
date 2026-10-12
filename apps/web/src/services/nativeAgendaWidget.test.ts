import { describe, expect, it, vi } from 'vitest';
import { createItem, createWorkspace } from '@utm/core';
import { agendaWidgetRequest, agendaWidgetSnapshot, needsAgendaWidgetSync } from './nativeAgendaWidget';

describe('lock screen agenda projection', () => {
  it('sends bridge control messages without unsupported undefined values', async () => {
    const postMessage = vi.fn(async (_value: unknown) => ({ enabled: true, snapshotReady: false }));
    vi.stubGlobal('window', { webkit: { messageHandlers: { utmNativeAgenda: { postMessage } } } });
    try {
      await agendaWidgetRequest('status');
      expect(postMessage).toHaveBeenCalledWith({ kind: 'status' });
      expect(Object.keys(postMessage.mock.calls[0]![0] ?? {})).toEqual(['kind']);
    } finally { vi.unstubAllGlobals(); }
  });
  it('repairs a missing native snapshot and refreshes on foreground without duplicate background writes', () => {
    expect(needsAgendaWidgetSync({ enabled: true, snapshotReady: false }, 'same', 'same')).toBe(true);
    expect(needsAgendaWidgetSync({ enabled: true, snapshotReady: true }, 'same', 'same', true)).toBe(true);
    expect(needsAgendaWidgetSync({ enabled: true, snapshotReady: true }, 'same', 'same')).toBe(false);
    expect(needsAgendaWidgetSync({ enabled: false, snapshotReady: false }, 'new', 'old', true)).toBe(false);
  });
  it('keeps an absolute overnight Due target, not a cached remaining duration', () => {
    const now = Date.parse('2026-09-26T20:04:00Z');
    const workspace = createWorkspace('Overnight Due'); workspace.items = {};
    workspace.calendarPreferences.timezone = 'Europe/Moscow';
    const item = createItem('Подготовка к вс');
    const target = Date.parse('2026-09-27T08:00:00Z');
    item.schedule = { timezone: 'Europe/Moscow', dueAt: new Date(target).toISOString() };
    workspace.items[item.id] = item;
    const snapshot = agendaWidgetSnapshot(workspace, now);
    const entry = snapshot.entries[0]!;
    expect(entry).toMatchObject({ target: target / 1000, moment: '11:00', tomorrow: true });
    // The host's dynamic Date text must continue counting between stage entries.
    expect((entry.target! * 1000 - (now + 11 * 60000)) / 60000).toBe(705);
    const midnight = snapshot.entries.find(row => row.at === Date.parse('2026-09-26T21:00:00Z') / 1000);
    expect(midnight).toMatchObject({ target: target / 1000, moment: '11:00', tomorrow: false });
    const threshold = snapshot.entries.find(row => Math.abs(row.at - (target / 1000 - 599.999)) < .001);
    expect(threshold?.target).toBe(target / 1000);
  });
  it('bounds seconds transitions by the current stage and never revives old stages', () => {
    const now = Date.parse('2026-09-25T08:00:00Z');
    const workspace = createWorkspace('Transitions'); workspace.items = {};
    workspace.calendarPreferences.timezone = 'UTC';
    for (const [title, start, end] of [['First', 20, 21], ['Second', 22, 30]] as const) {
      const item = createItem(title); item.schedule = { timezone: 'UTC', startAt: new Date(now+start*60000).toISOString(), endAt: new Date(now+end*60000).toISOString() }; workspace.items[item.id] = item;
    }
    const snapshot = agendaWidgetSnapshot(workspace, now);
    expect(new Set(snapshot.entries.map(entry => entry.at)).size).toBe(snapshot.entries.length);
    expect(snapshot.entries.find(entry => Math.abs(entry.at - (now/1000 + 600.001)) < .001)?.title).toBe('First');
    expect(snapshot.entries.filter(entry => entry.at >= now/1000 + 21*60).every(entry => !entry.current.includes('First') && !entry.title.includes('First'))).toBe(true);
  });
  it.each(['en', 'ru'] as const)('uses the compact departure symbol in %s before and during travel', language => {
    const now = Date.parse('2026-09-25T08:00:00Z');
    const workspace = createWorkspace('Travel'); workspace.items = {};
    workspace.calendarPreferences.language = language;
    const item = createItem('Задача');
    item.schedule = { timezone: 'UTC', startAt: '2026-09-25T10:00:00Z', endAt: '2026-09-25T11:00:00Z', travelDuration: 'PT60M' };
    workspace.items[item.id] = item;
    const snapshot = agendaWidgetSnapshot(workspace, now);
    expect(snapshot.entries[0]).toMatchObject({ title: '[[travel-to]] Задача', target: (now + 3600000) / 1000 });
    expect(snapshot.entries.find(entry => entry.at === (now + 3600000) / 1000)).toMatchObject({ current: '[[travel-road]] Задача', title: 'Задача' });
  });
  it('adds the event clock only before outbound travel and keeps the departure countdown', () => {
    const now = Date.parse('2026-10-09T18:00:00Z');
    const workspace = createWorkspace('Travel clocks'); workspace.items = {};
    workspace.calendarPreferences.timezone = 'Europe/Moscow';
    const item = createItem('Событие');
    item.schedule = { timezone: 'Europe/Moscow', startAt: '2026-10-09T18:40:00Z', endAt: '2026-10-09T19:40:00Z', travelDuration: 'PT20M', travelBackDuration: 'PT20M' };
    workspace.items[item.id] = item;
    const snapshot = agendaWidgetSnapshot(workspace, now);
    const departure = Date.parse('2026-10-09T18:20:00Z') / 1000;
    expect(snapshot.entries[0]).toMatchObject({ moment: '21:20', eventMoment: '21:40', target: departure, label: 'In' });
    // Synthetic seconds boundaries must retain both clocks and the same target.
    expect(snapshot.entries.find(entry => Math.abs(entry.at - (departure - 599.999)) < .001)).toMatchObject({ eventMoment: '21:40', target: departure });
    expect(snapshot.entries.filter(entry => entry.at >= departure).every(entry => entry.eventMoment === undefined)).toBe(true);
    delete item.schedule.travelDuration;
    expect(agendaWidgetSnapshot(workspace, now).entries[0]).toMatchObject({ moment: '21:40', target: Date.parse(item.schedule.startAt!) / 1000 });
    expect(agendaWidgetSnapshot(workspace, now).entries[0]).not.toHaveProperty('eventMoment');
  });
  it('counts down to return travel, then immediately targets the next event or Due, never the return end', () => {
    const now = Date.parse('2026-10-09T18:00:00Z');
    const workspace = createWorkspace('Return travel'); workspace.items = {};
    workspace.calendarPreferences.timezone = 'UTC';
    const event = createItem('Meeting');
    event.schedule = { timezone: 'UTC', startAt: '2026-10-09T17:00:00Z', endAt: '2026-10-09T18:30:00Z', travelBackDuration: 'PT30M' };
    const next = createItem('Next event');
    next.schedule = { timezone: 'UTC', startAt: '2026-10-09T20:00:00Z', endAt: '2026-10-09T21:00:00Z' };
    const due = createItem('Deadline');
    due.schedule = { timezone: 'UTC', dueAt: '2026-10-09T19:30:00Z' };
    for (const item of [event, next, due]) workspace.items[item.id] = item;
    const returnStart = Date.parse(event.schedule.endAt!) / 1000;
    const snapshot = agendaWidgetSnapshot(workspace, now);
    expect(snapshot.entries[0]).toMatchObject({ current: 'Meeting', title: '[[travel-back-to]] Meeting', target: returnStart, moment: '18:30' });
    expect(snapshot.entries.find(entry => entry.at === returnStart)).toMatchObject({ current: '', title: 'Deadline', target: Date.parse(due.schedule.dueAt!) / 1000, label: 'Due in' });
    expect(snapshot.entries.filter(entry => entry.at >= returnStart).every(entry => !entry.title.includes('[[travel-back-to]]') && !entry.current.includes('Meeting'))).toBe(true);
    delete workspace.items[due.id];
    expect(agendaWidgetSnapshot(workspace, returnStart * 1000).entries[0]).toMatchObject({ title: 'Next event', target: Date.parse(next.schedule.startAt!) / 1000, label: 'In' });
  });
  it('prepares transitions without changing or exporting full source items', () => {
    const now = Date.parse('2026-09-25T08:00:00Z');
    const workspace = createWorkspace('Private workspace'); workspace.items = {};
    for (const [title, minutes] of [['First', 10], ['Second', 30], ['Done', 1]] as const) {
      const item = createItem(title); item.bodyMarkdown = 'private description';
      item.schedule = { timezone: 'UTC', startAt: new Date(now + minutes * 60000).toISOString(), endAt: new Date(now + (minutes + 10) * 60000).toISOString() };
      if (title === 'Done') item.state = 'done';
      workspace.items[item.id] = item;
    }
    const before = JSON.stringify(workspace);
    const snapshot = agendaWidgetSnapshot(workspace, now);
    expect(snapshot.entries[0]!.title).toBe('First');
    expect(snapshot.entries.find(entry => entry.at === (now + 10 * 60000) / 1000)).toMatchObject({ current: 'First', title: 'Second' });
    expect(snapshot.expires).toBe((now + 48 * 3600_000) / 1000);
    expect(JSON.stringify(snapshot)).not.toContain('private description');
    expect(JSON.stringify(snapshot)).not.toContain('Done');
    expect(JSON.stringify(workspace)).toBe(before);
  });
  it('bounds titles and handles an empty workspace', () => {
    const workspace = createWorkspace('Empty'); workspace.items = {};
    expect(agendaWidgetSnapshot(workspace).entries).toHaveLength(1);
    const item = createItem('a'.repeat(500));
    item.schedule = { timezone: 'UTC', dueAt: new Date(Date.now() + 60000).toISOString() };
    workspace.items[item.id] = item;
    expect(agendaWidgetSnapshot(workspace).entries[0]!.title).toHaveLength(160);
  });
});
