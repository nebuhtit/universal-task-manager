import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { calculateItemSetMetrics, type SavedView, type UniversalItem, type WorkspaceDocument } from '@utm/core';
import { LineIcon } from '../../components/ui/icons';
import { Input } from '../../components/ui/primitives';
import { persistUiBoolean, readUiBoolean } from '../../components/ui/PersistedDetails';
import { ViewResults } from './ViewResults';
import { formatViewMetricsSummary, ViewMetricsSummary } from './ViewMetricsSummary';
import { manualOrderFor, selectViewItems } from './viewSelectors';

export function SavedViewSection({ view, workspace, onEditView, onEditItem, onState, onRendererChange: _onRendererChange, onAddItem, onQuickAddItem, onReorderItems, onResetOrder, onOpenChange, initialOpen, celebrationColors, showTechnicalSummary = true, reorderHandle, headerActions, allowAdd = false }: {
  view: SavedView; workspace: WorkspaceDocument; onEditView?: () => void; onEditItem: (item: UniversalItem) => void;
  onState: (item: UniversalItem, state: UniversalItem['state'], celebrationColor?: string) => void; onRendererChange: (renderer: SavedView['renderer']) => void; onAddItem: (view: SavedView) => void; onReorderItems?: (itemIds: string[]) => void; onResetOrder?: () => void; onOpenChange?: (open: boolean) => void; initialOpen?: boolean; celebrationColors?: ReadonlyMap<string, string> | undefined; showTechnicalSummary?: boolean; reorderHandle?: ReactNode;
  headerActions?: ReactNode;
  allowAdd?: boolean;
  onQuickAddItem?: (view: SavedView, title: string) => void;
}) {
  const [open, setOpen] = useState(() => initialOpen ?? readUiBoolean(`view:${view.id}`, true));
  const [quickTitle, setQuickTitle] = useState('');
  useEffect(() => { persistUiBoolean(`view:${view.id}`, open); }, [open, view.id]);
  const matchingViewItems = selectViewItems(workspace, view);
  const matchingItems = matchingViewItems.length;
  const metrics = calculateItemSetMetrics(matchingViewItems);
  const metricsSummary = formatViewMetricsSummary(metrics, workspace.calendarPreferences.language);
  const hasManualOrder = manualOrderFor(view).length > 0;
  const viewStyle = view.accent ? ({ '--view-accent': view.accent } as CSSProperties) : undefined;
  const creationTags = Array.isArray(view.creationDefaults?.tags) ? view.creationDefaults.tags.filter((tag): tag is string => typeof tag === 'string') : [];
  const addTarget = view.project ?? view.area ?? view.list;
  const canAdd = Boolean(allowAdd || addTarget || Object.keys(view.creationDefaults ?? {}).length > 0);
  const addLabel = addTarget ? `Add item to ${addTarget}` : creationTags.length === 1 ? `Add item to #${creationTags[0]}` : 'Add item';
  const submitQuickAdd = (event: FormEvent) => {
    event.preventDefault();
    const title = quickTitle.trim();
    if (!title || !onQuickAddItem) return;
    onQuickAddItem(view, title);
    setQuickTitle('');
  };
  const toggleOpen = () => setOpen((current) => { const next = !current; onOpenChange?.(next); return next; });
  return <section className={`view-section${open ? '' : ' is-collapsed'}${view.renderer === 'list' || view.renderer === 'table' ? ' is-reorderable' : ''}`} style={viewStyle}>
    <header className="view-section-summary">{reorderHandle && <div className="view-section-reorder">{reorderHandle}</div>}<button type="button" className="view-section-title" aria-label={`${open ? 'Collapse' : 'Expand'} ${view.name}${metricsSummary ? `. ${metricsSummary.ariaLabel}` : ''}`} aria-expanded={open} onClick={toggleOpen}><h2>{view.name}</h2><ViewMetricsSummary metrics={metrics} language={workspace.calendarPreferences.language} /></button><div className="view-section-actions">{headerActions}{open && onEditView && <button type="button" className="icon-button view-settings-button" aria-label={`Edit ${view.name}`} title="Edit view" onClick={onEditView}><LineIcon name="settings" /></button>}</div></header>
    {open && <div className="view-section-body">{showTechnicalSummary && <div className="view-query-summary"><code>{view.query.source.trim() || 'All items'}</code>{view.area && <code className="sort-preview">Area: {view.area}</code>}{view.project && <code className="sort-preview">Project: {view.project}</code>}{view.list && <code className="sort-preview">List: {view.list}</code>}{Object.keys(view.creationDefaults ?? {}).length > 0 && <code className="sort-preview">New item defaults: {Object.keys(view.creationDefaults ?? {}).length}</code>}{(view.sortSource || view.sort?.length) && <code className="sort-preview">Sort: {view.sortSource ?? view.sort.map((sort) => `${sort.field} ${sort.direction}`).join(' · ')}</code>}<p>{matchingItems} matching items</p></div>}{hasManualOrder && <div className="manual-order-bar"><span>Manual order</span><button type="button" onClick={onResetOrder}>Reset order</button></div>}<div className="view-results-scroll"><ViewResults view={view} workspace={workspace} onEdit={onEditItem} onState={onState} onReorder={onReorderItems} celebrationColors={celebrationColors} /></div>{canAdd && (onQuickAddItem ? <form className="view-quick-add" data-quick-capture onSubmit={submitQuickAdd}><Input enterKeyHint="done" value={quickTitle} onChange={(event) => setQuickTitle(event.target.value)} placeholder={addLabel} aria-label={`Quick ${addLabel.toLowerCase()}`} /></form> : <button className="view-add-item" type="button" onClick={() => onAddItem(view)}>+ {addLabel}</button>)}</div>}
  </section>;
}
