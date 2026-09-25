import { describe, expect, it } from 'vitest';
import { createItem, createWorkspace } from '@utm/core';
import { agendaWidgetSnapshot } from './nativeAgendaWidget';

describe('lock screen agenda projection', () => {
  it.each(['en', 'ru'] as const)('uses the compact departure symbol in %s before and during travel', language => {
    const now = Date.parse('2026-09-25T08:00:00Z');
    const workspace = createWorkspace('Travel'); workspace.items = {};
    workspace.calendarPreferences.language = language;
    const item = createItem('Задача');
    item.schedule = { timezone: 'UTC', startAt: '2026-09-25T10:00:00Z', endAt: '2026-09-25T11:00:00Z', travelDuration: 'PT60M' };
    workspace.items[item.id] = item;
    const snapshot = agendaWidgetSnapshot(workspace, now);
    expect(snapshot.entries[0]).toMatchObject({ title: '⇥ Задача', target: (now + 3600000) / 1000 });
    expect(snapshot.entries.find(entry => entry.at === (now + 3600000) / 1000)).toMatchObject({ current: '⇥ Задача', title: 'Задача' });
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
