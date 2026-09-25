import { describe, expect, it } from 'vitest';
import { createItem, createWorkspace, softDeleteItemTree } from '@utm/core';
import { visibleItemNotices } from './noticeVisibility';

describe('notice visibility', () => {
  it('drops deleted item and series-child reminders without dismissing unrelated notices', () => {
    const now = new Date('2026-09-23T10:00:00Z');
    const workspace = createWorkspace('Notices', now);
    const parent = createItem('Series', 'task', now); parent.role = 'series_template';
    const child = createItem('Occurrence', 'task', now);
    child.role = 'occurrence'; child.occurrence = { seriesId: parent.id, recurrenceId: now.toISOString(), sequence: 0, templateRevision: 1 };
    const other = createItem('Other', 'task', now);
    for (const item of [parent, child, other]) workspace.items[item.id] = item;
    const notices = [
      { id: 'child', title: child.title, body: 'Reminder', at: now.toISOString(), itemId: child.id },
      { id: 'other', title: other.title, body: 'Reminder', at: now.toISOString(), itemId: other.id },
      { id: 'backup', title: 'Backup', body: 'Backup reminder', at: now.toISOString() },
    ];
    expect(visibleItemNotices(workspace, notices)).toHaveLength(3);
    softDeleteItemTree(workspace, parent.id, now.toISOString());
    expect(visibleItemNotices(workspace, notices).map(notice => notice.id)).toEqual(['other', 'backup']);
  });
});
it('expires event-only notices at opening but retains overdue Due notices', () => {
  const now = new Date('2026-09-25T10:00:00Z');
  const workspace = createWorkspace('Notices', now);
  const past = createItem('Past event', 'event', now);
  past.schedule = { timezone: 'UTC', startAt: '2026-09-25T09:00:00Z', endAt: '2026-09-25T11:00:00Z' };
  const due = createItem('Late due', 'task', now);
  due.schedule = { timezone: 'UTC', startAt: '2026-09-25T09:00:00Z', dueAt: '2026-09-25T09:30:00Z' };
  workspace.items[past.id] = past; workspace.items[due.id] = due;
  const notices = [past, due].map(item => ({ id: item.id, title: item.title, body: 'Reminder', at: now.toISOString(), itemId: item.id }));
  expect(visibleItemNotices(workspace, notices, now.getTime()).map(notice => notice.id)).toEqual([due.id]);
});
