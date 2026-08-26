import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  defaultOrganizationPreferences, ensureAreaDefinition, ensureProjectDefinition, orderedOrganizationEntries, orderedOrganizationNames, orderedTagEntries, reorderOrganization, reorderTags,
  type OrganizationKind, type WorkspaceDocument,
} from '@utm/core';
import { Button, Field, Input, Select } from '../../components/ui/primitives';
import './organization-manager.css';

type Commit = (message: string, mutation: (draft: WorkspaceDocument) => void) => void;
type OrderEntry = string | null;
const entryKey = (entry: OrderEntry) => entry === null ? '__utm_unassigned__' : entry;

const moveEntry = (entries: OrderEntry[], dragged: OrderEntry, target: OrderEntry, after: boolean) => {
  if (dragged === target) return entries;
  const next = entries.filter((entry) => entry !== dragged);
  const index = next.indexOf(target);
  if (index < 0) return entries;
  next.splice(index + (after ? 1 : 0), 0, dragged);
  return next;
};

function DraggableRows({ entries, emptyLabel, onReorder, render }: { entries: OrderEntry[]; emptyLabel: string; onReorder: (entries: OrderEntry[]) => void; render: (entry: OrderEntry) => ReactNode }) {
  const drag = useRef<{ entry: OrderEntry; target?: OrderEntry; after?: boolean } | null>(null);
  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (current && current.target !== undefined) onReorder(moveEntry(entries, current.entry, current.target, Boolean(current.after)));
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
  };
  return <div className="organization-manager-list">{entries.map((entry) => <div className="organization-manager-row" data-order-entry={entryKey(entry)} key={entryKey(entry)}>
    <button type="button" className="organization-drag-handle" aria-label={`Reorder ${entry ?? emptyLabel}`} title="Drag to reorder" onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { entry }; }} onPointerMove={(event) => { if (!drag.current) return; const target = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-order-entry]'); const targetKey = target?.dataset.orderEntry; if (!targetKey) return; const targetEntry = targetKey === '__utm_unassigned__' ? null : targetKey; if (targetEntry === drag.current.entry) return; const bounds = target.getBoundingClientRect(); drag.current.target = targetEntry; drag.current.after = event.clientY >= bounds.top + bounds.height / 2; }} onPointerUp={finishDrag} onPointerCancel={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); drag.current = null; }}>⠿</button>
    {render(entry)}
  </div>)}</div>;
}

function OrganizationList({ kind, workspace, commit }: { kind: OrganizationKind; workspace: WorkspaceDocument; commit: Commit }) {
  const [name, setName] = useState('');
  const [parentArea, setParentArea] = useState('');
  const entries = orderedOrganizationEntries(workspace, kind);
  const add = () => {
    const value = name.trim(); if (!value) return;
    commit(`Create ${kind}`, (draft) => { if (kind === 'area') ensureAreaDefinition(draft, value); else ensureProjectDefinition(draft, value, { area: parentArea }); });
    setName(''); if (kind === 'project') setParentArea('');
  };
  const unassigned = kind === 'area' ? 'No Area' : 'No Project';
  return <section className="organization-manager-group"><header><div><h3>{kind === 'area' ? 'Areas' : 'Projects'}</h3><p>{kind === 'area' ? 'Ongoing responsibilities.' : 'Finite outcomes, optionally inside an Area.'}</p></div></header>
    <DraggableRows entries={entries} emptyLabel={unassigned} onReorder={(order) => commit(`Reorder ${kind}s`, (draft) => reorderOrganization(draft, kind, order))} render={(entry) => entry === null ? <strong className="organization-unassigned">{unassigned}</strong> : <><strong>{entry}</strong>{kind === 'project' && <Select aria-label={`Area for ${entry}`} value={workspace.projectDefinitions[entry]?.area ?? ''} onChange={(event) => commit('Change Project Area', (draft) => { ensureProjectDefinition(draft, entry, { area: event.target.value }); })}><option value="">No Area</option>{orderedOrganizationNames(workspace, 'area').map((area) => <option value={area} key={area}>{area}</option>)}</Select>}</>} />
    <div className="organization-manager-add"><Field label={`New ${kind}`}><Input value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} placeholder={kind === 'area' ? 'e.g. Work' : 'e.g. Repair the vehicle'} /></Field>{kind === 'project' && <Field label="Parent Area"><Select value={parentArea} onChange={(event) => setParentArea(event.target.value)}><option value="">No Area</option>{orderedOrganizationNames(workspace, 'area').map((area) => <option value={area} key={area}>{area}</option>)}</Select></Field>}<Button size="compact" onClick={add} disabled={!name.trim()}>Add</Button></div>
  </section>;
}

export function OrganizationManager({ workspace, commit }: { workspace: WorkspaceDocument; commit: Commit }) {
  const [tagName, setTagName] = useState('');
  const tags = orderedTagEntries(workspace);
  const addTag = () => {
    const tag = tagName.trim().replace(/^#+/, '');
    if (!tag) return;
    commit('Create tag', (draft) => {
      draft.organizationPreferences ??= defaultOrganizationPreferences();
      const order = draft.organizationPreferences.tagOrder;
      const existingIndex = order.indexOf(tag);
      if (existingIndex >= 0) order.splice(existingIndex, 1);
      order.push(tag);
    });
    setTagName('');
  };
  return <section className="settings-card organization-manager"><p className="eyebrow">PARA ORGANIZATION</p><h2>Areas, Projects and tags</h2><p>Drag each list into priority order. The top row wins. Item priority remains its own urgency and is never overwritten.</p><div className="organization-manager-columns"><OrganizationList kind="area" workspace={workspace} commit={commit} /><OrganizationList kind="project" workspace={workspace} commit={commit} /></div><section className="organization-tags"><h3>Tags</h3><p>Create and drag tags into priority order. An item with several tags uses its highest listed tag.</p><div className="organization-manager-add organization-tag-add"><Field label="New tag"><Input aria-label="New tag" value={tagName} onChange={(event) => setTagName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTag(); } }} placeholder="e.g. urgent" /></Field><Button size="compact" onClick={addTag} disabled={!tagName.trim().replace(/^#+/, '')}>Add tag</Button></div><DraggableRows entries={tags} emptyLabel="No Tags" onReorder={(order) => commit('Reorder tags', (draft) => reorderTags(draft, order))} render={(entry) => <strong className={entry === null ? 'organization-unassigned' : undefined}>{entry === null ? 'No Tags' : `#${entry}`}</strong>} /></section></section>;
}
