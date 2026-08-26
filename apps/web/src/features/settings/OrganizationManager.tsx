import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  defaultOrganizationPreferences, ensureAreaDefinition, ensureProjectDefinition, orderedOrganizationNames, organizationPreferencesFor, reorderOrganization,
  type OrganizationKind, type WorkspaceDocument,
} from '@utm/core';
import { Button, Field, Input, Select } from '../../components/ui/primitives';
import './organization-manager.css';

type Commit = (message: string, mutation: (draft: WorkspaceDocument) => void) => void;

const moveName = (names: string[], dragged: string, target: string, after: boolean) => {
  if (dragged === target) return names;
  const next = names.filter((name) => name !== dragged);
  const index = next.indexOf(target);
  if (index < 0) return names;
  next.splice(index + (after ? 1 : 0), 0, dragged);
  return next;
};

function OrganizationList({ kind, workspace, commit }: { kind: OrganizationKind; workspace: WorkspaceDocument; commit: Commit }) {
  const [name, setName] = useState('');
  const [parentArea, setParentArea] = useState('');
  const drag = useRef<{ name: string; target?: string; after?: boolean } | null>(null);
  const names = orderedOrganizationNames(workspace, kind);
  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (current?.target) commit(`Reorder ${kind}s`, (draft) => reorderOrganization(draft, kind, moveName(orderedOrganizationNames(draft, kind), current.name, current.target!, Boolean(current.after))));
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
  };
  const add = () => {
    const value = name.trim(); if (!value) return;
    commit(`Create ${kind}`, (draft) => { if (kind === 'area') ensureAreaDefinition(draft, value); else ensureProjectDefinition(draft, value, { area: parentArea }); });
    setName(''); if (kind === 'project') setParentArea('');
  };
  return <section className="organization-manager-group"><header><div><h3>{kind === 'area' ? 'Areas' : 'Projects'}</h3><p>{kind === 'area' ? 'Ongoing responsibilities.' : 'Finite outcomes, optionally inside an Area.'}</p></div></header>
    <div className="organization-manager-list">{names.map((entry) => {
      const definition = kind === 'area' ? workspace.areaDefinitions[entry] : workspace.projectDefinitions[entry];
      return <div className="organization-manager-row" data-organization-name={entry} key={entry}>
        <button type="button" className="organization-drag-handle" aria-label={`Reorder ${entry}`} title="Drag to reorder" onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { name: entry }; }} onPointerMove={(event) => { if (!drag.current) return; const target = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-organization-name]'); const targetName = target?.dataset.organizationName; if (!targetName || targetName === drag.current.name) return; const bounds = target.getBoundingClientRect(); drag.current.target = targetName; drag.current.after = event.clientY >= bounds.top + bounds.height / 2; }} onPointerUp={finishDrag} onPointerCancel={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); drag.current = null; }}>⠿</button>
        <strong>{entry}</strong>
        {kind === 'project' && <Select aria-label={`Area for ${entry}`} value={workspace.projectDefinitions[entry]?.area ?? ''} onChange={(event) => commit('Change Project Area', (draft) => { ensureProjectDefinition(draft, entry, { area: event.target.value }); })}><option value="">No Area</option>{orderedOrganizationNames(workspace, 'area').map((area) => <option value={area} key={area}>{area}</option>)}</Select>}
        <Select aria-label={`Priority for ${entry}`} value={definition?.priority ?? 0} onChange={(event) => commit(`Change ${kind} priority`, (draft) => { const priority = Number(event.target.value) as 0 | 1 | 2 | 3 | 4; if (kind === 'area') ensureAreaDefinition(draft, entry, { priority }); else ensureProjectDefinition(draft, entry, { priority }); })}>{[0, 1, 2, 3, 4].map((priority) => <option value={priority} key={priority}>Priority {priority}</option>)}</Select>
      </div>;
    })}{!names.length && <p className="empty">No {kind}s yet.</p>}</div>
    <div className="organization-manager-add"><Field label={`New ${kind}`}><Input value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} placeholder={kind === 'area' ? 'e.g. Work' : 'e.g. Repair the vehicle'} /></Field>{kind === 'project' && <Field label="Parent Area"><Select value={parentArea} onChange={(event) => setParentArea(event.target.value)}><option value="">No Area</option>{orderedOrganizationNames(workspace, 'area').map((area) => <option value={area} key={area}>{area}</option>)}</Select></Field>}<Button size="compact" onClick={add} disabled={!name.trim()}>Add</Button></div>
  </section>;
}

export function OrganizationManager({ workspace, commit }: { workspace: WorkspaceDocument; commit: Commit }) {
  const preferences = organizationPreferencesFor(workspace);
  const tags = [...new Set(Object.values(workspace.items).flatMap((item) => item.tags).map((tag) => tag.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
  const options = [0, 1, 2, 3, 4].map((priority) => <option value={priority} key={priority}>Priority {priority}</option>);
  return <section className="settings-card organization-manager"><p className="eyebrow">PARA ORGANIZATION</p><h2>Areas, Projects and tags</h2><p>Priority is coarse importance. Drag order resolves Area and Project ties. Item priority remains its own urgency and is never overwritten.</p><div className="organization-manager-columns"><OrganizationList kind="area" workspace={workspace} commit={commit} /><OrganizationList kind="project" workspace={workspace} commit={commit} /></div><div className="organization-fallbacks"><Field label="Items without Area" hint="Used by Area order sorting when Area is empty."><Select value={preferences.unassignedAreaPriority} onChange={(event) => commit('Change priority for items without Area', (draft) => { draft.organizationPreferences ??= defaultOrganizationPreferences(); draft.organizationPreferences.unassignedAreaPriority = Number(event.target.value) as 0 | 1 | 2 | 3 | 4; })}>{options}</Select></Field><Field label="Items without Project" hint="Used by Project order sorting when Project is empty."><Select value={preferences.unassignedProjectPriority} onChange={(event) => commit('Change priority for items without Project', (draft) => { draft.organizationPreferences ??= defaultOrganizationPreferences(); draft.organizationPreferences.unassignedProjectPriority = Number(event.target.value) as 0 | 1 | 2 | 3 | 4; })}>{options}</Select></Field></div><section className="organization-tags"><h3>Tag priorities</h3><p>When an item has several tags, Tag order uses the highest configured priority.</p><div className="organization-manager-list">{tags.map((tag) => <div className="organization-tag-row" key={tag}><strong>#{tag}</strong><Select aria-label={`Priority for tag ${tag}`} value={preferences.tagPriorities[tag] ?? 0} onChange={(event) => commit('Change tag priority', (draft) => { draft.organizationPreferences ??= defaultOrganizationPreferences(); draft.organizationPreferences.tagPriorities[tag] = Number(event.target.value) as 0 | 1 | 2 | 3 | 4; })}>{options}</Select></div>)}{!tags.length && <p className="empty">No tags yet. Add a tag to an item first.</p>}</div></section></section>;
}
