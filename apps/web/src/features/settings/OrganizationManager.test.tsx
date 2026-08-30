import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createItem, createWorkspace, ensureAreaDefinition, ensureProjectDefinition, ensureTagDefinition } from '@utm/core';
import { OrganizationManager, createParaStructurePackage, paraAreaViews, paraProjectView, paraTagView, paraViewsForExport, pinParaView, unpinParaView } from './OrganizationManager';
import { applyViewCreationDefaults } from '../views/applyCreationDefaults';

describe('OrganizationManager', () => {
  it('renders an already-open legacy workspace before persistence migration completes', () => {
    const workspace = createWorkspace('Legacy settings');
    delete (workspace as Partial<typeof workspace>).organizationPreferences;
    const markup = renderToStaticMarkup(<OrganizationManager workspace={workspace} commit={vi.fn()} />);
    expect(markup).toContain('No Area');
    expect(markup).toContain('No Project');
    expect(markup).toContain('No Tags');
    expect(markup).not.toContain('Priority 0');
    expect(markup).toContain('aria-label="New tag"');
    expect(markup).toContain('Add Tag');
  });

  it('renders accessible Project reorder handles inside an Area', () => {
    const workspace = createWorkspace('Project ordering');
    ensureAreaDefinition(workspace, 'Work');
    ensureProjectDefinition(workspace, 'Alpha', { areas: ['Work'] });
    ensureProjectDefinition(workspace, 'Beta', { areas: ['Work'] });
    const markup = renderToStaticMarkup(<OrganizationManager workspace={workspace} commit={vi.fn()} />);
    expect(markup).toContain('aria-label="Reorder Area Work"');
    expect(markup).toContain('aria-label="Reorder No Area"');
    expect(markup).toContain('aria-label="Reorder Project Alpha"');
    expect(markup).toContain('aria-label="Reorder Project Beta"');
    expect(markup).toContain('aria-label="Reorder Project Alpha in Work"');
    expect(markup).toContain('aria-label="Reorder Project Beta in Work"');
    expect(markup).toContain('<details class="ui-surface organization-area-group">');
    expect(markup).not.toContain('aria-label="Rename Area Work"');
    expect(markup).not.toContain('aria-label="Rename Project Alpha"');
    expect(markup).toContain('class="organization-entity-link organization-area-name"');
  });

  it('renders a scoped Unified priority occurrence for every Project Area', () => {
    const workspace = createWorkspace('Shared project');
    ensureAreaDefinition(workspace, 'Work');
    ensureAreaDefinition(workspace, 'Personal');
    ensureProjectDefinition(workspace, 'Shared', { areas: ['Work', 'Personal'] });
    const markup = renderToStaticMarkup(<OrganizationManager workspace={workspace} commit={vi.fn()} />);
    expect(markup).toContain('aria-label="Reorder Project Shared in Work"');
    expect(markup).toContain('aria-label="Reorder Project Shared in Personal"');
    expect(markup).toContain('In Work');
    expect(markup).toContain('In Personal');
  });

  it('renders the same compact metrics in every Area occurrence but not Unified priority', () => {
    const workspace = createWorkspace('Project metrics');
    ensureAreaDefinition(workspace, 'Work'); ensureAreaDefinition(workspace, 'Personal');
    ensureProjectDefinition(workspace, 'Shared', { areas: ['Work', 'Personal'], accent: '#2864c7' });
    const done = createItem('Done'); done.projects = ['Shared']; done.state = 'done'; done.schedule = { timezone: 'UTC', estimatedDuration: 'PT20M' };
    const open = createItem('Open'); open.projects = ['Shared']; open.schedule = { timezone: 'UTC', estimatedDuration: 'PT40M', dueAt: '2026-08-30T12:00:00.000Z' };
    workspace.items[done.id] = done; workspace.items[open.id] = open;
    const markup = renderToStaticMarkup(<OrganizationManager workspace={workspace} commit={vi.fn()} />);
    expect(markup.match(/class="organization-project-metrics"/g)).toHaveLength(2);
    expect(markup.match(/aria-label="Project Shared completion"/g)).toHaveLength(2);
    expect(markup.match(/aria-valuenow="50"/g)).toHaveLength(2);
    expect(markup.match(/Completed items/g)).toHaveLength(2);
    expect(markup.match(/20 min \/ 1 h/g)).toHaveLength(2);
    expect(markup.match(/--project-progress-color:#2864c7/g)).toHaveLength(2);
    expect(markup).not.toContain('aria-label="Color for Project Shared"');
  });

  it('uses Area, Project and Tag colors for their names without repeating the parent Area in a Project row', () => {
    const workspace = createWorkspace('Organization colors');
    ensureAreaDefinition(workspace, 'Work', { accent: '#2864c7' });
    ensureProjectDefinition(workspace, 'Launch', { areas: ['Work'], accent: '#147a55' });
    ensureTagDefinition(workspace, 'urgent', { accent: '#8b5cf6' });
    const markup = renderToStaticMarkup(<OrganizationManager workspace={workspace} commit={vi.fn()} />);
    expect(markup).toContain('class="organization-entity-link organization-area-name" style="color:#2864c7"');
    expect(markup).toContain('class="organization-entity-link organization-project-name" style="color:#147a55"');
    expect(markup).not.toContain('aria-label="Color for Area Work"');
    expect(markup).not.toContain('class="organization-project-areas"');
    expect(markup).toContain('class="organization-entity-link is-area" style="color:#2864c7"');
    expect(markup).toContain('class="organization-entity-link is-project" style="color:#147a55"');
    expect(markup).toContain('class="organization-entity-link organization-tag-entry" style="color:#8b5cf6"');
    expect(markup).toContain('class="organization-entity-link is-tag" style="color:#8b5cf6"');
  });

  it('builds Area, Project and Tag detail views from the existing SavedView model', () => {
    const workspace = createWorkspace('PARA views');
    ensureAreaDefinition(workspace, 'Work');
    ensureProjectDefinition(workspace, 'Launch', { areas: ['Work'] });
    const areaViews = paraAreaViews(workspace, 'Work');
    expect(areaViews.map((view) => view.name)).toEqual(['Launch', 'No Project']);
    expect(areaViews[0]).toMatchObject({ area: 'Work', project: 'Launch', fields: ['title', 'bodyMarkdown', 'schedule.startAt', 'schedule.dueAt', 'tags', 'area', 'project'] });
    expect(areaViews[1]?.query.source).toContain('length(projects) == 0');
    expect(paraProjectView('Launch')).toMatchObject({ project: 'Launch', name: 'Launch' });
    expect(paraTagView('urgent')).toMatchObject({ name: '#urgent', creationDefaults: { tags: ['urgent'] } });
    expect(paraTagView('urgent').query.source).toContain('includes(tags, "urgent")');
    expect(paraTagView()).toMatchObject({ name: 'No Tags', creationDefaults: { tags: [] } });
    expect(paraTagView().query.source).toContain('length(tags) == 0');
  });

  it('pins a PARA view once at the bottom of Home order and unpins it again', () => {
    const workspace = createWorkspace('Pinned PARA');
    const view = paraProjectView('Launch');
    const first = pinParaView(workspace, view, 'pinned-launch');
    const second = pinParaView(workspace, view, 'duplicate-launch');
    expect(first).toBe('pinned-launch');
    expect(second).toBe('pinned-launch');
    expect(workspace.viewOrder.at(-1)).toBe('pinned-launch');
    expect(workspace.views['duplicate-launch']).toBeUndefined();
    expect(paraViewsForExport(workspace).map((candidate) => candidate.id)).toEqual(['pinned-launch']);
    expect(unpinParaView(workspace, view)).toBe('pinned-launch');
    expect(workspace.views['pinned-launch']).toBeUndefined();
    expect(workspace.viewOrder).not.toContain('pinned-launch');
  });

  it('exports only pinned PARA views and not ordinary Home views', () => {
    const workspace = createWorkspace('PARA export');
    pinParaView(workspace, paraProjectView('Launch'), 'pinned-launch');
    workspace.views.custom = { ...paraProjectView('Other'), id: 'custom', extensions: {} };
    expect(paraViewsForExport(workspace).map((view) => view.id)).toEqual(['pinned-launch']);
  });

  it('builds a structure-only PARA package without items or ordinary Home views', () => {
    const workspace = createWorkspace('Portable PARA');
    ensureAreaDefinition(workspace, 'Work', { accent: '#2864c7' });
    ensureProjectDefinition(workspace, 'Launch', { areas: ['Work'], accent: '#147a55' });
    ensureTagDefinition(workspace, 'urgent');
    workspace.items.item = createItem('Private task');
    pinParaView(workspace, paraProjectView('Launch'), 'pinned-launch');
    workspace.views.custom = { ...paraProjectView('Other'), id: 'custom', extensions: {} };

    const portable = createParaStructurePackage(workspace);
    expect(portable.items).toEqual([]);
    expect(portable.views.map((view) => view.id)).toEqual(['pinned-launch']);
    expect(portable.areaDefinitions?.Work?.accent).toBe('#2864c7');
    expect(portable.projectDefinitions?.Launch).toMatchObject({ areas: ['Work'], accent: '#147a55' });
    expect(portable.organizationPreferences).toEqual(workspace.organizationPreferences);
    expect(portable.customFields).toEqual({});
  });

  it('reuses View creation defaults when adding from Area, Project and Tag details', () => {
    const workspace = createWorkspace('PARA defaults');
    const areaItem = applyViewCreationDefaults(createItem('Area item'), paraAreaViews(workspace, 'Work').at(-1)!, workspace);
    const projectItem = applyViewCreationDefaults(createItem('Project item'), paraProjectView('Launch'), workspace);
    const tagItem = applyViewCreationDefaults(createItem('Tag item'), paraTagView('urgent'), workspace);
    expect(areaItem.areas).toEqual(['Work']);
    expect(areaItem.projects).toEqual([]);
    expect(projectItem.projects).toEqual(['Launch']);
    expect(tagItem.tags).toEqual(['urgent']);
  });

  it('renders accessible draggable Tag rows as links to their detail pages', () => {
    const workspace = createWorkspace('Tag ordering');
    ensureTagDefinition(workspace, 'urgent'); ensureTagDefinition(workspace, 'focus');
    const markup = renderToStaticMarkup(<OrganizationManager workspace={workspace} commit={vi.fn()} />);
    expect(markup).toContain('aria-label="Reorder Tag urgent"');
    expect(markup).toContain('aria-label="Reorder Tag focus"');
    expect(markup).toContain('class="organization-entity-link organization-tag-entry"');
    expect(markup.match(/aria-label="Reorder No Tags"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(markup).toContain('Apply / Save order');
    expect(markup).toContain('Reset order');
    expect(markup).toContain('Order is saved');
  });
});
