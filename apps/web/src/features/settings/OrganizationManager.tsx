import { useState, type CSSProperties, type ReactNode } from 'react';
import {
  ACTIVE_ITEM_VIEW_QUERY, calculateProjectMetrics, createId, createPortablePackage, DEFAULT_AREA_ACCENT, DEFAULT_PROJECT_ACCENT, DEFAULT_TAG_ACCENT, effectiveWorkspaceNow, ensureAreaDefinition, ensureProjectDefinition, ensureTagDefinition, orderedOrganizationNames, orderedOrganizationPriorityEntries,
  orderedTagEntries, organizationAccentFor, renameAreaDefinition, renameProjectDefinition, renameTagDefinition, reorderAreaSubset, reorderOrganizationPriority, reorderProjectSubset, reorderTagSubset,
  type OrganizationPreferences, type OrganizationPriorityEntry, type ProjectMetrics, type SavedView, type UniversalItem, type WorkspaceDocument,
} from '@utm/core';
import { Button, Field, IconButton, Input, Select, Surface } from '../../components/ui/primitives';
import { CloseIcon, LineIcon } from '../../components/ui/icons';
import { useReorderList } from '../../components/ui/useReorderList';
import { formatViewDate } from '../../utils/dates';
import { formatComputedDuration } from '../items';
import { FieldIcon } from '../items/FieldIcon';
import { SavedViewSection } from '../views/SavedViewSection';
import { VIEW_TEMPLATE_FIELDS } from '../views/viewTemplates';
import './organization-manager.css';

type Commit = (message: string, mutation: (draft: WorkspaceDocument) => void) => void;
type Route = { kind: 'overview' } | { kind: 'area'; area?: string } | { kind: 'project'; project: string } | { kind: 'tag'; tag?: string };
const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const priorityKey = (entry: OrganizationPriorityEntry) => JSON.stringify([entry.kind, entry.name, entry.kind === 'project' && entry.name !== null ? entry.area ?? null : undefined]);
const activeQuery = ACTIVE_ITEM_VIEW_QUERY;
const defaultSort = 'schedule.dueAt asc nulls last\nschedule.startAt asc nulls last\norganizationOrder asc nulls last';
const PARA_VIEW_EXTENSION = 'utm:para-view';
const PARA_SCOPE_EXTENSION = 'utm:para-scope';

const paraScopeKey = ({ area, project, tag, noProject = false, globalProject = false }: { area?: string; project?: string; tag?: string | null; noProject?: boolean; globalProject?: boolean }) => JSON.stringify(tag !== undefined ? { kind: 'tag', tag } : { kind: globalProject ? 'project' : 'area', area: area ?? null, project: project ?? null, noProject });

const scopedView = ({ area, project, noProject = false, globalProject = false }: { area?: string; project?: string; noProject?: boolean; globalProject?: boolean }): SavedView => {
  const noArea = area === undefined && !globalProject;
  const source = [activeQuery, noProject ? 'length(projects) == 0' : '', noArea ? 'length(areas) == 0' : ''].filter(Boolean).join(' && ');
  return {
    id: `para:${globalProject ? 'project' : area ?? 'no-area'}:${project ?? 'no-project'}`,
    name: project ?? 'No Project', query: { source }, renderer: 'list',
    sort: [
      { field: 'schedule.dueAt', direction: 'asc', nulls: 'last' },
      { field: 'schedule.startAt', direction: 'asc', nulls: 'last' },
      { field: 'organizationOrder', direction: 'asc', nulls: 'last' },
    ],
    sortSource: defaultSort, fields: [...VIEW_TEMPLATE_FIELDS],
    ...(area ? { area } : {}), ...(project ? { project } : {}),
    extensions: { [PARA_VIEW_EXTENSION]: true, [PARA_SCOPE_EXTENSION]: paraScopeKey({ ...(area ? { area } : {}), ...(project ? { project } : {}), noProject, globalProject }) },
  };
};

export const paraAreaViews = (workspace: WorkspaceDocument, area?: string): SavedView[] => {
  const projects = orderedOrganizationPriorityEntries(workspace)
    .filter((entry): entry is OrganizationPriorityEntry & { kind: 'project'; name: string } => entry.kind === 'project' && entry.name !== null && (entry.area ?? null) === (area ?? null))
    .map((entry) => entry.name).filter((project, index, entries) => entries.indexOf(project) === index);
  return [...projects.map((project) => scopedView({ ...(area ? { area } : {}), project })), scopedView({ ...(area ? { area } : {}), noProject: true })];
};

