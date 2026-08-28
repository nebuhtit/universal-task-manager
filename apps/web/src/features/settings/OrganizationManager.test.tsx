import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createWorkspace, ensureAreaDefinition, ensureProjectDefinition, ensureTagDefinition } from '@utm/core';
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
