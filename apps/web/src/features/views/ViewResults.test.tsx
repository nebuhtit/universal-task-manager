import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createItem, createWorkspace, type SavedView } from '@utm/core';
import { VIEW_LIVE_TICK_MS, ViewResults, viewNeedsLiveClock } from './ViewResults';

describe('ViewResults manual ordering controls', () => {
  it('enables the one-second clock only for displayed script results', () => {
    expect(VIEW_LIVE_TICK_MS).toBe(1_000);
    expect(viewNeedsLiveClock({ fields: ['title', 'scripts'] })).toBe(true);
    expect(viewNeedsLiveClock({ fields: ['title', 'script.remaining'] })).toBe(true);
    expect(viewNeedsLiveClock({ fields: ['title', 'schedule.dueAt'] })).toBe(false);
  });

  it('exposes touch and keyboard reorder handles only for ordered row renderers', () => {
    const workspace = createWorkspace('Reorder');
    const item = createItem('Alpha'); workspace.items[item.id] = item;
    const view: SavedView = { id: 'view', name: 'View', query: { source: 'true' }, renderer: 'list', fields: ['title'], sort: [] };
    const props = { workspace, onEdit: vi.fn(), onState: vi.fn(), onReorder: vi.fn() };

    const list = renderToStaticMarkup(<ViewResults {...props} view={view} />);
    expect(list).toContain('aria-label="Reorder Alpha"');
    expect(list).toContain(`data-view-item-id="${item.id}"`);
    expect(list).toContain('data-sound="none"');

    const table = renderToStaticMarkup(<ViewResults {...props} view={{ ...view, renderer: 'table' }} />);
    expect(table).toContain('reorder-column');
    expect(table).toContain('aria-label="Reorder Alpha"');

    const calendar = renderToStaticMarkup(<ViewResults {...props} view={{ ...view, renderer: 'calendar' }} />);
    expect(calendar).not.toContain('aria-label="Reorder Alpha"');
  });

  it('preserves emoji in item titles for list and table views', () => {
    const workspace = createWorkspace('Emoji');
    const item = createItem('📌 Call mom 👩‍👦'); workspace.items[item.id] = item;
    const view: SavedView = { id: 'emoji-view', name: 'Emoji', query: { source: 'true' }, renderer: 'list', fields: ['title'], sort: [] };
    const props = { workspace, onEdit: vi.fn(), onState: vi.fn() };
    expect(renderToStaticMarkup(<ViewResults {...props} view={view} />)).toContain('📌 Call mom 👩‍👦');
    expect(renderToStaticMarkup(<ViewResults {...props} view={{ ...view, renderer: 'table' }} />)).toContain('📌 Call mom 👩‍👦');
  });

  it('uses the initiating View color for every celebrating duplicate', () => {
    const workspace = createWorkspace('Celebration');
    const item = createItem('Shared item'); workspace.items[item.id] = item;
    const celebrationColors = new Map([[item.id, '#c27a00']]);
    const props = { workspace, onEdit: vi.fn(), onState: vi.fn(), celebrationColors };
    const first: SavedView = { id: 'first', name: 'First', accent: '#c27a00', query: { source: 'true' }, renderer: 'list', fields: ['title'], sort: [] };
    const duplicate: SavedView = { ...first, id: 'duplicate', name: 'Duplicate', accent: '#2864c7' };

    const firstMarkup = renderToStaticMarkup(<ViewResults {...props} view={first} />);
    const duplicateMarkup = renderToStaticMarkup(<ViewResults {...props} view={duplicate} />);
    expect(firstMarkup).toContain('is-celebrating');
    expect(firstMarkup).toContain('--completion-accent:#c27a00');
    expect(duplicateMarkup).toContain('--completion-accent:#c27a00');
    expect(duplicateMarkup).not.toContain('--completion-accent:#2864c7');
  });

  it('renders mirrored Google events as read-only in every renderer', () => {
    const workspace = createWorkspace('Google');
    const item = createItem('Imported meeting', 'event');
    item.schedule = { timezone: 'UTC', startAt: '2026-08-31T10:00:00.000Z', endAt: '2026-08-31T11:00:00.000Z' };
    item.external = { provider: 'google_calendar', connectionId: 'connection', calendarId: 'primary', eventId: 'event', sourceUrl: 'https://calendar.google.com/', readOnly: true, syncedAt: '2026-08-31T09:00:00.000Z' };
    workspace.items[item.id] = item;
    const view: SavedView = { id: 'google', name: 'Google', query: { source: 'true' }, renderer: 'list', fields: ['title', 'external.provider'], sort: [] };
    const props = { workspace, onEdit: vi.fn(), onState: vi.fn() };
    for (const renderer of ['list', 'table', 'calendar', 'board'] as const) {
      const markup = renderToStaticMarkup(<ViewResults {...props} view={{ ...view, renderer }} />);
      expect(markup).toContain('aria-label="Read-only Google Calendar event"');
      expect(markup).toContain('disabled=""');
    }
  });
});
