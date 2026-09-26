import { describe, expect, it } from 'vitest';
import { createItem, createWorkspace, softDeleteItemTree } from '@utm/core';
import { nativeReminderSchedule } from './nativeReminders';

describe('native reminder scheduling', () => {
  it('keeps alarm delivery through rescheduling and removes completed/acknowledged alarms', () => {
    const now = new Date('2026-09-26T09:00:00Z');
    const workspace = createWorkspace('Alarm', now); workspace.items = {};
    const item = createItem('Alarm', 'task', now); workspace.items[item.id] = item;
    item.reminders = [{ id: 'alarm', delivery: 'alarm', mode: 'absolute', at: '2026-09-26T10:00:00Z', urgency: 'normal', repeatUntilAcknowledged: false }];
    expect(nativeReminderSchedule(workspace, now)[0]?.delivery).toBe('alarm');
    item.reminders[0]!.snoozedUntil = '2026-09-26T11:00:00Z';
    expect(nativeReminderSchedule(workspace, now)[0]?.at).toBe('2026-09-26T11:00:00.000Z');
    item.state = 'done'; expect(nativeReminderSchedule(workspace, now)).toEqual([]);
    item.state = 'open'; item.reminders[0]!.acknowledgedAt = now.toISOString();
    expect(nativeReminderSchedule(workspace, now)).toEqual([]);
  });
  it('resolves reminders, excludes unavailable entries and keeps the nearest future reminders', () => {
    const now = new Date('2026-09-03T10:00:00.000Z');
    const workspace = createWorkspace('Native reminders', now);
    workspace.calendarPreferences.timezone = 'UTC';
    const active = createItem('Call', 'task', now);
    active.schedule = { timezone: 'UTC', startAt: '2026-09-03T12:00:00.000Z', availableFrom: '2026-09-03T11:30:00.000Z' };
    active.reminders = [
      { id: 'relative', mode: 'relative', relativeTo: 'start', offset: '-PT1H', urgency: 'urgent', repeatUntilAcknowledged: false },
      { id: 'past', mode: 'absolute', at: '2026-09-03T09:00:00.000Z', urgency: 'normal', repeatUntilAcknowledged: false },
      { id: 'ack', mode: 'absolute', at: '2026-09-03T13:00:00.000Z', urgency: 'normal', repeatUntilAcknowledged: false, acknowledgedAt: now.toISOString() },
    ];
    const series = createItem('Template', 'task', now);
    series.role = 'series_template';
    series.reminders = [{ id: 'template', mode: 'absolute', at: '2026-09-03T14:00:00.000Z', urgency: 'normal', repeatUntilAcknowledged: false }];
    workspace.items[active.id] = active;
    workspace.items[series.id] = series;

    const scheduled = nativeReminderSchedule(workspace, now);
    expect(scheduled).toHaveLength(2);
    expect(scheduled[0]).toEqual(expect.objectContaining({
      itemId: active.id,
      title: 'Call',
      at: '2026-09-03T11:30:00.000Z',
      urgency: 'urgent',
      body: 'Event opens · 12:00 · urgent',
    }));
    expect(scheduled.some((entry) => entry.id.endsWith(':ack'))).toBe(false);
    expect(scheduled.some((entry) => entry.id.endsWith(':template'))).toBe(false);
  });
  it('uses due and includes the date only outside today', () => {
    const now = new Date('2026-09-03T10:00:00.000Z');
    const workspace = createWorkspace('Due notifications', now);
    workspace.calendarPreferences.timezone = 'UTC';
    const today = createItem('Today', 'task', now);
    today.schedule = { timezone: 'UTC', dueAt: '2026-09-03T18:00:00.000Z' };
    today.reminders = [{ id: 'today', mode: 'absolute', at: '2026-09-03T11:00:00.000Z', urgency: 'normal', repeatUntilAcknowledged: false }];
    const later = createItem('Later', 'task', now);
    later.schedule = { timezone: 'UTC', dueAt: '2026-09-05T09:30:00.000Z' };
    later.reminders = [{ id: 'later', mode: 'absolute', at: '2026-09-04T09:00:00.000Z', urgency: 'normal', repeatUntilAcknowledged: false }];
    workspace.items[today.id] = today; workspace.items[later.id] = later;
    const scheduled = nativeReminderSchedule(workspace, now);
    expect(scheduled.find(value => value.itemId === today.id)?.body).toBe('Due · 18:00');
    expect(scheduled.find(value => value.itemId === later.id)?.body).toBe('Due · 05/09/2026, 09:30');
  });
  it('cancels reminders of a deleted recurring parent and restores future reminders on undo', () => {
    const now = new Date('2026-09-03T10:00:00Z');
    const workspace = createWorkspace('Deleted reminders', now);
    const parent = createItem('Weekly', 'task', now); parent.role = 'series_template';
    const child = createItem('This week', 'task', now);
    child.role = 'occurrence'; child.occurrence = { seriesId: parent.id, recurrenceId: '2026-09-03T12:00:00Z', sequence: 0, templateRevision: 1 };
    child.reminders = [{ id: 'reminder', mode: 'absolute', at: '2026-09-03T12:00:00Z', urgency: 'normal', repeatUntilAcknowledged: false }];
    workspace.items[parent.id] = parent; workspace.items[child.id] = child;
    expect(nativeReminderSchedule(workspace, now)).toHaveLength(1);
    softDeleteItemTree(workspace, parent.id, now.toISOString());
    expect(nativeReminderSchedule(workspace, now)).toHaveLength(0);
    delete parent.deletedAt; delete child.deletedAt; delete workspace.tombstones[parent.id]; delete workspace.tombstones[child.id];
    expect(nativeReminderSchedule(workspace, now)).toHaveLength(1);
  });
});
