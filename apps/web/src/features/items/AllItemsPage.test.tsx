import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createItem, createWorkspace } from '@utm/core';
import { AllItemsPage, allItemsViewFor } from './AllItemsPage';

describe('AllItemsPage metrics', () => {
  it('summarizes normal status sections below the page title', () => {
    const workspace = createWorkspace('All metrics');
    workspace.calendarPreferences.language = 'ru';
    const open = createItem('Open'); open.schedule = { timezone: 'UTC', estimatedDuration: 'PT25M' };
    const done = createItem('Done'); done.state = 'done';
    const cancelled = createItem('Cancelled'); cancelled.state = 'cancelled'; cancelled.schedule = { timezone: 'UTC', estimatedDuration: 'PT9H' };
    workspace.items[open.id] = open; workspace.items[done.id] = done; workspace.items[cancelled.id] = cancelled;

    const markup = renderToStaticMarkup(<AllItemsPage
      workspace={workspace}
      view={allItemsViewFor(workspace)}
      onEdit={vi.fn()}
      onState={vi.fn()}
      onSaveView={vi.fn()}
      onRestore={vi.fn()}
      onClearTrash={vi.fn()}
      onDelete={vi.fn()}
    />);
    expect(markup).toContain('<h1>All items</h1><span class="view-metrics-summary"');
    expect(markup).toContain('>25мин</span>');
    expect(markup).not.toContain('50%');
  });
  it('separates Google Calendar and UTM items while retaining status sections', () => {
    const workspace = createWorkspace('Sources');
    const local = createItem('Local task');
    const google = createItem('Calendar meeting', 'event');
    google.external = { provider: 'google_calendar', connectionId: 'connection', calendarId: 'primary', eventId: 'event', sourceUrl: 'https://calendar.google.com/', readOnly: true, syncedAt: '2026-09-08T08:00:00.000Z' };
    workspace.items = { [local.id]: local, [google.id]: google };
    const markup = renderToStaticMarkup(<AllItemsPage workspace={workspace} view={allItemsViewFor(workspace)} onEdit={vi.fn()} onState={vi.fn()} onSaveView={vi.fn()} onRestore={vi.fn()} onClearTrash={vi.fn()} onDelete={vi.fn()} />);
    const googleStart = markup.indexOf('Google Calendar items');
    const utmStart = markup.indexOf('UTM items');
    expect(googleStart).toBeGreaterThan(-1);
    expect(utmStart).toBeGreaterThan(googleStart);
    expect(markup.indexOf('Calendar meeting')).toBeGreaterThan(googleStart);
    expect(markup.indexOf('Calendar meeting')).toBeLessThan(utmStart);
    expect(markup.indexOf('Local task')).toBeGreaterThan(utmStart);
    expect(markup.match(/all-items-source-section/g)).toHaveLength(3);
    expect(markup).toContain('With reminders');
  });
});
