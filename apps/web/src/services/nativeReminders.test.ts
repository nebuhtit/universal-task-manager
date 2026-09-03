import { describe, expect, it } from 'vitest';
import { createItem, createWorkspace } from '@utm/core';
import { nativeReminderSchedule } from './nativeReminders';

describe('native reminder scheduling', () => {
  it('resolves reminders, excludes unavailable entries and keeps the nearest future reminders', () => {
    const now = new Date('2026-09-03T10:00:00.000Z');
    const workspace = createWorkspace('Native reminders', now);
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
    }));
    expect(scheduled.some((entry) => entry.id.endsWith(':ack'))).toBe(false);
    expect(scheduled.some((entry) => entry.id.endsWith(':template'))).toBe(false);
  });
});
