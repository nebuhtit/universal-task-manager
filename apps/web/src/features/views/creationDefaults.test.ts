import { describe, expect, it } from 'vitest';
import { createWorkspace } from '@utm/core';
import { creationDefaultFieldOptions, defaultValueForPath } from './creationDefaults';

describe('view creation defaults', () => {
  it('exposes editable fields but not identity fields', () => {
    const workspace = createWorkspace('Defaults');
    const paths = creationDefaultFieldOptions(workspace).map((field) => field.path);
    expect(paths).toContain('priority');
    expect(paths).not.toContain('id');
    expect(defaultValueForPath(workspace, 'recurrence.rrule')).toBe('FREQ=WEEKLY;INTERVAL=1');
  });
});
