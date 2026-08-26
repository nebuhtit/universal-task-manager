import { useEffect, useState, type CSSProperties } from 'react';
import type { SavedView, UniversalItem, WorkspaceDocument } from '@utm/core';
import { LineIcon } from '../../components/ui/icons';
import { persistUiBoolean, readUiBoolean } from '../../components/ui/PersistedDetails';
import { ViewResults } from './ViewResults';
import { selectViewItems } from './viewSelectors';

export function SavedViewSection({ view, workspace, onEditView, onEditItem, onState, onRendererChange: _onRendererChange, onAddItem, onOpenChange, initialOpen, celebratingIds, showTechnicalSummary = true }: {
  view: SavedView; workspace: WorkspaceDocument; onEditView: () => void; onEditItem: (item: UniversalItem) => void;
  onState: (item: UniversalItem, state: UniversalItem['state']) => void; onRendererChange: (renderer: SavedView['renderer']) => void; onAddItem: (view: SavedView) => void; onOpenChange?: (open: boolean) => void; initialOpen?: boolean; celebratingIds?: ReadonlySet<string> | undefined; showTechnicalSummary?: boolean;
}) {
  const [open, setOpen] = useState(() => initialOpen ?? readUiBoolean(`view:${view.id}`, true));
  useEffect(() => { persistUiBoolean(`view:${view.id}`, open); }, [open, view.id]);
  const matchingItems = selectViewItems(workspace, view).length;
  const viewStyle = view.accent ? ({ '--view-accent': view.accent } as CSSProperties) : undefined;
  return <section className={`view-section${open ? '' : ' is-collapsed'}`} style={viewStyle}>
    <header className="view-section-summary"><div><h2>{view.name}</h2></div><div className="view-section-actions">{open && <button type="button" className="icon-button view-settings-button" aria-label={`Edit ${view.name}`} title="Edit view" onClick={onEditView}><LineIcon name="settings" /></button>}<button type="button" className="view-collapse-button" aria-label={`${open ? 'Collapse' : 'Expand'} ${view.name}`} aria-expanded={open} onClick={() => setOpen((current) => { const next = !current; onOpenChange?.(next); return next; })}>{open ? '−' : <LineIcon name="chevronDown"/>}</button></div></header>
    {open && <div className="view-section-body">{showTechnicalSummary && <div className="view-query-summary"><code>{view.query.source.trim() || 'All items'}</code>{view.list && <code className="sort-preview">List: {view.list}</code>}{Object.keys(view.creationDefaults ?? {}).length > 0 && <code className="sort-preview">New item defaults: {Object.keys(view.creationDefaults ?? {}).length}</code>}{(view.sortSource || view.sort?.length) && <code className="sort-preview">Sort: {view.sortSource ?? view.sort.map((sort) => `${sort.field} ${sort.direction}`).join(' · ')}</code>}<p>{matchingItems} matching items</p></div>}<div className="view-results-scroll"><ViewResults view={view} workspace={workspace} onEdit={onEditItem} onState={onState} celebratingIds={celebratingIds} /></div>{(view.list || Object.keys(view.creationDefaults ?? {}).length > 0) && <button className="view-add-item" type="button" onClick={() => onAddItem(view)}>{view.list ? `+ Add item to ${view.list}` : '+ Add item'}</button>}</div>}
  </section>;
}
