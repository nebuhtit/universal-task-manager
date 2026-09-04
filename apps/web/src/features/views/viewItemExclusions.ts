import { createId, type UniversalItem } from '@utm/core';
import type { VisualConditionRow } from './visualFilterModel';

export const exclusionFieldFor = (item: UniversalItem): 'id' | 'occurrence.seriesId' => item.role === 'series_template' ? 'occurrence.seriesId' : 'id';
export const exclusionClauseFor = (item: UniversalItem): string => `${exclusionFieldFor(item)} != ${JSON.stringify(item.id)}`;

export const itemIsExcludedByRows = (item: UniversalItem, rows: readonly VisualConditionRow[]): boolean => {
  const field = exclusionFieldFor(item);
  return rows.some((row) => row.join === 'and' && row.field === field && row.operator === '!=' && row.value === item.id);
};

export const setItemExcludedInRows = (item: UniversalItem, rows: readonly VisualConditionRow[], excluded: boolean): VisualConditionRow[] => {
  const field = exclusionFieldFor(item);
  const without = rows.filter((row) => !(row.field === field && row.operator === '!=' && row.value === item.id));
  return excluded ? [...without, { id: createId(), join: 'and', field, operator: '!=', value: item.id }] : without;
};

export const itemIsExcludedBySource = (item: UniversalItem, source: string): boolean => source.includes(exclusionClauseFor(item));

export const setItemExcludedInSource = (item: UniversalItem, source: string, excluded: boolean): string => {
  const clause = exclusionClauseFor(item);
  if (excluded) return itemIsExcludedBySource(item, source) ? source : `(${source.trim() || 'true'} && ${clause})`;
  return source.replaceAll(` && ${clause}`, '');
};
