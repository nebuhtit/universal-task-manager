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
});
