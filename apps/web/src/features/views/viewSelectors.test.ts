import { describe, expect, it } from 'vitest';
import { createItem, createWorkspace, type SavedView } from '@utm/core';
import { viewFieldGroups } from './fieldCatalog';
import { boardSettingsFor, selectViewItems } from './viewSelectors';

const view = (source = 'true'): SavedView => ({
  id: 'view-test', name: 'Test', query: { source }, renderer: 'table', fields: ['title'], sort: [],
});

describe('view selectors', () => {
  it('filters and sorts view items without renderer state', () => {
    const workspace = createWorkspace('Views');
    const low = createItem('Low'); low.priority = 1;
    const high = createItem('High'); high.priority = 4;
    workspace.items[low.id] = low;
    workspace.items[high.id] = high;
    const savedView = { ...view('priority >= 2'), sortSource: 'priority desc' };
    expect(selectViewItems(workspace, savedView).map((item) => item.title)).toEqual(['High']);
  });

  it('keeps field grouping and board defaults in the views feature', () => {
    const workspace = createWorkspace('Fields');
    workspace.customFields.score = { id: 'score', key: 'score', label: 'Score', kind: 'number', required: false };
    expect(viewFieldGroups(workspace).find((group) => group.name === 'Custom fields')?.fields[0]?.label).toBe('Score');
    expect(boardSettingsFor(view())).toMatchObject({ groupBy: 'status', showEmpty: false });
  });
});