export const paraProjectView = (project: string): SavedView => scopedView({ project, globalProject: true });
export const paraTagView = (tag?: string): SavedView => ({
  id: `para:tag:${tag ?? 'no-tags'}`,
  name: tag ? `#${tag}` : 'No Tags',
  query: { source: `${activeQuery} && ${tag ? `includes(tags, ${JSON.stringify(tag)})` : 'length(tags) == 0'}` },
  renderer: 'list',
  sort: [
    { field: 'schedule.dueAt', direction: 'asc', nulls: 'last' },
    { field: 'schedule.startAt', direction: 'asc', nulls: 'last' },
    { field: 'organizationOrder', direction: 'asc', nulls: 'last' },
  ],
  sortSource: defaultSort,
  fields: [...VIEW_TEMPLATE_FIELDS],
  creationDefaults: { tags: tag ? [tag] : [] },
  extensions: { [PARA_VIEW_EXTENSION]: true, [PARA_SCOPE_EXTENSION]: paraScopeKey({ tag: tag ?? null }) },
});
const sameParaScope = (left: SavedView, right: SavedView) => {
  if (!left.extensions?.[PARA_VIEW_EXTENSION]) return false;
  const leftScope = left.extensions?.[PARA_SCOPE_EXTENSION]; const rightScope = right.extensions?.[PARA_SCOPE_EXTENSION];
  if (typeof leftScope === 'string' && typeof rightScope === 'string') return leftScope === rightScope;
  return left.area === right.area && left.project === right.project && left.query.source === right.query.source;
};
const pinnedParaView = (workspace: WorkspaceDocument, view: SavedView) => Object.values(workspace.views).find((candidate) => sameParaScope(candidate, view));
export function pinParaView(workspace: WorkspaceDocument, view: SavedView, id = createId()): string {
  const existing = pinnedParaView(workspace, view);
  if (existing) return existing.id;
  workspace.views[id] = { ...clean(view), id };
  workspace.viewOrder = [...(workspace.viewOrder ?? []).filter((viewId) => Boolean(workspace.views[viewId])), id];
  return id;
}
export function unpinParaView(workspace: WorkspaceDocument, view: SavedView): string | undefined {
  const existing = pinnedParaView(workspace, view);
  if (!existing) return undefined;
  delete workspace.views[existing.id];
  workspace.viewOrder = (workspace.viewOrder ?? []).filter((viewId) => viewId !== existing.id);
  return existing.id;
}
export const paraViewsForExport = (workspace: WorkspaceDocument): SavedView[] => Object.values(workspace.views).filter((view) => Boolean(view.extensions?.[PARA_VIEW_EXTENSION]));
export const createParaStructurePackage = (workspace: WorkspaceDocument) => createPortablePackage({ ...workspace, customFields: {} }, { kind: 'views', views: paraViewsForExport(workspace) });

function DraggablePriorityRows({ entries, onReorder, render }: { entries: OrganizationPriorityEntry[]; onReorder: (entries: OrganizationPriorityEntry[]) => void; render: (entry: OrganizationPriorityEntry) => ReactNode }) {
  const reorder = useReorderList(entries, onReorder);
  return <div className="organization-priority-list" ref={reorder.container}>{entries.map((entry, index) => <Surface className={`organization-priority-row${entry.kind === 'project' && entry.name !== null ? ' is-project' : ''}`} data-priority-entry={priorityKey(entry)} key={priorityKey(entry)} {...reorder.rowProps(index)}>
    {reorder.handle(index, entry.name === null ? `No ${entry.kind === 'tag' ? 'Tags' : entry.kind === 'area' ? 'Area' : 'Project'}` : entry.kind === 'project' ? `Project ${entry.name} in ${entry.area ?? 'No Area'}` : `${entry.kind === 'tag' ? '#' : ''}${entry.name}`)}{render(entry)}
  </Surface>)}</div>;
}

const emptyProjectMetrics = (): ProjectMetrics => ({ totalItems: 0, completedItems: 0, completionPercent: 0, totalDurationMs: 0, completedDurationMs: 0, deadlineOverdue: false });
const projectDuration = (milliseconds: number) => milliseconds > 0 ? formatComputedDuration(milliseconds) : '0 min';

