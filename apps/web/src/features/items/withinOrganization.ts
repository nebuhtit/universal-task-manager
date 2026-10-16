import { itemAreas, itemProjects, type UniversalItem } from '@utm/core';
import { extractOrganization } from '../../../quick-entry-lab/organization';
import { isLiteralEntry } from '../../../quick-entry-lab/literal';

/** Offer only missing memberships, using normal Live Text syntax for persistence. */
export function withinOrganizationOffer(target: UniversalItem, text: string, current?: UniversalItem) {
  if (isLiteralEntry(text)) return null;
  const authored = extractOrganization(text);
  const missing = (values: string[], assigned: string[]) => [...new Set(values)].filter(value => !assigned.includes(value));
  const areas = missing(itemAreas(target), [...authored.areas, ...(current ? itemAreas(current) : [])]);
  const projects = missing(itemProjects(target), [...authored.projects, ...(current ? itemProjects(current) : [])]);
  const tags = missing(target.tags, [...authored.tags, ...(current?.tags ?? [])]);
  const insert = [...areas.map(name => `area:${JSON.stringify(name)}`), ...projects.map(name => `project:${JSON.stringify(name)}`), ...tags.map(name => `#${JSON.stringify(name)}`)].join(' ');
  return insert ? { areas, projects, tags, insert } : null;
}
