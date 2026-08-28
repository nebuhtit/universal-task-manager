import { useState, type ReactNode } from 'react';
import {
  ensureAreaDefinition, ensureProjectDefinition, ensureTagDefinition, orderedOrganizationNames, orderedOrganizationPriorityEntries,
  orderedTagEntries, renameAreaDefinition, renameProjectDefinition, renameTagDefinition, reorderAreaSubset, reorderOrganizationPriority, reorderProjectSubset, reorderTagSubset, type OrganizationPreferences, type OrganizationPriorityEntry, type WorkspaceDocument,
} from '@utm/core';
import { Button, Field, IconButton, Input, Select, Surface } from '../../components/ui/primitives';
import { CloseIcon } from '../../components/ui/icons';
import { useReorderList } from '../../components/ui/useReorderList';
import { recordDiagnostic } from '../../services/diagnostics';
import './organization-manager.css';

type Commit = (message: string, mutation: (draft: WorkspaceDocument) => void) => void;
const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const priorityKey = (entry: OrganizationPriorityEntry) => JSON.stringify([entry.kind, entry.name, entry.kind === 'project' && entry.name !== null ? entry.area ?? null : undefined]);

function DraggablePriorityRows({ entries, onReorder, render }: { entries: OrganizationPriorityEntry[]; onReorder: (entries: OrganizationPriorityEntry[]) => void; render: (entry: OrganizationPriorityEntry) => ReactNode }) {
  const reorder = useReorderList(entries, onReorder);
  return <div className="organization-priority-list" ref={reorder.container}>{entries.map((entry, index) => <Surface className={`organization-priority-row${entry.kind === 'project' && entry.name !== null ? ' is-project' : ''}`} data-priority-entry={priorityKey(entry)} key={priorityKey(entry)} {...reorder.rowProps(index)}>
    {reorder.handle(index, entry.name === null ? `No ${entry.kind === 'tag' ? 'Tags' : entry.kind === 'area' ? 'Area' : 'Project'}` : entry.kind === 'project' ? `Project ${entry.name} in ${entry.area ?? 'No Area'}` : `${entry.kind === 'tag' ? '#' : ''}${entry.name}`)}
    {render(entry)}
  </Surface>)}</div>;
}

function ProjectRow({ project, area, workspace, commit }: { project: string; area?: string; workspace: WorkspaceDocument; commit: Commit }) {
  const [nextArea, setNextArea] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(project);
  const definition = workspace.projectDefinitions[project];
  const areas = definition?.areas ?? [];
  const availableAreas = orderedOrganizationNames(workspace, 'area').filter((candidate) => !areas.includes(candidate));
  const changeAreas = (next: string[], action: string) => {
    commit(action, (draft) => { ensureProjectDefinition(draft, project, { areas: next }); });
    recordDiagnostic({ kind: 'result', message: 'Project Area links changed', operation: 'PARA relationship', outcome: 'succeeded', details: JSON.stringify({ projectDefined: true, areaLinks: next.length }) });
  };
  const rename = () => {
    const next = renameValue.trim();
    if (!next || next === project || workspace.projectDefinitions[next]) return;
    commit('Rename Project', (draft) => { renameProjectDefinition(draft, project, next); });
    recordDiagnostic({ kind: 'result', message: 'Project renamed', operation: 'Rename PARA entity', outcome: 'succeeded', details: JSON.stringify({ kind: 'project' }) });
    setRenaming(false);
  };
  return <div className="organization-project-row">{renaming ? <div className="organization-inline-rename"><Input aria-label={`New name for Project ${project}`} value={renameValue} autoFocus onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); rename(); } if (event.key === 'Escape') { setRenameValue(project); setRenaming(false); } }} /><Button size="compact" disabled={!renameValue.trim() || renameValue.trim() === project || Boolean(workspace.projectDefinitions[renameValue.trim()])} onClick={rename}>Save</Button><Button size="compact" variant="ghost" onClick={() => { setRenameValue(project); setRenaming(false); }}>Cancel</Button></div> : <strong>{project}</strong>}<span className="organization-project-areas">{areas.length ? areas.join(' · ') : 'No Area'}</span>
    {!renaming && <Button className="organization-rename-button" size="compact" variant="ghost" aria-label={`Rename Project ${project}`} onClick={() => setRenaming(true)}>Rename</Button>}
    {area && <IconButton size="compact" variant="ghost" aria-label={`Remove ${project} from ${area}`} onClick={() => changeAreas(areas.filter((candidate) => candidate !== area), 'Remove Project Area')}><CloseIcon /></IconButton>}
    {availableAreas.length > 0 && <div className="organization-project-link"><Select aria-label={`Add Area to ${project}`} value={nextArea} onChange={(event) => setNextArea(event.target.value)}><option value="">Add Area…</option>{availableAreas.map((candidate) => <option value={candidate} key={candidate}>{candidate}</option>)}</Select><Button size="compact" disabled={!nextArea} onClick={() => { changeAreas([...areas, nextArea], 'Add Project Area'); setNextArea(''); }}>Add</Button></div>}
  </div>;
}

