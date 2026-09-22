import { useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { VIEW_CREATION_DUE_PERIOD_EXTENSION, type SavedView, type UniversalItem, type WorkspaceDocument } from '@utm/core';
import { LineIcon } from '../../components/ui/icons';
import { CodeEditor } from '../../components/ui/CodeEditor';
import { Button } from '../../components/ui/primitives';
import { LiveTextInput } from '../items/LiveTextInput';
import { persistUiBoolean, readUiBoolean } from '../../components/ui/PersistedDetails';
import { ViewResults } from './ViewResults';
import { formatViewMetricsSummary, ViewMetricsSummary } from './ViewMetricsSummary';
import { manualOrderFor } from './viewSelectors';
import { useViewEvaluation } from './useViewEvaluation';
import { UserDataText, useTranslation } from '../../i18n-react';

export function SavedViewSection({ view, workspace, hiddenItemIds, onEditView, onEditItem, onState, onRendererChange: _onRendererChange, onAddItem, onQuickAddItem, onReorderItems, onResetOrder, onOpenChange, initialOpen, celebrationColors, showTechnicalSummary = true, reorderHandle, headerActions, allowAdd = false }: {
  view: SavedView; workspace: WorkspaceDocument; onEditView?: () => void; onEditItem: (item: UniversalItem) => void;
  onState: (item: UniversalItem, state: UniversalItem['state'], celebrationColor?: string) => void; onRendererChange: (renderer: SavedView['renderer']) => void; onAddItem: (view: SavedView) => void; onReorderItems?: (itemIds: string[]) => void; onResetOrder?: () => void; onOpenChange?: (open: boolean) => void; initialOpen?: boolean; celebrationColors?: ReadonlyMap<string, string> | undefined; showTechnicalSummary?: boolean; reorderHandle?: ReactNode;
  headerActions?: ReactNode;
  hiddenItemIds?: ReadonlySet<string> | undefined;
  allowAdd?: boolean;
  onQuickAddItem?: (view: SavedView, title: string) => void;
}) {
  const [open, setOpen] = useState(() => initialOpen ?? readUiBoolean(`view:${view.id}`, true));
  const [quickTitle, setQuickTitle] = useState('');
  const [quickError, setQuickError] = useState('');
  const t = useTranslation(workspace.calendarPreferences.language);
  const evaluation = useViewEvaluation(workspace, view);
  const matchingItems = evaluation.items.length;
  const metrics = evaluation.metrics;
  const metricsSummary = metrics ? formatViewMetricsSummary(metrics, workspace.calendarPreferences.language) : null;
  const hasManualOrder = manualOrderFor(view).length > 0;
  const viewStyle = view.accent ? ({ '--view-accent': view.accent } as CSSProperties) : undefined;
  const creationTags = Array.isArray(view.creationDefaults?.tags) ? view.creationDefaults.tags.filter((tag): tag is string => typeof tag === 'string') : [];
  const addTarget = view.project ?? view.area ?? view.list;
  const canAdd = Boolean(allowAdd || addTarget || Object.keys(view.creationDefaults ?? {}).length > 0 || view.extensions?.[VIEW_CREATION_DUE_PERIOD_EXTENSION]);
  const addLabel = addTarget ? `Add item to ${addTarget}` : creationTags.length === 1 ? `Add item to #${creationTags[0]}` : 'Add item';
  const submitQuickAdd = (event: FormEvent) => {
    event.preventDefault();
    const title = quickTitle.trim();
    if (!title || !onQuickAddItem) return;
    try { onQuickAddItem(view, title); setQuickTitle(''); setQuickError(''); }
    catch (reason) { setQuickError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const toggleOpen = () => {
    const next = !open;
    persistUiBoolean(`view:${view.id}`, next);
    setOpen(next);
    onOpenChange?.(next);
  };
  return <section className={`view-section${reorderHandle ? ' home-view' : ''}${open ? '' : ' is-collapsed'}${view.renderer === 'list' || view.renderer === 'table' ? ' is-reorderable' : ''}`} style={viewStyle}>
    <header className="view-section-summary">{!open && reorderHandle && <div className="view-section-reorder">{reorderHandle}</div>}<button type="button" className="view-section-title" aria-label={`${t(`${open ? 'Collapse' : 'Expand'} ${view.name}`)}${open && metricsSummary ? `. ${metricsSummary.ariaLabel}` : ''}`} aria-expanded={open} onClick={toggleOpen}><h2><UserDataText>{view.name}</UserDataText></h2>{open && metrics && <ViewMetricsSummary metrics={metrics} language={workspace.calendarPreferences.language} />}</button><div className="view-section-actions">{headerActions}{open && onEditView && <button type="button" className="icon-button view-settings-button" aria-label={t(`Edit ${view.name}`)} title={t('Edit view')} onClick={onEditView}><LineIcon name="settings" /></button>}</div></header>
    {open && <div className="view-section-body">{showTechnicalSummary && <div className="view-query-summary"><CodeEditor readOnly language="dsl" ariaLabel="View filter" value={view.query.source.trim() || 'true'} />{view.area && <code className="sort-preview">Area: {view.area}</code>}{view.project && <code className="sort-preview">Project: {view.project}</code>}{view.list && <code className="sort-preview">List: {view.list}</code>}{Object.keys(view.creationDefaults ?? {}).length > 0 && <code className="sort-preview">New item defaults: {Object.keys(view.creationDefaults ?? {}).length}</code>}{(view.sortSource || view.sort?.length) && <code className="sort-preview">Sort: {view.sortSource ?? view.sort.map((sort) => `${sort.field} ${sort.direction}`).join(' · ')}</code>}<p>{t(`${matchingItems} matching items`)}</p></div>}{hasManualOrder && <div className="manual-order-bar"><span>{t('Manual order')}</span><button type="button" onClick={onResetOrder}>{t('Reset order')}</button></div>}<div className="view-results-scroll"><ViewResults view={view} workspace={workspace} evaluation={evaluation} hiddenItemIds={hiddenItemIds} onEdit={onEditItem} onState={onState} onReorder={onReorderItems} celebrationColors={celebrationColors} /></div>{canAdd && (onQuickAddItem ? <form className="view-quick-add" data-quick-capture onSubmit={submitQuickAdd}><LiveTextInput value={quickTitle} onChange={(value) => { setQuickTitle(value); setQuickError(''); }} placeholder={t(addLabel)} ariaLabel={t(`Quick ${addLabel.toLowerCase()}`)} workspace={workspace} workspaceId={workspace.workspaceId} language={workspace.calendarPreferences.language} suggestionsEnabled={workspace.calendarPreferences.liveTextSuggestions !== false} now={evaluation.now} error={quickError} /></form> : <Button className="view-add-item" size="compact" onClick={() => onAddItem(view)}>+ {t(addLabel)}</Button>)}</div>}
  </section>;
}
