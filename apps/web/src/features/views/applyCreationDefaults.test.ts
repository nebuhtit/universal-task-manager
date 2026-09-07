import { describe, expect, it } from 'vitest';
import { VIEW_CREATION_DUE_PERIOD_EXTENSION, createItem, createWorkspace, ensureProjectDefinition, type SavedView } from '@utm/core';
import { applyViewCreationDefaults } from './applyCreationDefaults';

const view = (): SavedView => ({ id: 'view', name: 'Work / Vehicle', query: { source: 'true' }, renderer: 'list', sort: [], fields: ['title'], area: 'Work', project: 'Vehicle repair', list: 'This week', creationDefaults: { area: 'Wrong area', project: 'Wrong project', priority: 4 } });

describe('View creation defaults', () => {
  it('prefills independent Area, Project and list while keeping item urgency separate', () => {
    const source = createItem('New item');
    const created = applyViewCreationDefaults(source, view());
    expect(created).toMatchObject({ areas: ['Work'], projects: ['Vehicle repair'], list: 'This week', priority: 4 });
    expect(source).not.toHaveProperty('area');
  });

  it('inherits an Area from Project metadata when the View pins only the Project', () => {
    const workspace = createWorkspace('Project parent'); ensureProjectDefinition(workspace, 'Vehicle repair', { area: 'Work' });
    const { area: _area, list: _list, creationDefaults: _defaults, ...projectView } = view();
    expect(applyViewCreationDefaults(createItem(''), projectView, workspace)).toMatchObject({ projects: ['Vehicle repair'], areas: ['Work'] });
  });

  it('applies modern creation-default organization without legacy View scope fields', () => {
    const workspace = createWorkspace('Modern defaults'); ensureProjectDefinition(workspace, 'Vehicle repair', { area: 'Work' });
    const modern: SavedView = { id: 'modern', name: 'Modern', query: { source: 'project == "Vehicle repair"' }, renderer: 'list', sort: [], fields: [], creationDefaults: { project: 'Vehicle repair', list: 'Next' } };
    expect(applyViewCreationDefaults(createItem(''), modern, workspace)).toMatchObject({ projects: ['Vehicle repair'], areas: ['Work'], list: 'Next' });
  });

  it('prefills Today and Tomorrow template items with a 12:00 deadline in the workspace timezone', () => {
    const workspace = createWorkspace('Noon'); workspace.calendarPreferences.timezone = 'Europe/Berlin';
    const item = createItem('', 'task', new Date('2026-03-29T00:30:00.000Z'));
    const temporalView = (period: 'today' | 'tomorrow'): SavedView => ({ id: period, name: period, query: { source: 'true' }, renderer: 'list', sort: [], fields: [], extensions: { [VIEW_CREATION_DUE_PERIOD_EXTENSION]: period } });
    item.schedule = { timezone: 'Europe/Berlin', startAt: '2026-03-29T12:00:00.000Z', endAt: '2026-03-29T13:00:00.000Z' };
    const today = applyViewCreationDefaults(item, temporalView('today'), workspace);
    expect(today.schedule).toEqual({ timezone: 'Europe/Berlin', dueAt: '2026-03-29T10:00:00.000Z' });
    expect(applyViewCreationDefaults(item, temporalView('tomorrow'), workspace).schedule).toMatchObject({ timezone: 'Europe/Berlin', dueAt: '2026-03-30T10:00:00.000Z' });
  });
});
