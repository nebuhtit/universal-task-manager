import type { Expression } from './types.js';
import { compileFilterRegex } from './filter-regex.js';

const functions = new Set(['if', 'anyWhere', 'allWhere', 'regexMatch', 'now', 'today', 'has', 'includes', 'matchesAny', 'matchesAll', 'matchesNone', 'startsWith', 'endsWith', 'lower', 'length', 'duration', 'millisecondsUntil', 'secondsUntil', 'minutesUntil', 'hoursUntil', 'daysUntil', 'durationUntil', 'durationBetween', 'formatDuration', 'timeUntil', 'addDuration', 'scheduleInPeriod', 'nextReminderInPeriod', 'item', 'linked']);
const collections = new Set(['tags', 'areas', 'projects', 'contexts', 'relations', 'reminders', 'attachments']);
const reservedVariables = new Set(['item', 'True', 'False', 'None', 'true', 'false', 'null', 'if', 'elif', 'else', 'return', 'for', 'in', 'not', 'and', 'or', 'any', 'all']);
export function validateFilterProgram(node: Expression, depth = 0): void {
  if (depth > 128) throw new Error('Filter nesting exceeds 128 levels');
  if (node.type === 'identifier' && node.path.split('.').some((part) => ['__proto__', 'constructor', 'prototype'].includes(part))) throw new Error('Invalid property');
  if (node.type === 'call') {
    if (!functions.has(node.name)) throw new Error(`Function is not allowed: ${node.name}`);
    if (node.name === 'if' && node.args.length !== 3) throw new Error('IF requires condition, THEN and ELSE');
    if (node.name === 'regexMatch') {
      if (node.args.length < 2 || node.args.length > 3) throw new Error('Regex requires value, pattern and optional ignore-case flag');
      const pattern = node.args[1];
      if (pattern?.type !== 'literal' || typeof pattern.value !== 'string') throw new Error('Regex pattern must be a literal string');
      compileFilterRegex(pattern.value, node.args[2]?.type === 'literal' && node.args[2].value === true);
    }
    if (node.name === 'anyWhere' || node.name === 'allWhere') {
      const [collection, variable] = node.args;
      if (variable?.type === 'literal' && reservedVariables.has(String(variable.value))) throw new Error('Choose a non-reserved collection variable, for example entry or tag');
      if (node.args.length !== 3 || collection?.type !== 'identifier' || !collections.has(collection.path) || variable?.type !== 'literal' || typeof variable.value !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(variable.value)) throw new Error('Use a named variable over item.tags, areas, projects, contexts, relations, reminders or attachments');
    }
    node.args.forEach((child) => validateFilterProgram(child, depth + 1));
  } else if (node.type === 'unary') validateFilterProgram(node.argument, depth + 1);
  else if (node.type === 'binary') { validateFilterProgram(node.left, depth + 1); validateFilterProgram(node.right, depth + 1); }
}
