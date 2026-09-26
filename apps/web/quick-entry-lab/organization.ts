export type OrganizationKind = 'area' | 'project' | 'tag';
export type OrganizationCatalog = Record<OrganizationKind, string[]> & { projectAreas?: Record<string, string[]> };
const kinds: Record<string, OrganizationKind> = { э: 'area', ar: 'area', п: 'project', p: 'project', area: 'area', эриа: 'area', область: 'area', project: 'project', проект: 'project', tag: 'tag', тег: 'tag', тэг: 'tag', '#': 'tag' };
export function extractOrganization(input: string) {
  const values: OrganizationCatalog = { area: [], project: [], tag: [] };
  const commandSpans: Array<{ start: number; end: number }> = [];
  const masked = input.split('');
  // Quoted prose is consumed as an alternative, never interpreted as a command.
  const pattern = /"(?:\\.|[^"\\])*"|«[^»]*»|(^|\s)(area|эриа|область|project|проект|tag|тег|тэг|ar|э|п|p|#)(?:\s*:\s*|\s+|(?<=#))("(?:\\.|[^"\\])*"|«[^»]*»|[^\s"«]+)/giu;
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
  const commands = [...before.matchAll(/(?:^|\s)(area|эриа|область|project|проект|tag|тег|тэг|ar|э|п|p|#)(?:\s*:\s*|\s+|(?<=#))/giu)];
  const command = commands.at(-1);
  const match = command ? Object.assign([command[0] + before.slice(command.index! + command[0].length), command[1], before.slice(command.index! + command[0].length)], { index: command.index! }) : null;
  if (!match) {
    const prefix = /(?:^|\s)([\p{L}#]+)$/u.exec(before);
    if (!prefix) return null;
    const query = prefix[1]!.toLowerCase();
    const options = Object.keys(kinds).filter(key => key.startsWith(query)).map(key => ({ label: key, insert: `${key} `, detail: kinds[key] === 'area' ? 'Area' : kinds[key] === 'project' ? 'Project' : 'Tag' }));
    return options.length ? { start: caret - prefix[1]!.length, end: caret, ordered: true, options } : null;
  }
  const kind = kinds[match[1]!.toLowerCase()]!;
  const query = match[2]!.replace(/^["«]/, '').toLocaleLowerCase();
  if (/["»]$/.test(query.trimEnd()) || query.length > 100) return null;
  const start = match.index + match[0]!.length - match[2]!.length;
  const chosen = extractOrganization(input.slice(0, match.index) + ' ' + input.slice(caret));
  const selected = kind === 'area' ? chosen.areas : kind === 'project' ? chosen.projects : chosen.tags;
  const rank = (name: string) => {
    if (kind === 'tag') return 0;
    const scopes = kind === 'project' ? chosen.areas : chosen.projects;
    const index = scopes.findIndex(scope => kind === 'project' ? catalog.projectAreas?.[name]?.includes(scope) : catalog.projectAreas?.[scope]?.includes(name));
    return index < 0 ? scopes.length : index;
  };
  return { start, end: caret, ordered: true, options: [...new Set(catalog[kind])].filter(name => !selected.includes(name) && name.toLocaleLowerCase().includes(query)).sort((a, b) => rank(a) - rank(b)).map(name => ({ label: name, insert: `${JSON.stringify(name)} `, detail: kind === 'area' ? 'Area' : kind === 'project' ? 'Project' : 'Tag' })) };
}
