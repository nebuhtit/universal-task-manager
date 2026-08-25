import { createId } from '@utm/core';

export type VisualConditionRow = { id: string; join: 'and' | 'or'; field: string; operator: string; value: string };
export const visualOptions: Record<string, string[]> = {
  state: ['open', 'done', 'auto_closed', 'cancelled', 'archived'], preset: ['task', 'event', 'habit', 'blank'],
  isHabit: ['true', 'false'], isTemplate: ['true', 'false'], isSubtask: ['true', 'false'], isParent: ['true', 'false'], activeRange: ['true', 'false'], activeDuration: ['true', 'false'], role: ['standalone', 'series_template', 'occurrence'], priority: ['0', '1', '2', '3', '4'],
};
export const visualFieldKinds: Record<string, 'enum' | 'boolean' | 'number' | 'date' | 'text' | 'multi'> = {
  state: 'enum', preset: 'enum', role: 'enum', isHabit: 'boolean', isTemplate: 'boolean', isSubtask: 'boolean', isParent: 'boolean', activeRange: 'boolean', activeDuration: 'boolean', priority: 'number',
  'schedule.startAt': 'date', 'schedule.endAt': 'date', 'schedule.dueAt': 'date', 'schedule.availableFrom': 'date', title: 'text', description: 'text', tags: 'multi', contexts: 'multi', subtasks: 'multi', parent: 'text',
};
export const visualOperators = (field: string): string[] => {
  const kind = visualFieldKinds[field] ?? 'text'; const presence = ['is set', 'is not set'];
  if (kind === 'number' || kind === 'date') return [...presence, '==', '!=', '>', '>=', '<', '<='];
  if (kind === 'boolean' || kind === 'enum') return [...presence, '==', '!=', 'in'];
  if (kind === 'multi') return [...presence, 'has any', 'has all', 'has none'];
  return [...presence, '==', '!=', 'contains'];
};
const commaList = (value: string) => value.split(',').map((part) => part.trim()).filter(Boolean);
const literal = (value: string) => ['true', 'false', 'null'].includes(value) || (!Number.isNaN(Number(value)) && value.trim() !== '') ? value : JSON.stringify(value);
const visualClause = (row: Pick<VisualConditionRow, 'field' | 'operator' | 'value'>) => {
  const presenceExpression = visualFieldKinds[row.field] === 'multi' || visualFieldKinds[row.field] === 'text' ? `length(${row.field}) > 0` : `${row.field} != null`;
  if (row.operator === 'is set') return presenceExpression;
  if (row.operator === 'is not set') return visualFieldKinds[row.field] === 'multi' || visualFieldKinds[row.field] === 'text' ? `length(${row.field}) == 0` : `${row.field} == null`;
  if (row.field === 'tags' || row.field === 'contexts') {
    const values = commaList(row.value); if (!values.length) return 'true';
    const checks = values.map((value) => `includes(${row.field}, ${JSON.stringify(value)})`);
    if (row.operator === 'has all') return checks.join(' && ');
    if (row.operator === 'has none') return `!(${checks.join(' || ')})`;
    return `(${checks.join(' || ')})`;
  }
  return `${row.field} ${row.operator === 'contains' ? 'in' : row.operator} ${literal(row.value)}`;
};
export const serializeVisualRows = (rows: VisualConditionRow[]) => rows.reduce((source, row, index) => index === 0 ? visualClause(row) : `(${source} ${row.join === 'or' ? '||' : '&&'} ${visualClause(row)})`, '');
export const parseVisualRows = (source: string): VisualConditionRow[] | null => {
  const strip = (value: string) => { let result = value.trim(); while (result.startsWith('(') && result.endsWith(')')) { let depth = 0, quoted = false, escaped = false, whole = true; for (let index = 0; index < result.length; index += 1) { const character = result[index]!; if (escaped) { escaped = false; continue; } if (character === '\\' && quoted) { escaped = true; continue; } if (character === '"') { quoted = !quoted; continue; } if (quoted) continue; if (character === '(') depth += 1; if (character === ')') depth -= 1; if (depth === 0 && index < result.length - 1) { whole = false; break; } } if (!whole || depth !== 0) break; result = result.slice(1, -1).trim(); } return result; };
  const split = (value: string): { left: string; join: 'and' | 'or'; right: string } | null => { let depth = 0, quoted = false, escaped = false; let match: { index: number; join: 'and' | 'or' } | null = null; for (let index = 0; index < value.length - 1; index += 1) { const character = value[index]!; if (escaped) { escaped = false; continue; } if (character === '\\' && quoted) { escaped = true; continue; } if (character === '"') { quoted = !quoted; continue; } if (quoted) continue; if (character === '(') depth += 1; else if (character === ')') depth -= 1; else if (depth === 0 && value.slice(index, index + 2) === '&&') { match = { index, join: 'and' }; index += 1; } else if (depth === 0 && value.slice(index, index + 2) === '||') { match = { index, join: 'or' }; index += 1; } } return match ? { left: value.slice(0, match.index).trim(), join: match.join, right: value.slice(match.index + 2).trim() } : null; };
  const clause = (value: string, join: 'and' | 'or'): VisualConditionRow | null => { const text = strip(value); const presence = /^([\w.]+)\s*(==|!=)\s*null$/.exec(text); const normal = /^([\w.]+)\s*(==|!=|>=|<=|>|<|in)\s*("(?:[^"\\]|\\.)*"|true|false|null|-?\d+(?:\.\d+)?)$/.exec(text); const match = presence ?? normal; if (!match) return null; let operator = match[2]!, parsed = ''; if (presence) operator = presence[2] === '!=' ? 'is set' : 'is not set'; else if (normal?.[3]) { try { parsed = String(JSON.parse(normal[3])); } catch { parsed = normal[3]; } } return { id: createId(), join, field: match[1]!, operator, value: parsed }; };
  const expression = (value: string): VisualConditionRow[] | null => { const text = strip(value); const parts = split(text); if (!parts) { const row = clause(text, 'and'); return row ? [row] : null; } const left = expression(parts.left); const right = clause(parts.right, parts.join); return left && right ? [...left, right] : null; };
  return source.trim() ? expression(source.trim()) : [];
};
export const toSqlExpression = (source: string): string => source.trim() ? source.trim().replace(/\bactiveRange\b/g, 'active_range').replace(/==/g, '=').replace(/!=/g, '<>').replace(/&&/g, ' AND ').replace(/\|\|/g, ' OR ').replace(/\btrue\b/gi, 'TRUE').replace(/\bfalse\b/gi, 'FALSE').replace(/\bnull\b/gi, 'NULL').replace(/includes\(([^,]+),\s*([^\)]+)\)/g, '$2 = ANY($1)').replace(/\s+/g, ' ').trim() : 'TRUE';
