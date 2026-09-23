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
