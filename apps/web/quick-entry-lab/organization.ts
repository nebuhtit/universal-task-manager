export type OrganizationKind = 'area' | 'project' | 'tag';
export type OrganizationCatalog = Record<OrganizationKind, string[]>;
const kinds: Record<string, OrganizationKind> = { area: 'area', эриа: 'area', область: 'area', project: 'project', проект: 'project', tag: 'tag', тег: 'tag', тэг: 'tag', '#': 'tag' };
export function extractOrganization(input: string) {
  const values: OrganizationCatalog = { area: [], project: [], tag: [] };
  const commandSpans: Array<{ start: number; end: number }> = [];
  const masked = input.split('');
  // Quoted prose is consumed as an alternative, never interpreted as a command.
  const pattern = /"(?:\\.|[^"\\])*"|«[^»]*»|(^|\s)(area|эриа|область|project|проект|tag|тег|тэг|#)(?:\s*:\s*|\s+|(?<=#))("(?:\\.|[^"\\])*"|«[^»]*»|[^\s"«]+)/giu;
  const text = input.replace(pattern, (match, space: string | undefined, key: string | undefined, raw: string | undefined, offset: number) => {
    if (!key || !raw) return match;
    let name = raw;
    if (raw.startsWith('"')) { try { name = JSON.parse(raw); } catch { return match; } }
    else if (raw.startsWith('«')) name = raw.slice(1, -1);
    if (!name.trim()) return match;
    const list = values[kinds[key.toLowerCase()]!];
    if (!list.includes(name)) list.push(name);
    const start = offset + (space?.length ?? 0);
    commandSpans.push({ start, end: start + key.length });
    masked.fill(' ', offset, offset + match.length);
    return space ?? '';
  });
  return { text: text.trim(), maskedText: masked.join(''), commandSpans, areas: values.area, projects: values.project, tags: values.tag };
}

export function organizationSuggestions(input: string, caret: number, catalog: OrganizationCatalog) {
  const before = input.slice(0, caret);
  const match = /(?:^|\s)(area|эриа|область|project|проект|tag|тег|тэг|#)(?:\s*:\s*|\s+|(?<=#))([^\n]*)$/iu.exec(before);
  if (!match) return null;
  const kind = kinds[match[1]!.toLowerCase()]!;
  const query = match[2]!.replace(/^["«]/, '').toLocaleLowerCase();
  if (/["»]$/.test(query.trimEnd()) || query.length > 100) return null;
  const start = match.index + match[0].length - match[2]!.length;
  return { start, end: caret, ordered: true, options: catalog[kind].filter(name => name.toLocaleLowerCase().includes(query)).slice(0, 30).map(name => ({ label: name, insert: `${JSON.stringify(name)} `, detail: kind === 'area' ? 'Area' : kind === 'project' ? 'Project' : 'Tag' })) };
}
