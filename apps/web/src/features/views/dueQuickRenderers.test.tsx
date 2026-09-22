import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createItem, createWorkspace, type SavedView } from '@utm/core';
import { ViewResults } from './ViewResults';

describe('quick Due targets in view renderers', () => {
  it('marks editable items in list, table, board and calendar, but not read-only events', () => {
    const workspace = createWorkspace('Due views');
    const item = createItem('Editable');
    item.schedule = { timezone: 'UTC', dueAt: '2026-09-24T09:00:00.000Z' };
    workspace.items[item.id] = item;
    const imported = createItem('Imported', 'event');
    imported.schedule = { timezone: 'UTC', startAt: '2026-09-24T10:00:00.000Z', endAt: '2026-09-24T11:00:00.000Z' };
    imported.external = { provider: 'google_calendar', connectionId: 'connection', calendarId: 'primary', eventId: 'event', sourceUrl: 'https://calendar.google.com/', readOnly: true, syncedAt: '2026-09-24T08:00:00.000Z' };
    workspace.items[imported.id] = imported;
    const base: SavedView = { id: 'due', name: 'Due', query: { source: 'true' }, renderer: 'list', fields: ['title'], sort: [] };
    for (const renderer of ['list', 'table', 'board', 'calendar'] as const) {
      const markup = renderToStaticMarkup(<ViewResults workspace={workspace} view={{ ...base, renderer }} onEdit={vi.fn()} onState={vi.fn()} />);
      expect(markup, renderer).toContain(`data-utm-due-item-id="${item.id}"`);
      expect(markup, renderer).not.toContain(`data-utm-due-item-id="${imported.id}"`);
    }
  });
});
