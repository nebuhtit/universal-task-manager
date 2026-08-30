import { createId, type SavedView } from '@utm/core';
import { parseVisualRows, serializeVisualRows, type VisualConditionRow } from './visualFilterModel';

const legacyEntries = (view: SavedView) => ([
  ['area', view.area],
  ['project', view.project],
  ['list', view.list],
] as const).filter((entry): entry is readonly ['area' | 'project' | 'list', string] => Boolean(entry[1]?.trim()));

/**
 * Moves the superseded View scope shortcuts into the two explicit systems that
 * replaced them: ordinary filters and new-item defaults. The original object is
 * never mutated, so cancelling Edit View leaves the saved View untouched.
 */
export function modernizeLegacyViewScope(view: SavedView): SavedView {
  const entries = legacyEntries(view);
  if (!entries.length) return view;
  const next: SavedView = structuredClone(view);
  next.creationDefaults = { ...(next.creationDefaults ?? {}) };
  entries.forEach(([field, value]) => { next.creationDefaults![field] ??= value; });

  const parsed = parseVisualRows(next.query.source);
  if (parsed !== null) {
    const rows = [...parsed];
    entries.forEach(([field, value]) => {
      if (!rows.some((row) => row.field === field && row.operator === '==' && row.value === value)) {
        rows.push({ id: createId(), join: 'and', field, operator: '==', value } satisfies VisualConditionRow);
      }
    });
    next.query = { source: serializeVisualRows(rows) };
  } else {
    const constraints = entries.map(([field, value]) => `${field} == ${JSON.stringify(value)}`).join(' && ');
    next.query = { source: next.query.source.trim() ? `(${next.query.source}) && ${constraints}` : constraints };
  }
  delete next.area;
  delete next.project;
  delete next.list;
  return next;
}