function ProjectMetricsPanel({ project, workspace, metrics }: { project: string; workspace: WorkspaceDocument; metrics: ProjectMetrics }) {
  const accent = organizationAccentFor(workspace, 'project', project) ?? 'var(--color-text)';
  return <div className="organization-project-metrics" style={{ '--project-progress-color': accent } as CSSProperties}>
    <div className="organization-project-progress-summary"><strong>{metrics.completionPercent}%</strong><span>Completed items</span><span>{metrics.completedItems}/{metrics.totalItems}</span></div>
    <div className="organization-project-progress" role="progressbar" aria-label={`Project ${project} completion`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={metrics.completionPercent}><span style={{ width: `${metrics.completionPercent}%` }} /></div>
    <div className="organization-project-facts"><span><small>Planned time</small>{projectDuration(metrics.completedDurationMs)} / {projectDuration(metrics.totalDurationMs)}</span><span className={metrics.deadlineOverdue ? 'is-overdue' : undefined}><small>{metrics.deadlineOverdue ? 'Overdue' : 'Nearest deadline'}</small>{metrics.nearestDeadline ? formatViewDate(metrics.nearestDeadline, true, workspace.calendarPreferences.language) : 'No deadline'}</span></div>
  </div>;
}

function ProjectRow({ project, workspace, metrics, onOpen }: { project: string; workspace: WorkspaceDocument; metrics: ProjectMetrics; onOpen: () => void }) {
  return <div className="organization-project-row"><button type="button" className="organization-entity-link organization-project-name" style={{ color: organizationAccentFor(workspace, 'project', project) }} onClick={onOpen}><FieldIcon path="project" label="Project" />{project}</button><span className="organization-open-hint">Open ›</span><ProjectMetricsPanel project={project} workspace={workspace} metrics={metrics} /></div>;
}

function AreaGroup({ area, workspace, commit, orderCommit, projectMetrics, onOpenArea, onOpenProject }: { area?: string; workspace: WorkspaceDocument; commit: Commit; orderCommit: Commit; projectMetrics: Record<string, ProjectMetrics>; onOpenArea: () => void; onOpenProject: (project: string) => void }) {
  const [name, setName] = useState('');
  const projects = orderedOrganizationPriorityEntries(workspace)
    .filter((entry): entry is OrganizationPriorityEntry & { kind: 'project'; name: string } => entry.kind === 'project' && entry.name !== null && (entry.area ?? null) === (area ?? null))
    .map((entry) => entry.name).filter((project, index, entries) => entries.indexOf(project) === index);
  const reorder = useReorderList(projects, (next) => orderCommit(`Reorder Projects in ${area ?? 'No Area'}`, (draft) => reorderProjectSubset(draft, next, area ?? null)));
  const add = () => { const project = name.trim(); if (!project) return; commit('Create project', (draft) => { ensureProjectDefinition(draft, project, { areas: area ? [area] : [] }); }); setName(''); };
  return <details className="ui-surface organization-area-group"><summary><span><button type="button" className="organization-entity-link organization-area-name" style={area ? { color: organizationAccentFor(workspace, 'area', area) } : undefined} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onOpenArea(); }}><FieldIcon path="area" label="Area" />{area ?? 'No Area'}</button><small>{projects.length} projects</small></span></summary><div className="organization-area-content">{projects.length > 0 && <div className="organization-nested-projects" ref={reorder.container}>{projects.map((project, index) => <div className="organization-project-drag-row" key={`${area ?? 'none'}:${project}`} {...reorder.rowProps(index)}>{reorder.handle(index, `Project ${project}`)}<ProjectRow project={project} workspace={workspace} metrics={projectMetrics[project] ?? emptyProjectMetrics()} onOpen={() => onOpenProject(project)} /></div>)}</div>}
    <div className="organization-manager-add organization-project-add"><Field label={area ? `New Project in ${area}` : 'New Project without Area'}><Input value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} placeholder="Project name" /></Field><Button size="compact" disabled={!name.trim()} onClick={add}>Add Project</Button></div></div>
  </details>;
}

