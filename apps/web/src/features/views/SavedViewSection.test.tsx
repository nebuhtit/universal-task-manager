import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createItem, createWorkspace, type SavedView } from '@utm/core';
import { SavedViewSection } from './SavedViewSection';

describe('SavedViewSection metrics', () => {
  it('shows metrics under the view title and keeps zero percent hidden', () => {
    const workspace = createWorkspace('Metrics');
    workspace.calendarPreferences.language = 'ru';
    const open = createItem('Open'); open.schedule = { timezone: 'UTC', estimatedDuration: 'PT40M' };
    const done = createItem('Done'); done.state = 'done'; done.schedule = { timezone: 'UTC', estimatedDuration: 'PT20M' };
    workspace.items[open.id] = open; workspace.items[done.id] = done;
    const view: SavedView = { id: 'view', name: 'Work', query: { source: 'true' }, renderer: 'list', fields: ['title'], sort: [] };
    const props = { workspace, onEditItem: vi.fn(), onState: vi.fn(), onRendererChange: vi.fn(), onAddItem: vi.fn() };

    const allMarkup = renderToStaticMarkup(<SavedViewSection {...props} view={view} initialOpen={false} />);
    expect(allMarkup).toContain('<h2><span translate="no" data-utm-user-data="true">Work</span></h2><span class="view-metrics-summary"');
    expect(allMarkup).toContain('33% · 40мин');
    expect(allMarkup).toContain('aria-label="Развернуть Work. Выполнено 33 процентов. Осталось');
    expect(allMarkup).toContain('aria-expanded="false"');

    const openMarkup = renderToStaticMarkup(<SavedViewSection {...props} view={{ ...view, query: { source: 'state == "open"' } }} />);
    expect(openMarkup).toContain('>40мин</span>');
    expect(openMarkup).not.toContain('0%');

    const hiddenMarkup = renderToStaticMarkup(<SavedViewSection {...props} view={{ ...view, statistics: { showTime: false, reservedItemIds: [] } }} />);
    expect(hiddenMarkup).not.toContain('view-metrics-summary');
    expect(hiddenMarkup).not.toContain('Выполнено 33 процентов');
  });

  it('keeps a user View name verbatim when it is also an interface translation key', () => {
    const workspace = createWorkspace('Localization guard');
    workspace.calendarPreferences.language = 'ru';
    const view: SavedView = { id: 'user-home', name: 'Home', query: { source: 'true' }, renderer: 'list', fields: ['title'], sort: [] };
    const markup = renderToStaticMarkup(<SavedViewSection workspace={workspace} view={view} initialOpen={false} onEditItem={vi.fn()} onState={vi.fn()} onRendererChange={vi.fn()} onAddItem={vi.fn()} />);

    expect(markup).toContain('data-utm-user-data="true">Home</span>');
    expect(markup).not.toContain('>Главная</span>');
    expect(markup).toContain('aria-label="Развернуть Home');
  });
});
