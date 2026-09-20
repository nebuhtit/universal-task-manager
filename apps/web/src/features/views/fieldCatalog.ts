import type { ItemScriptField, WorkspaceDocument } from '@utm/core';
import {
  exampleViewFieldValue,
  viewFieldLabel,
  viewFieldOptions,
  type ViewFieldOption,
} from '../items/fieldDisplay';

export type ViewFieldGroup = { name: string; fields: ViewFieldOption[] };

const filterOnlyFields: ViewFieldOption[] = [
  { path: 'itemKind', label: 'Item kind', group: 'Item kind' },
];

export const viewFieldGroups = (workspace: WorkspaceDocument, viewScripts: readonly ItemScriptField[] = []): ViewFieldGroup[] => {
  const groups = new Map<string, ViewFieldOption[]>();
  for (const field of viewFieldOptions(workspace, viewScripts)) groups.set(field.group, [...(groups.get(field.group) ?? []), field]);
  return [...groups].map(([name, fields]) => ({ name, fields }));
};

/** Properties intended for view filters, including computed classification. */
export const filterFieldOptions = (workspace: WorkspaceDocument, viewScripts: readonly ItemScriptField[] = []): ViewFieldOption[] => [
  ...filterOnlyFields,
  ...viewFieldOptions(workspace, viewScripts).map((field) => field.path === 'isTemplate'
    ? { ...field, label: 'Saved item template (legacy)', group: 'Advanced' }
    : field.path === 'role'
      ? { ...field, label: 'Technical recurrence role', group: 'Advanced' }
      : field),
];

export { exampleViewFieldValue, viewFieldLabel, viewFieldOptions };
export type { ViewFieldOption };
