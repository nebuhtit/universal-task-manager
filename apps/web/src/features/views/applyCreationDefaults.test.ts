import { describe, expect, it } from 'vitest';
import { createItem, createWorkspace, ensureProjectDefinition, type SavedView } from '@utm/core';
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
});
