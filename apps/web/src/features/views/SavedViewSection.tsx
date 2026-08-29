import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { SavedView, UniversalItem, WorkspaceDocument } from '@utm/core';
import { LineIcon } from '../../components/ui/icons';
import { persistUiBoolean, readUiBoolean } from '../../components/ui/PersistedDetails';
import { ViewResults } from './ViewResults';
import { manualOrderFor, selectViewItems } from './viewSelectors';

export function SavedViewSection({ view, workspace, onEditView, onEditItem, onState, onRendererChange: _onRendererChange, onAddItem, onReorderItems, onResetOrder, onOpenChange, initialOpen, celebratingIds, showTechnicalSummary = true, reorderHandle }: {
  view: SavedView; workspace: WorkspaceDocument; onEditView: () => void; onEditItem: (item: UniversalItem) => void;
  onState: (item: UniversalItem, state: UniversalItem['state']) => void; onRendererChange: (renderer: SavedView['renderer']) => void; onAddItem: (view: SavedView) => void; onReorderItems?: (itemIds: string[]) => void; onResetOrder?: () => void; onOpenChange?: (open: boolean) => void; initialOpen?: boolean; celebratingIds?: ReadonlySet<string> | undefined; showTechnicalSummary?: boolean; reorderHandle?: ReactNode;
}) {
  const [open, setOpen] = useState(() => initialOpen ?? readUiBoolean(`view:${view.id}`, true));
  useEffect(() => { persistUiBoolean(`view:${view.id}`, open); }, [open, view.id]);
  const matchingItems = selectViewItems(workspace, view).length;
  const hasManualOrder = manualOrderFor(view).length > 0;
  const viewStyle = view.accent ? ({ '--view-accent': view.accent } as CSSProperties) : undefined;
  const addTarget = view.project ?? view.area ?? view.list;
  const canAdd = Boolean(addTarget || Object.keys(view.creationDefaults ?? {}).length > 0);
  const toggleOpen = () => setOpen((current) => { const next = !current; onOpenChange?.(next); return next; });
  return <section className={`view-section${open ? '' : ' is-collapsed'}${view.renderer === 'list' || view.renderer === 'table' ? ' is-reorderable' : ''}`} style={viewStyle}>
    <header className="view-section-summary">{reorderHandle && <div className="view-section-reorder">{reorderHandle}</div>}<button type="button" className="view-section-title" aria-expanded={open} onClick={toggleOpen}><h2>{view.name}</h2></button><div className="view-section-actions">{open && <button type="button" className="icon-button view-settings-button" aria-label={`Edit ${view.name}`} title="Edit view" onClick={onEditView}><LineIcon name="settings" /></button>}</div></header>
    {open && <div className="view-section-body">{showTechnicalSummary && <div className="view-query-summary"><code>{view.query.source.trim() || 'All items'}</code>{view.area && <code className="sort-preview">Area: {view.area}</code>}{view.project && <code className="sort-preview">Project: {view.project}</code>}{view.list && <code className="sort-preview">List: {view.list}</code>}{Object.keys(view.creationDefaults ?? {}).length > 0 && <code className="sort-preview">New item defaults: {Object.keys(view.creationDefaults ?? {}).length}</code>}{(view.sortSource || view.sort?.length) && <code className="sort-preview">Sort: {view.sortSource ?? view.sort.map((sort) => `${sort.field} ${sort.direction}`).join(' · ')}</code>}<p>{matchingItems} matching items</p></div>}{hasManualOrder && <div className="manual-order-bar"><span>Manual order</span><button type="button" onClick={onResetOrder}>Reset order</button></div>}<div className="view-results-scroll"><ViewResults view={view} workspace={workspace} onEdit={onEditItem} onState={onState} onReorder={onReorderItems} celebratingIds={celebratingIds} /></div>{canAdd && <button className="view-add-item" type="button" onClick={() => onAddItem(view)}>{addTarget ? `+ Add item to ${addTarget}` : '+ Add item'}</button>}</div>}
  </section>;
}