function AreaGroup({ area, workspace, commit, orderCommit }: { area?: string; workspace: WorkspaceDocument; commit: Commit; orderCommit: Commit }) {
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(area ?? '');
  const projects = orderedOrganizationPriorityEntries(workspace)
    .filter((entry): entry is OrganizationPriorityEntry & { kind: 'project'; name: string } => entry.kind === 'project' && entry.name !== null && (entry.area ?? null) === (area ?? null))
    .map((entry) => entry.name)
    .filter((project, index, entries) => entries.indexOf(project) === index);
  const reorder = useReorderList(projects, (next) => {
    orderCommit(`Reorder Projects in ${area ?? 'No Area'}`, (draft) => reorderProjectSubset(draft, next, area ?? null));
    recordDiagnostic({ kind: 'result', message: 'Project priority reordered inside Area', operation: 'Reorder PARA priority', outcome: 'succeeded', details: JSON.stringify({ linkedToArea: Boolean(area), projectCount: next.length }) });
  });
  const add = () => {
    const project = name.trim(); if (!project) return;
    commit('Create project', (draft) => { ensureProjectDefinition(draft, project, { areas: area ? [area] : [] }); });
    recordDiagnostic({ kind: 'result', message: 'Project created from PARA settings', operation: 'Create PARA entity', outcome: 'succeeded', details: JSON.stringify({ kind: 'project', linkedAreas: area ? 1 : 0 }) });
    setName('');
  };
  const rename = () => {
    const next = renameValue.trim();
    if (!area || !next || next === area || workspace.areaDefinitions[next]) return;
    commit('Rename Area', (draft) => { renameAreaDefinition(draft, area, next); });
    recordDiagnostic({ kind: 'result', message: 'Area renamed', operation: 'Rename PARA entity', outcome: 'succeeded', details: JSON.stringify({ kind: 'area' }) });
    setRenaming(false);
  };
  return <details className="ui-surface organization-area-group"><summary><span><h3>{area ?? 'No Area'}</h3><small>{projects.length} projects</small></span></summary><div className="organization-area-content">{area && (renaming ? <div className="organization-inline-rename"><Input aria-label={`New name for Area ${area}`} value={renameValue} autoFocus onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); rename(); } if (event.key === 'Escape') { setRenameValue(area); setRenaming(false); } }} /><Button size="compact" disabled={!renameValue.trim() || renameValue.trim() === area || Boolean(workspace.areaDefinitions[renameValue.trim()])} onClick={rename}>Save</Button><Button size="compact" variant="ghost" onClick={() => { setRenameValue(area); setRenaming(false); }}>Cancel</Button></div> : <Button className="organization-rename-button" size="compact" variant="ghost" aria-label={`Rename Area ${area}`} onClick={() => setRenaming(true)}>Rename Area</Button>)}{projects.length > 0 && <div className="organization-nested-projects" ref={reorder.container}>{projects.map((project, index) => <div className="organization-project-drag-row" key={`${area ?? 'none'}:${project}`} {...reorder.rowProps(index)}>
    {reorder.handle(index, `Project ${project}`)}
    {area ? <ProjectRow project={project} area={area} workspace={workspace} commit={commit} /> : <ProjectRow project={project} workspace={workspace} commit={commit} />}
  </div>)}</div>}
    <div className="organization-manager-add organization-project-add"><Field label={area ? `New Project in ${area}` : 'New Project without Area'}><Input value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} placeholder="Project name" /></Field><Button size="compact" disabled={!name.trim()} onClick={add}>Add Project</Button></div></div>
  </details>;
}

