import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createItem, createWorkspace, type SavedView } from '@utm/core';
import { ViewResults } from './ViewResults';

describe('ViewResults manual ordering controls', () => {
  it('exposes touch and keyboard reorder handles only for ordered row renderers', () => {
    const workspace = createWorkspace('Reorder');
    const item = createItem('Alpha'); workspace.items[item.id] = item;
    const view: SavedView = { id: 'view', name: 'View', query: { source: 'true' }, renderer: 'list', fields: ['title'], sort: [] };
    const props = { workspace, onEdit: vi.fn(), onState: vi.fn(), onReorder: vi.fn() };

    const list = renderToStaticMarkup(<ViewResults {...props} view={view} />);
    expect(list).toContain('aria-label="Reorder Alpha"');
    expect(list).toContain(`data-view-item-id="${item.id}"`);

    const table = renderToStaticMarkup(<ViewResults {...props} view={{ ...view, renderer: 'table' }} />);
    expect(table).toContain('reorder-column');
    expect(table).toContain('aria-label="Reorder Alpha"');

    const calendar = renderToStaticMarkup(<ViewResults {...props} view={{ ...view, renderer: 'calendar' }} />);
    expect(calendar).not.toContain('aria-label="Reorder Alpha"');
  });
});
