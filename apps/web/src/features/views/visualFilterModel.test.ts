import { describe, expect, it } from 'vitest';
import { parseVisualRows, serializeVisualRows, toSqlExpression, visualOperators } from './visualFilterModel';

describe('visual filter model', () => {
  it('round-trips the existing visual DSL without changing its syntax', () => {
    const source = '(state == "open" && priority >= 2)';
    const rows = parseVisualRows(source);
    expect(rows).not.toBeNull();
    expect(serializeVisualRows(rows!)).toBe(source);
  });

  it('keeps type-sensitive operators and SQL preview', () => {
    expect(visualOperators('priority')).toContain('>=');
    expect(visualOperators('tags')).toContain('has any');
    expect(toSqlExpression('state == "open" && priority >= 2')).toBe('state = "open" AND priority >= 2');
  });
});