function EntityControls({ kind, name, workspace, commit, onRenamed }: { kind: 'area' | 'project' | 'tag'; name: string; workspace: WorkspaceDocument; commit: Commit; onRenamed: (next: string) => void }) {
  const [renaming, setRenaming] = useState(false); const [value, setValue] = useState(name);
  const entityLabel = kind === 'area' ? 'Area' : kind === 'project' ? 'Project' : 'Tag';
  const normalizedValue = kind === 'tag' ? value.trim().replace(/^#+/, '') : value.trim();
  const nameExists = kind === 'tag' ? orderedTagEntries(workspace).includes(normalizedValue) : Boolean((kind === 'area' ? workspace.areaDefinitions : workspace.projectDefinitions)[normalizedValue]);
  const accent = organizationAccentFor(workspace, kind, name);
  const rename = () => { const next = normalizedValue; if (!next || next === name || nameExists) return; commit(`Rename ${entityLabel}`, (draft) => { if (kind === 'area') renameAreaDefinition(draft, name, next); else if (kind === 'project') renameProjectDefinition(draft, name, next); else { const pinned = pinnedParaView(draft, paraTagView(name)); renameTagDefinition(draft, name, next); if (pinned) { pinned.name = `#${next}`; pinned.extensions = { ...pinned.extensions, [PARA_SCOPE_EXTENSION]: paraScopeKey({ tag: next }) }; } } }); setRenaming(false); onRenamed(next); };
  return <div className="organization-entity-controls">{renaming ? <div className="organization-inline-rename"><Input aria-label={`New name for ${entityLabel} ${name}`} value={value} autoFocus onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); rename(); } if (event.key === 'Escape') { setValue(name); setRenaming(false); } }} /><Button size="compact" disabled={!normalizedValue || normalizedValue === name || nameExists} onClick={rename}>Save</Button><Button size="compact" variant="ghost" onClick={() => { setValue(name); setRenaming(false); }}>Cancel</Button></div> : <><Button className="organization-rename-button" size="compact" aria-label={`Rename ${entityLabel} ${name}`} onClick={() => setRenaming(true)}>Rename {entityLabel}</Button><label className="organization-project-color" style={{ '--organization-picker-color': accent ?? 'var(--color-text)' } as CSSProperties}><input type="color" aria-label={`Color for ${entityLabel} ${name}`} value={accent ?? (kind === 'area' ? DEFAULT_AREA_ACCENT : kind === 'project' ? DEFAULT_PROJECT_ACCENT : DEFAULT_TAG_ACCENT)} onChange={(event) => commit(`Change ${entityLabel} color`, (draft) => { if (kind === 'area') ensureAreaDefinition(draft, name, { accent: event.target.value }); else if (kind === 'project') ensureProjectDefinition(draft, name, { accent: event.target.value }); else ensureTagDefinition(draft, name, { accent: event.target.value }); })} /></label></>}</div>;
}

function ViewActions({ view, workspace, commit }: { view: SavedView; workspace: WorkspaceDocument; commit: Commit }) {
  const pinned = Boolean(pinnedParaView(workspace, view));
  const label = pinned ? `Unpin ${view.name} from Home` : `Pin ${view.name} to Home`;
  const toggle = () => commit(pinned ? 'Unpin PARA view from Home' : 'Pin PARA view to Home', (draft) => { if (pinned) unpinParaView(draft, view); else pinParaView(draft, view); });
  return <div className="organization-view-actions"><IconButton size="compact" variant="ghost" className={`organization-pin-home${pinned ? ' is-pinned' : ''}`} aria-label={label} aria-pressed={pinned} title={label} onClick={toggle}><span className="organization-pin-home-mark"><LineIcon name="pin"/><LineIcon name="home"/></span></IconButton></div>;
}

