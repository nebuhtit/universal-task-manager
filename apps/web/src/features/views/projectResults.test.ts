import { describe, expect, it } from 'vitest';
import { createWorkspace, createItem, ensureProjectDefinition, calculateProjectMetrics, migrateView, renameProjectDefinition, type SavedView } from '@utm/core';
import { evaluateView, hiddenItemIdsByExpandedView } from './viewSelectors';
import { projectResultId } from './projectResults';

const now = new Date('2026-09-07T12:00:00Z');
function fixture() {
  const workspace = createWorkspace('Projects', now);
  workspace.calendarPreferences.timezone = 'UTC';
  ensureProjectDefinition(workspace, 'Launch', { areas: ['Work'] });
  ensureProjectDefinition(workspace, 'Other');
  const done = createItem('Done', 'task', now); done.state = 'done';
  const open = createItem('Open', 'task', now);
  for (const [item, minutes] of [[done, 10], [open, 90]] as const) {
    item.projects = ['Launch', 'Other']; item.tags = ['important'];
    item.schedule = { timezone: 'UTC', dueAt: '2026-09-07T10:00:00Z', estimatedDuration: `PT${minutes}M` };
    workspace.items[item.id] = item;
  }
  const view: SavedView = { id: 'v', name: 'Projects', renderer: 'list', query: { source: 'state == "open" && includes(tags, "important") && dueTodayOrOverdue' }, fields: ['title'], sort: [], resultTypes: ['project'], projectQuery: { source: 'includes(project, "Launch")' }, statistics: { showTime: true, reservedItemIds: [], includeHiddenCompleted: true } };
  return { workspace, view, open, done };
}

describe('project view results', () => {
  it('sorts project rows by available metrics and missing fields with explicit null placement', () => {
    const { workspace, view, open } = fixture();
    view.projectQuery = { source: 'true' };
    open.projects = ['Launch'];
    view.sortSource = 'remainingDurationMs desc nulls last';
    expect(evaluateView(workspace, view, now).results!.map((row) => row.kind === 'project' ? row.name : '')).toEqual(['Launch', 'Other']);
    view.resultTypes = ['item', 'project']; view.sortSource = 'state asc nulls first';
    expect(evaluateView(workspace, view, now).results![0]!.kind).toBe('project');
    view.projectQuery = { source: 'includes(area, "Work")' };
    expect(evaluateView(workspace, view, now).results!.filter((row) => row.kind === 'project')).toHaveLength(1);
  });
  it('uses duration weighted progress in PARA and filtered links without double counting', () => {
    const { workspace, view } = fixture();
    const result = evaluateView(workspace, view, now);
    expect(result.items).toEqual([]);
    expect(result.results).toHaveLength(1);
    expect(result.results![0]).toMatchObject({ kind: 'project', name: 'Launch', completionPercent: 10, remainingDurationMs: 90 * 60_000 });
    expect(calculateProjectMetrics(workspace, now).Launch!.completionPercent).toBe(10);
    view.resultTypes = ['item', 'project']; view.projectQuery = { source: 'true' };
    expect(evaluateView(workspace, view, now).metrics).toMatchObject({ totalItems: 2, completedItems: 1, completionPercent: 10, remainingDurationMs: 90 * 60_000 });
  });
  it('respects the checkbox, period, tags, exclusions and empty projects', () => {
    const { workspace, view, done, open } = fixture();
    view.statistics!.includeHiddenCompleted = false;
    expect(evaluateView(workspace, view, now).results![0]).toMatchObject({ completionPercent: 0 });
    view.statistics!.includeHiddenCompleted = true;
    done.tags = ['other'];
    expect(evaluateView(workspace, view, now).metrics!.completedItems).toBe(0);
    done.tags = ['important']; done.schedule!.dueAt = '2026-09-09T10:00:00Z';
    expect(evaluateView(workspace, view, now).metrics!.completedItems).toBe(0);
    view.query.source += ` && id != "${open.id}"`;
    expect(evaluateView(workspace, view, now).results).toEqual([]);
  });
  it('handles zero duration, auto-closed items and calendar compatibility', () => {
    const { workspace, view, done, open } = fixture();
    done.state = 'auto_closed';
    expect(evaluateView(workspace, view, now).metrics!.completionPercent).toBe(10);
    done.schedule!.estimatedDuration = 'PT0M'; open.schedule!.estimatedDuration = 'PT0M';
    expect(evaluateView(workspace, view, now).results![0]).toMatchObject({ completionPercent: null });
    view.renderer = 'calendar';
    expect(evaluateView(workspace, view, now).results!.every((row) => row.kind === 'item')).toBe(true);
  });
  it('round trips settings, renames project links and leaves old views item-only', () => {
    const { workspace, view } = fixture(); workspace.views.v = view;
    expect(migrateView(view).value.resultTypes).toEqual(['project']);
    view.extensions = { 'utm:manualOrder': [projectResultId('Launch')] };
    renameProjectDefinition(workspace, 'Launch', 'Renamed', now);
    expect(view.projectQuery!.source).toContain('Renamed');
    expect(view.extensions['utm:manualOrder']).toEqual([projectResultId('Renamed')]);
    expect(evaluateView(workspace, view, now).results![0]).toMatchObject({ name: 'Renamed' });
    delete workspace.projectDefinitions.Renamed;
    expect(evaluateView(workspace, view, now).results).toEqual([]);
    delete view.resultTypes;
    expect(evaluateView(workspace, view, now).results!.every((row) => row.kind === 'item')).toBe(true);
  });
  it('claims projects separately from individual items in expanded home views', () => {
    const { workspace, view, open } = fixture();
    const second: SavedView = { ...view, id: 'second', resultTypes: ['item', 'project'] };
    const hidden = hiddenItemIdsByExpandedView(workspace, [view, second], new Set(['v', 'second']), now);
    expect(hidden.get('second')!.has(projectResultId('Launch'))).toBe(true);
    expect(hidden.get('second')!.has(open.id)).toBe(false);
    expect(hiddenItemIdsByExpandedView(workspace, [view, second], new Set(['second']), now).get('second')!.size).toBe(0);
  });
});
