import { describe, expect, it } from 'vitest';
import type { SavedView } from '@utm/core';
import { modernizeLegacyViewScope } from './legacyViewScope';

const view = (): SavedView => ({ id: 'view-1', name: 'Work', renderer: 'list', query: { source: 'state == "open"' }, sort: [], fields: [], area: 'Work', project: 'Launch', list: 'Next' });

describe('modernizeLegacyViewScope', () => {
  it('moves legacy scope into filters and creation defaults without mutating the saved value', () => {
    const source = view();
    const result = modernizeLegacyViewScope(source);
    expect(result).not.toBe(source);
    expect(source).toMatchObject({ area: 'Work', project: 'Launch', list: 'Next' });
    expect(result).not.toHaveProperty('area');
    expect(result).not.toHaveProperty('project');
    expect(result).not.toHaveProperty('list');
    expect(result.creationDefaults).toMatchObject({ area: 'Work', project: 'Launch', list: 'Next' });
    expect(result.query.source).toContain('area == "Work"');
    expect(result.query.source).toContain('project == "Launch"');
    expect(result.query.source).toContain('list == "Next"');
  });

  it('preserves advanced filter code while adding the legacy constraints', () => {
    const source = view();
    source.query.source = 'customScore(title) > 2';
    const result = modernizeLegacyViewScope(source);
    expect(result.query.source).toContain('(customScore(title) > 2)');
    expect(result.query.source).toContain('area == "Work"');
  });
});
