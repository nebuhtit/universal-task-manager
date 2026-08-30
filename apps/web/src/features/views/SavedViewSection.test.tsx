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
    expect(allMarkup).toContain('<h2>Work</h2><span class="view-metrics-summary"');
    expect(allMarkup).toContain('33% · 40мин');
    expect(allMarkup).toContain('aria-label="Expand Work. Выполнено 33 процентов. Осталось');
    expect(allMarkup).toContain('aria-expanded="false"');

    const openMarkup = renderToStaticMarkup(<SavedViewSection {...props} view={{ ...view, query: { source: 'state == "open"' } }} />);
    expect(openMarkup).toContain('>40мин</span>');
    expect(openMarkup).not.toContain('0%');
  });
});