function TagCatalogRow({ tag, workspace, commit }: { tag: string; workspace: WorkspaceDocument; commit: Commit }) {
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState(tag);
  const save = () => {
    const next = value.trim().replace(/^#+/, '');
    if (!next || next === tag || orderedTagEntries(workspace).includes(next)) return;
    commit('Rename Tag', (draft) => { renameTagDefinition(draft, tag, next); });
    recordDiagnostic({ kind: 'result', message: 'Tag renamed', operation: 'Rename PARA entity', outcome: 'succeeded', details: JSON.stringify({ kind: 'tag' }) });
    setRenaming(false);
  };
  if (renaming) return <div className="organization-tag-rename"><Input aria-label={`New name for Tag ${tag}`} value={value} autoFocus onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); save(); } if (event.key === 'Escape') { setValue(tag); setRenaming(false); } }} /><Button size="compact" disabled={!value.trim() || value.trim().replace(/^#+/, '') === tag || orderedTagEntries(workspace).includes(value.trim().replace(/^#+/, ''))} onClick={save}>Save</Button><Button size="compact" variant="ghost" onClick={() => { setValue(tag); setRenaming(false); }}>Cancel</Button></div>;
  return <span className="organization-tag-entry">#{tag}<Button size="compact" variant="ghost" aria-label={`Rename Tag ${tag}`} onClick={() => setRenaming(true)}>Rename</Button></span>;
}

export function OrganizationManager({ workspace, commit }: { workspace: WorkspaceDocument; commit: Commit }) {
  const [areaName, setAreaName] = useState('');
  const [tagName, setTagName] = useState('');
  const [orderDraft, setOrderDraft] = useState<OrganizationPreferences | null>(null);
  const orderWorkspace = orderDraft ? { ...workspace, organizationPreferences: orderDraft } : workspace;
  const orderCommit: Commit = (_message, mutation) => {
    const draft = clean(orderWorkspace);
    mutation(draft);
    setOrderDraft(clean(draft.organizationPreferences));
  };
  const entityCommit: Commit = (message, mutation) => {
    commit(message, mutation);
    if (!orderDraft) return;
    const draft = clean(orderWorkspace);
    mutation(draft);
    setOrderDraft(clean(draft.organizationPreferences));
  };
  const areas = orderedOrganizationPriorityEntries(orderWorkspace)
    .filter((entry) => entry.kind === 'area')
    .map((entry) => entry.name);
  const areaReorder = useReorderList(areas, (next) => {
    orderCommit('Reorder Areas', (draft) => reorderAreaSubset(draft, next));
    recordDiagnostic({ kind: 'result', message: 'Area priority reordered in PARA settings', operation: 'Reorder PARA priority', outcome: 'succeeded', details: JSON.stringify({ areaCount: next.length, includesUnassigned: next.includes(null) }) });
  });
  const tags = orderedTagEntries(orderWorkspace);
  const tagReorder = useReorderList(tags, (next) => {
    orderCommit('Reorder Tags', (draft) => reorderTagSubset(draft, next));
    recordDiagnostic({ kind: 'result', message: 'Tag priority reordered in PARA', operation: 'Reorder PARA priority', outcome: 'succeeded', details: JSON.stringify({ tagCount: next.length }) });
  });
  const addArea = () => { const area = areaName.trim(); if (!area) return; entityCommit('Create area', (draft) => { ensureAreaDefinition(draft, area); }); recordDiagnostic({ kind: 'result', message: 'Area created from PARA settings', operation: 'Create PARA entity', outcome: 'succeeded', details: JSON.stringify({ kind: 'area' }) }); setAreaName(''); };
  const addTag = () => { const tag = tagName.trim().replace(/^#+/, ''); if (!tag) return; entityCommit('Create tag', (draft) => { ensureTagDefinition(draft, tag); }); recordDiagnostic({ kind: 'result', message: 'Tag created from PARA settings', operation: 'Create PARA entity', outcome: 'succeeded', details: JSON.stringify({ kind: 'tag' }) }); setTagName(''); };
  const saveOrder = () => {
    if (!orderDraft) return;
    const saved = clean(orderDraft);
    commit('Save PARA organization order', (draft) => { draft.organizationPreferences = saved; });
    recordDiagnostic({ kind: 'result', message: 'PARA priority order saved', operation: 'Save PARA priority', outcome: 'succeeded', details: JSON.stringify({ entries: saved.priorityOrder.length }) });
    setOrderDraft(null);
  };
  const label = (entry: OrganizationPriorityEntry) => entry.name === null ? `No ${entry.kind === 'tag' ? 'Tags' : entry.kind === 'area' ? 'Area' : 'Project'}` : `${entry.kind === 'tag' ? '#' : ''}${entry.name}`;
  return <section className="settings-card organization-manager" aria-label="PARA organization">
    <section className="organization-area-create"><Field label="New Area"><Input value={areaName} onChange={(event) => setAreaName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addArea(); } }} placeholder="e.g. Work" /></Field><Button size="compact" disabled={!areaName.trim()} onClick={addArea}>Add Area</Button></section>
    <div className="organization-area-groups" ref={areaReorder.container}>{areas.map((area, index) => <div className="organization-area-drag-row" key={area ?? '__no_area__'} {...areaReorder.rowProps(index)}>
      {areaReorder.handle(index, area === null ? 'No Area' : `Area ${area}`)}
      <AreaGroup {...(area === null ? {} : { area })} workspace={orderWorkspace} commit={entityCommit} orderCommit={orderCommit} />
    </div>)}</div>
    <section className="organization-tags"><h3>Tags</h3><div className="organization-manager-add organization-tag-add"><Field label="New Tag"><Input aria-label="New tag" value={tagName} onChange={(event) => setTagName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTag(); } }} placeholder="e.g. urgent" /></Field><Button size="compact" onClick={addTag} disabled={!tagName.trim().replace(/^#+/, '')}>Add Tag</Button></div>{tags.length > 0 && <div className="organization-tag-catalog" ref={tagReorder.container}>{tags.map((tag, index) => <Surface className="organization-tag-drag-row" key={tag ?? '__no_tags__'} {...tagReorder.rowProps(index)}>{tagReorder.handle(index, tag === null ? 'No Tags' : `Tag ${tag}`)}{tag === null ? <span className="organization-tag-entry organization-unassigned">No Tags</span> : <TagCatalogRow tag={tag} workspace={orderWorkspace} commit={entityCommit} />}</Surface>)}</div>}</section>
    <section className="organization-priority"><h3>Unified priority</h3><p className="organization-explanation">Projects are repeated under every linked Area. The highest matching occurrence wins; every row remains draggable.</p><DraggablePriorityRows entries={orderedOrganizationPriorityEntries(orderWorkspace)} onReorder={(order) => orderCommit('Reorder unified organization priority', (draft) => reorderOrganizationPriority(draft, order))} render={(entry) => <><span className={`organization-kind kind-${entry.kind}`}>{entry.kind}</span><span className="organization-priority-label"><strong className={entry.name === null ? 'organization-unassigned' : undefined}>{label(entry)}</strong>{entry.kind === 'project' && entry.name !== null && <small>In {entry.area ?? 'No Area'}</small>}</span></>} /></section>
    <div className="organization-order-actions"><span>{orderDraft ? 'Order has unsaved changes' : 'Order is saved'}</span><Button disabled={!orderDraft} onClick={saveOrder}>Apply / Save order</Button><Button variant="secondary" disabled={!orderDraft} onClick={() => setOrderDraft(null)}>Reset order</Button></div>
  </section>;
}
