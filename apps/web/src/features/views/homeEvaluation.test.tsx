import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { createItem, createWorkspace, type SavedView } from '@utm/core';
import * as selectors from './viewSelectors';
import { SavedViewSection } from './SavedViewSection';
import { createHomeEvaluationCache } from './useViewEvaluation';

afterEach(() => vi.restoreAllMocks());
const view: SavedView = { id: 'first', name: 'First', query: { source: 'true' }, renderer: 'list', fields: ['title'], sort: [], statistics: { showTime: false, reservedItemIds: [] } };
const handlers = { onEditItem: () => {}, onState: () => {}, onRendererChange: () => {}, onAddItem: () => {} };

it('reuses unchanged results, refreshes at boundaries, and never restores stale collapsed data', () => {
  const workspace = createWorkspace('Test');
  workspace.calendarPreferences.timezone = 'UTC';
  const item = createItem('Old'); item.schedule = { startAt: '2026-09-30T12:00:00.000Z', timezone: 'UTC' };
  workspace.items[item.id] = item;
  const timed = { ...view, query: { source: 'schedule.startAt <= now()' } };
  const run = createHomeEvaluationCache();
  const before = new Date('2026-09-30T11:59:59.000Z');
  const first = run(workspace, [timed], before, 0).get(view.id)!;
  expect(first.items).toHaveLength(0);
  expect(run(workspace, [timed], before, 0).get(view.id)).toBe(first);
  const after = new Date('2026-09-30T12:00:01.000Z');
  expect(run(workspace, [timed], after, 0).get(view.id)!.items).toHaveLength(1);
  expect(run(workspace, [], after, 0).size).toBe(0);
  const changed = structuredClone(workspace); changed.items[item.id]!.title = 'New';
  expect(run(changed, [timed], after, 0).get(view.id)!.items[0]!.title).toBe('New');
  expect(run(changed, [timed], before, 0).get(view.id)!.items).toHaveLength(0);
});

it('does not evaluate a collapsed section', () => {
  const workspace = createWorkspace('Test');
  const evaluate = vi.spyOn(selectors, 'evaluateView');
  renderToStaticMarkup(<SavedViewSection {...handlers} workspace={workspace} view={view} initialOpen={false} />);
  expect(evaluate).not.toHaveBeenCalled();
});

it('uses the same evaluated result for display and deduplication', () => {
  const workspace = createWorkspace('Test');
  const item = createItem('Visible'); workspace.items[item.id] = item;
  const second = { ...view, id: 'second' };
  const now = new Date();
  const evaluations = new Map([view, second].map(entry => [entry.id, selectors.evaluateView(workspace, entry, now)]));
  const evaluate = vi.spyOn(selectors, 'evaluateView');
  const hidden = selectors.hiddenItemIdsByExpandedView(workspace, [view, second], new Set(['first', 'second']), now, evaluations);
  expect(hidden.get('second')?.has(item.id)).toBe(true);
  const markup = renderToStaticMarkup(<SavedViewSection {...handlers} workspace={workspace} view={view} initialOpen suppliedEvaluation={evaluations.get('first')} />);
  expect(markup).toContain('Visible');
  expect(evaluate).not.toHaveBeenCalled();
});
