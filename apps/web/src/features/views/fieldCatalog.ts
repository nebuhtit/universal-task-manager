import type { ItemScriptField, WorkspaceDocument } from '@utm/core';
import {
  exampleViewFieldValue,
  viewFieldLabel,
  viewFieldOptions,
  type ViewFieldOption,
} from '../items/fieldDisplay';

export type ViewFieldGroup = { name: string; fields: ViewFieldOption[] };

export const viewFieldGroups = (workspace: WorkspaceDocument, viewScripts: readonly ItemScriptField[] = []): ViewFieldGroup[] => {
  const groups = new Map<string, ViewFieldOption[]>();
  for (const field of viewFieldOptions(workspace, viewScripts)) groups.set(field.group, [...(groups.get(field.group) ?? []), field]);
  return [...groups].map(([name, fields]) => ({ name, fields }));
};

export { exampleViewFieldValue, viewFieldLabel, viewFieldOptions };
export type { ViewFieldOption };
