import { describe, expect, it } from 'vitest';
import { compileQuery, createItem, evaluateExpression, expressionDependsOnCurrentTime, expressionToDsl, filterToPython, parseExpression, pythonToFilter, validateFilterProgram } from './index.js';

describe('Python-like filter programs', () => {
  const item = createItem('Work meeting');
  item.tags = ['work', 'urgent'];
  const run = (source: string) => compileQuery(pythonToFilter(source))(item);

  it('uses the first matching branch and lazily evaluates results', () => {
    expect(run('if True:\n    return True\nelif True:\n    return False\nelse:\n    return False')).toBe(true);
    expect(run('if False:\n    return daysUntil("invalid") > 0\nreturn True')).toBe(true);
    expect(run('if not True:\n    return True\nelse:\n    return False')).toBe(false);
  });
  it('applies a common Schedule boundary to completed items', () => {
    const source = pythonToFilter('if not scheduleInPeriod("today", "due", False, 7, "", ""):\n    return False\nif state == "done":\n    return True\nelif state == "open":\n    return True\nelse:\n    return False');
    const query = compileQuery(source, undefined, { timeZone: 'Europe/Moscow' });
    const completed = createItem('Completed'); completed.state = 'done';
    completed.schedule = { dueAt: '2026-09-07T09:00:00Z' };
    expect(query(completed, new Date('2026-09-07T12:00:00Z'))).toBe(true);
    completed.schedule.dueAt = '2026-09-06T09:00:00Z';
    expect(query(completed, new Date('2026-09-07T12:00:00Z'))).toBe(false);
    expect(expressionDependsOnCurrentTime(source)).toBe(true);
  });
  it('handles nested branches and fallthrough', () => {
    expect(run('if True:\n    if False:\n        return False\nreturn True')).toBe(true);
    expect(run('if False:\n    return True')).toBe(false);
  });
  it('supports bounded any and all and collection member access', () => {
    expect(run('return any(entry == "urgent" for entry in item.tags)')).toBe(true);
    expect(run('return all(length(entry) > 2 for entry in tags)')).toBe(true);
    expect(run('return any(entry == "missing" for entry in tags)')).toBe(false);
    item.relations = [{ type: 'related', targetId: 'test' }];
    expect(run('return any(entry.targetId == "test" for entry in relations)')).toBe(true);
    expect(run('return all(entry == "x" for entry in contexts)')).toBe(true);
    expect(run('return any(entry == "x" for entry in contexts)')).toBe(false);
  });
  it('supports membership, not in and not precedence', () => {
    expect(run('return "urgent" in tags and "later" not in tags')).toBe(true);
    expect(run('return not state == "done" and True')).toBe(true);
  });
  it('supports RE2 matching, negation and case flags', () => {
    expect(run('return regexMatch(title, "^work", True)')).toBe(true);
    expect(run('return regexMatch(title, "^work", False)')).toBe(false);
    expect(run('return not regexMatch(title, "cancelled", True)')).toBe(true);
    expect(run('return any(regexMatch(entry, r"^w\\w+$", True) for entry in tags)')).toBe(true);
    expect(() => pythonToFilter('return regexMatch(title, "(?=x)", False)')).toThrow();
    expect(() => pythonToFilter('return regexMatch(title, "[", False)')).toThrow();
  });
  it('handles comments and quoted hashes without changing data', () => {
    expect(run('# example\nreturn "#work" == "#work" # trailing')).toBe(true);
  });
  it.each([
    'if state == "done":\n    return True\nelif state == "open":\n    return has(schedule.dueAt)\nelse:\n    return False',
    'return any(regexMatch(entry, "^work", True) for entry in tags)',
    'return choose(state == "open", True, False) and not False',
    'return "urgent" in tags',
  ])('round trips without changing the executable tree: %s', (source) => {
    const dsl = pythonToFilter(source);
    expect(pythonToFilter(filterToPython(dsl))).toBe(dsl);
  });
  it.each(['import os', 'while True:\n    return True', 'for item in items:\n    return True', 'return __import__("os")', 'return item.__proto__', 'return any(x for x in items)', 'return regexMatch(title, bodyMarkdown)', 'if True:\nreturn False', 'else:\n    return True'])('rejects unsupported code: %s', (source) => {
    expect(() => pythonToFilter(source)).toThrow();
  });
  it('retains arbitrary old expression structure in the code renderer', () => {
    const source = '(state == "open" || state == "done") && (priority >= 2 || has(schedule.dueAt))';
    expect(pythonToFilter(filterToPython(source))).toBe(expressionToDsl(parseExpression(source)));
  });
  it('validates conditional arity and preserves false variable bindings', () => {
    expect(() => validateFilterProgram(parseExpression('if(true, false)'))).toThrow();
    expect(evaluateExpression(parseExpression('flag'), { item, variables: { flag: false } })).toBe(false);
  });
  it('bounds nested generators and rejects reserved variable names', () => {
    const large = createItem('Collection'); large.tags = Array.from({ length: 150 }, () => 'tag');
    const source = pythonToFilter('return all(all(length(inner) > 0 for inner in tags) for outer in tags)');
    expect(() => compileQuery(source)(large)).toThrow('iteration limit');
    expect(() => pythonToFilter('return any(item for item in tags)')).toThrow('non-reserved');
  });
  it('uses RE2 for patterns that backtracking engines find expensive', () => {
    const large = createItem('a'.repeat(20000) + '!');
    expect(compileQuery(pythonToFilter('return regexMatch(title, "(a+)+$", False)'))(large)).toBe(false);
  });
});
