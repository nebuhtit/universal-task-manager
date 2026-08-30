import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createItem, createWorkspace, ensureAreaDefinition, ensureProjectDefinition, ensureTagDefinition } from '@utm/core';
import { OrganizationManager } from './OrganizationManager';

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
    expect(markup).toContain('aria-label="Rename Area Work"');
    expect(markup).toContain('aria-label="Rename Project Alpha"');
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
    expect(markup.match(/aria-label="Color for Project Shared"/g)).toHaveLength(2);
  });

  it('uses Area and Project colors for their names without repeating the parent Area in a Project row', () => {
    const workspace = createWorkspace('Organization colors');
    ensureAreaDefinition(workspace, 'Work', { accent: '#2864c7' });
    ensureProjectDefinition(workspace, 'Launch', { areas: ['Work'], accent: '#147a55' });
    const markup = renderToStaticMarkup(<OrganizationManager workspace={workspace} commit={vi.fn()} />);
    expect(markup).toContain('class="organization-area-name" style="color:#2864c7"');
    expect(markup).toContain('class="organization-project-name" style="color:#147a55"');
    expect(markup).toContain('aria-label="Color for Area Work"');
    expect(markup).not.toContain('class="organization-project-areas"');
    expect(markup).toContain('class="is-area" style="color:#2864c7"');
    expect(markup).toContain('class="is-project" style="color:#147a55"');
    expect(markup).toContain('System group for Projects that are not linked to an Area.');
  });

  it('renders accessible draggable Tag rows with rename actions', () => {
    const workspace = createWorkspace('Tag ordering');
    ensureTagDefinition(workspace, 'urgent'); ensureTagDefinition(workspace, 'focus');
    const markup = renderToStaticMarkup(<OrganizationManager workspace={workspace} commit={vi.fn()} />);
    expect(markup).toContain('aria-label="Reorder Tag urgent"');
    expect(markup).toContain('aria-label="Reorder Tag focus"');
    expect(markup).toContain('aria-label="Rename Tag urgent"');
    expect(markup.match(/aria-label="Reorder No Tags"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(markup).toContain('Apply / Save order');
    expect(markup).toContain('Reset order');
    expect(markup).toContain('Order is saved');
  });
});