function ScopedView({ view, workspace, commit, onEditItem, onState, onAddItem, onQuickAddItem, celebrationColors }: { view: SavedView; workspace: WorkspaceDocument; commit: Commit; onEditItem: (item: UniversalItem) => void; onState: (item: UniversalItem, state: UniversalItem['state'], celebrationColor?: string) => void; onAddItem: (view: SavedView) => void; onQuickAddItem: (view: SavedView, title: string) => void; celebrationColors?: ReadonlyMap<string, string> | undefined }) {
  const viewTags = Array.isArray(view.creationDefaults?.tags) ? view.creationDefaults.tags.filter((tag): tag is string => typeof tag === 'string') : [];
  const accent = view.project ? organizationAccentFor(workspace, 'project', view.project) : view.area ? organizationAccentFor(workspace, 'area', view.area) : viewTags.length === 1 ? organizationAccentFor(workspace, 'tag', viewTags[0]) : undefined;
  const displayView = accent ? { ...view, accent } : view;
  return <SavedViewSection view={displayView} workspace={workspace} onEditItem={onEditItem} onState={onState} onRendererChange={() => {}} onAddItem={onAddItem} onQuickAddItem={onQuickAddItem} allowAdd initialOpen {...(celebrationColors ? { celebrationColors } : {})} showTechnicalSummary={false} headerActions={<ViewActions view={displayView} workspace={workspace} commit={commit} />} />;
}

function ProjectAreaLinks({ project, workspace, commit }: { project: string; workspace: WorkspaceDocument; commit: Commit }) {
  const [nextArea, setNextArea] = useState(''); const areas = workspace.projectDefinitions[project]?.areas ?? [];
  const available = orderedOrganizationNames(workspace, 'area').filter((area) => !areas.includes(area));
  const change = (next: string[]) => commit('Change Project Areas', (draft) => ensureProjectDefinition(draft, project, { areas: next }));
  return <section className="organization-project-area-links"><h3>Areas</h3><div className="organization-project-area-chips">{areas.length ? areas.map((area) => <span key={area}><FieldIcon path="area" label="Area" />{area}<IconButton size="compact" variant="ghost" aria-label={`Remove ${project} from ${area}`} onClick={() => change(areas.filter((candidate) => candidate !== area))}><CloseIcon /></IconButton></span>) : <span className="organization-system-group-note">No Area</span>}</div>{available.length > 0 && <div className="organization-project-link"><Select aria-label={`Add Area to ${project}`} value={nextArea} onChange={(event) => setNextArea(event.target.value)}><option value="">Add Area…</option>{available.map((area) => <option value={area} key={area}>{area}</option>)}</Select><Button size="compact" disabled={!nextArea} onClick={() => { change([...areas, nextArea]); setNextArea(''); }}>Add</Button></div>}</section>;
}

function TagCatalogRow({ tag, workspace, onOpen }: { tag?: string; workspace: WorkspaceDocument; onOpen: () => void }) {
  return <button type="button" className={`organization-entity-link organization-tag-entry${tag ? '' : ' organization-unassigned'}`} style={tag ? { color: organizationAccentFor(workspace, 'tag', tag) } : undefined} onClick={onOpen}><FieldIcon path="tag" label="Tag" />{tag ?? 'No Tags'}</button>;
}

