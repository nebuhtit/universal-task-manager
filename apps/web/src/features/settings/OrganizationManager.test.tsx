import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createWorkspace } from '@utm/core';
import { OrganizationManager } from './OrganizationManager';

describe('OrganizationManager', () => {
  it('renders an already-open legacy workspace before persistence migration completes', () => {
    const workspace = createWorkspace('Legacy settings');
    delete (workspace as Partial<typeof workspace>).organizationPreferences;
    const markup = renderToStaticMarkup(<OrganizationManager workspace={workspace} commit={vi.fn()} />);
    expect(markup).toContain('Items without Area');
    expect(markup).toContain('Items without Project');
    expect(markup).toContain('Tag priorities');
  });
});
