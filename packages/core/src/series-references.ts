import { parseExpression } from './dsl.js';
import { itemDeletionTime } from './item-deletion.js';
import type { Expression, WorkspaceDocument } from './types.js';

/** Recover only UTM-generated occurrence IDs backed by a known series lineage.
 * Existing records are authoritative; an ordinary item with a similar ID stays ordinary.
 * This resolves ownership, not a calendar pin's date or an occurrence edit scope.
 */
export function seriesReferenceOwner(workspace: WorkspaceDocument, id: string): string {
  const item = workspace.items[id];
  if (item) return item.occurrence?.seriesId ?? id;
  const match = /^occ_(.+)_(\d{17})$/.exec(id);
  if (!match) return id;
  const seriesId = match[1]!, stamp = match[2]!;
  const date = new Date(`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}.${stamp.slice(14)}Z`);
  if (!Number.isFinite(+date) || date.toISOString().replace(/[-:.TZ]/g, '') !== stamp) return id;
  const series = workspace.items[seriesId];
  return series?.role === 'series_template' || Boolean(series?.recurrence?.rrule)
    || Object.values(workspace.items).some(candidate => candidate.role === 'series_template'
      && candidate.recurrenceOverride?.kind === 'future_split' && candidate.recurrenceOverride.sourceSeriesId === seriesId
      && !itemDeletionTime(workspace, candidate)) ? seriesId : id;
}

export function seriesReferenceAncestors(workspace: WorkspaceDocument, id: string): string[] {
  const result = new Set<string>();
  while (!result.has(id)) {
    result.add(id);
    const split = workspace.items[id]?.recurrenceOverride;
    if (split?.kind !== 'future_split') break;
    id = split.sourceSeriesId;
  }
  return [...result];
}

/** Continuations inherit references to their source, never to an unrelated series. */
export function seriesReferenceIds(workspace: WorkspaceDocument, ids: readonly string[]): string[] {
  const children = new Map<string, string[]>();
  for (const item of Object.values(workspace.items)) {
    const split = item.recurrenceOverride;
    if (item.role !== 'series_template' || split?.kind !== 'future_split' || itemDeletionTime(workspace, item) || !Number.isFinite(Date.parse(split.recurrenceId))) continue;
    children.set(split.sourceSeriesId, [...(children.get(split.sourceSeriesId) ?? []), item.id]);
  }
  const result = new Set(ids);
  for (const id of result) for (const child of children.get(id) ?? []) result.add(child);
  return [...result];
}

/** Resolve only the branch owning this date; older pins keep their old identity. */
export function seriesReferenceAt(workspace: WorkspaceDocument, id: string, at: string): string {
  const instant = Date.parse(at);
  if (!Number.isFinite(instant)) return id;
  const seen = new Set<string>();
  while (!seen.has(id)) {
    seen.add(id);
    const next = Object.values(workspace.items).filter(item => item.role === 'series_template'
      && item.recurrenceOverride?.kind === 'future_split' && item.recurrenceOverride.sourceSeriesId === id
      && Date.parse(item.recurrenceOverride.recurrenceId) <= instant && !itemDeletionTime(workspace, item) && !seen.has(item.id))
      .sort((a, b) => Date.parse(b.recurrenceOverride!.recurrenceId) - Date.parse(a.recurrenceOverride!.recurrenceId) || a.id.localeCompare(b.id))[0];
    if (!next) break;
    id = next.id;
  }
  return id;
}

const print = (expression: Expression): string => {
  switch (expression.type) {
    case 'literal': return JSON.stringify(expression.value);
    case 'identifier': return expression.path;
    case 'unary': return `${expression.operator}(${print(expression.argument)})`;
    case 'binary': return `(${print(expression.left)} ${expression.operator} ${print(expression.right)})`;
    case 'call': return `${expression.name}(${expression.args.map(print).join(', ')})`;
  }
};

/** Expand exact series-ID conditions while preserving AND/OR/NOT semantics.
 * This is a read-only query projection; saved filters and user code stay intact.
 */
export function seriesReferenceQuery(workspace: WorkspaceDocument, source: string): string {
  if (!Object.values(workspace.items).some(item => item.recurrenceOverride?.kind === 'future_split')) return source;
  let changed = false;
  const visit = (expression: Expression): Expression => {
    if (expression.type === 'unary') return { ...expression, argument: visit(expression.argument) };
    if (expression.type === 'call') return { ...expression, args: expression.args.map(visit) };
    if (expression.type !== 'binary') return expression;
    const left = expression.left, right = expression.right;
    const field = left.type === 'identifier' ? left : right.type === 'identifier' ? right : undefined;
    const literal = left.type === 'literal' ? left : right.type === 'literal' ? right : undefined;
    if (['==', '!='].includes(expression.operator) && field && ['id', 'occurrence.seriesId'].includes(field.path) && literal && typeof literal.value === 'string') {
      const ids = seriesReferenceIds(workspace, [literal.value]);
      if (ids.length > 1) {
        changed = true;
        const conditions: Expression[] = ids.map(id => ({ type: 'binary', operator: expression.operator, left: field, right: { type: 'literal', value: id } }));
        return conditions.reduce((result, condition) => ({ type: 'binary', operator: expression.operator === '==' ? '||' : '&&', left: result, right: condition }));
      }
    }
    return { ...expression, left: visit(left), right: visit(right) };
  };
  try { const expression = visit(parseExpression(source)); return changed ? print(expression) : source; }
  catch { return source; }
}