export function OrganizationManager({ workspace, commit, onEditItem = () => {}, onState = () => {}, onAddItem = () => {}, onQuickAddItem = () => {}, onExport, celebrationColors }: { workspace: WorkspaceDocument; commit: Commit; onEditItem?: (item: UniversalItem) => void; onState?: (item: UniversalItem, state: UniversalItem['state'], celebrationColor?: string) => void; onAddItem?: (view: SavedView) => void; onQuickAddItem?: (view: SavedView, title: string) => void; onExport?: () => void; celebrationColors?: ReadonlyMap<string, string> }) {
  const [route, setRoute] = useState<Route>({ kind: 'overview' });
  const [areaName, setAreaName] = useState(''); const [tagName, setTagName] = useState(''); const [orderDraft, setOrderDraft] = useState<OrganizationPreferences | null>(null);
  const orderWorkspace = orderDraft ? { ...workspace, organizationPreferences: orderDraft } : workspace;
  const projectMetrics = calculateProjectMetrics(workspace, effectiveWorkspaceNow(workspace));
  const orderCommit: Commit = (_message, mutation) => { const draft = clean(orderWorkspace); mutation(draft); setOrderDraft(clean(draft.organizationPreferences)); };
  const entityCommit: Commit = (message, mutation) => { commit(message, mutation); if (!orderDraft) return; const draft = clean(orderWorkspace); mutation(draft); setOrderDraft(clean(draft.organizationPreferences)); };
  const areas = orderedOrganizationPriorityEntries(orderWorkspace).filter((entry) => entry.kind === 'area').map((entry) => entry.name);
  const areaReorder = useReorderList(areas, (next) => orderCommit('Reorder Areas', (draft) => reorderAreaSubset(draft, next)));
  const tags = orderedTagEntries(orderWorkspace); const tagReorder = useReorderList(tags, (next) => orderCommit('Reorder Tags', (draft) => reorderTagSubset(draft, next)));
  const addArea = () => { const area = areaName.trim(); if (!area) return; entityCommit('Create area', (draft) => { ensureAreaDefinition(draft, area); }); setAreaName(''); };
  const addTag = () => { const tag = tagName.trim().replace(/^#+/, ''); if (!tag) return; entityCommit('Create tag', (draft) => { ensureTagDefinition(draft, tag); }); setTagName(''); };
  const saveOrder = () => { if (!orderDraft) return; const saved = clean(orderDraft); commit('Save PARA organization order', (draft) => { draft.organizationPreferences = saved; }); setOrderDraft(null); };
  const label = (entry: OrganizationPriorityEntry) => entry.name === null ? `No ${entry.kind === 'tag' ? 'Tags' : entry.kind === 'area' ? 'Area' : 'Project'}` : `${entry.kind === 'tag' ? '#' : ''}${entry.name}`;

  if (route.kind === 'area') {
    const area = route.area; const views = paraAreaViews(workspace, area);
    return <section className="organization-detail-page"><header className="organization-detail-header"><Button variant="ghost" onClick={() => setRoute({ kind: 'overview' })}>‹ PARA</Button><h2 style={area ? { color: organizationAccentFor(workspace, 'area', area) } : undefined}><FieldIcon path="area" label="Area" />{area ?? 'No Area'}</h2>{area && <EntityControls kind="area" name={area} workspace={workspace} commit={commit} onRenamed={(next) => setRoute({ kind: 'area', area: next })} />}</header>{!area && <p className="organization-system-group-note">Projects and items that are not linked to an Area.</p>}<div className="organization-detail-views">{views.map((view) => <section className="organization-scoped-view" key={view.id}>{view.project && <div className="organization-scoped-project-controls"><button type="button" className="organization-entity-link organization-project-name" style={{ color: organizationAccentFor(workspace, 'project', view.project) }} onClick={() => setRoute({ kind: 'project', project: view.project! })}><FieldIcon path="project" label="Project" />{view.project}</button><EntityControls kind="project" name={view.project} workspace={workspace} commit={commit} onRenamed={() => {}} /></div>}<ScopedView view={view} workspace={workspace} commit={commit} onEditItem={onEditItem} onState={onState} onAddItem={onAddItem} onQuickAddItem={onQuickAddItem} celebrationColors={celebrationColors} /></section>)}</div></section>;
  }
  if (route.kind === 'project') {
    const project = route.project; const view = paraProjectView(project);
    return <section className="organization-detail-page"><header className="organization-detail-header"><Button variant="ghost" onClick={() => setRoute({ kind: 'overview' })}>‹ PARA</Button><h2 style={{ color: organizationAccentFor(workspace, 'project', project) }}><FieldIcon path="project" label="Project" />{project}</h2><EntityControls kind="project" name={project} workspace={workspace} commit={commit} onRenamed={(next) => setRoute({ kind: 'project', project: next })} /></header><ProjectAreaLinks project={project} workspace={workspace} commit={commit} /><ProjectMetricsPanel project={project} workspace={workspace} metrics={projectMetrics[project] ?? emptyProjectMetrics()} /><ScopedView view={view} workspace={workspace} commit={commit} onEditItem={onEditItem} onState={onState} onAddItem={onAddItem} onQuickAddItem={onQuickAddItem} celebrationColors={celebrationColors} /></section>;
  }
  if (route.kind === 'tag') {
    const tag = route.tag; const view = paraTagView(tag);
    return <section className="organization-detail-page"><header className="organization-detail-header"><Button variant="ghost" onClick={() => setRoute({ kind: 'overview' })}>‹ PARA</Button><h2 style={tag ? { color: organizationAccentFor(workspace, 'tag', tag) } : undefined}><FieldIcon path="tag" label="Tag" />{tag ?? 'No Tags'}</h2>{tag && <EntityControls kind="tag" name={tag} workspace={workspace} commit={commit} onRenamed={(next) => setRoute({ kind: 'tag', tag: next })} />}</header>{!tag && <p className="organization-system-group-note">Items that do not have a Tag.</p>}<ScopedView view={view} workspace={workspace} commit={commit} onEditItem={onEditItem} onState={onState} onAddItem={onAddItem} onQuickAddItem={onQuickAddItem} celebrationColors={celebrationColors} /></section>;
  }
  return <section className="settings-card organization-manager" aria-label="PARA organization">
    <section className="organization-area-create"><Field label="New Area"><Input value={areaName} onChange={(event) => setAreaName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addArea(); } }} placeholder="e.g. Work" /></Field><Button size="compact" disabled={!areaName.trim()} onClick={addArea}>Add Area</Button></section>
    <div className="organization-area-groups" ref={areaReorder.container}>{areas.map((area, index) => <div className="organization-area-drag-row" key={area ?? '__no_area__'} {...areaReorder.rowProps(index)}>{areaReorder.handle(index, area === null ? 'No Area' : `Area ${area}`)}<AreaGroup {...(area === null ? {} : { area })} workspace={orderWorkspace} commit={entityCommit} orderCommit={orderCommit} projectMetrics={projectMetrics} onOpenArea={() => setRoute(area === null ? { kind: 'area' } : { kind: 'area', area })} onOpenProject={(project) => setRoute({ kind: 'project', project })} /></div>)}</div>
    <section className="organization-tags"><h3>Tags</h3><div className="organization-manager-add organization-tag-add"><Field label="New Tag"><Input aria-label="New tag" value={tagName} onChange={(event) => setTagName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTag(); } }} placeholder="e.g. urgent" /></Field><Button size="compact" onClick={addTag} disabled={!tagName.trim().replace(/^#+/, '')}>Add Tag</Button></div>{tags.length > 0 && <div className="organization-tag-catalog" ref={tagReorder.container}>{tags.map((tag, index) => <Surface className="organization-tag-drag-row" key={tag ?? '__no_tags__'} {...tagReorder.rowProps(index)}>{tagReorder.handle(index, tag === null ? 'No Tags' : `Tag ${tag}`)}<TagCatalogRow {...(tag === null ? {} : { tag })} workspace={orderWorkspace} onOpen={() => setRoute(tag === null ? { kind: 'tag' } : { kind: 'tag', tag })} /></Surface>)}</div>}</section>
    <section className="organization-priority"><h3>Unified priority</h3><p className="organization-explanation">Projects are repeated under every linked Area. The highest matching occurrence wins; every row remains draggable.</p><DraggablePriorityRows entries={orderedOrganizationPriorityEntries(orderWorkspace)} onReorder={(order) => orderCommit('Reorder unified organization priority', (draft) => reorderOrganizationPriority(draft, order))} render={(entry) => { const accent = organizationAccentFor(orderWorkspace, entry.kind, entry.name ?? undefined); const open = () => entry.kind === 'area' ? setRoute(entry.name === null ? { kind: 'area' } : { kind: 'area', area: entry.name }) : entry.kind === 'project' && entry.name !== null ? setRoute({ kind: 'project', project: entry.name }) : entry.kind === 'tag' ? setRoute(entry.name === null ? { kind: 'tag' } : { kind: 'tag', tag: entry.name }) : undefined; return <><span className={`organization-kind kind-${entry.kind}`}><FieldIcon path={entry.kind} label={entry.kind === 'area' ? 'Area' : entry.kind === 'project' ? 'Project' : 'Tag'} />{entry.kind}</span><span className="organization-priority-label"><button type="button" className={`organization-entity-link ${entry.kind === 'area' ? 'is-area' : entry.kind === 'project' ? 'is-project' : 'is-tag'}${entry.name === null ? ' organization-unassigned' : ''}`} style={accent ? { color: accent } : undefined} onClick={open}>{label(entry)}</button>{entry.kind === 'project' && entry.name !== null && <small>In {entry.area ?? 'No Area'}</small>}</span></>; }} /></section>
    <div className="organization-order-actions"><span>{orderDraft ? 'Order has unsaved changes' : 'Order is saved'}</span><Button disabled={!orderDraft} onClick={saveOrder}>Apply / Save order</Button><Button variant="secondary" disabled={!orderDraft} onClick={() => setOrderDraft(null)}>Reset order</Button></div>
    {onExport && <div className="organization-page-export"><Button size="compact" variant="secondary" onClick={onExport}>Export PARA</Button></div>}
  </section>;
}
