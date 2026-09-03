import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { type SavedView, type UniversalItem, type WorkspaceDocument } from '@utm/core';
import { FieldIcon, ItemCard, displayViewValue, readItemField, stateNames } from '../items';
import { formatViewDate } from '../../utils/dates';
import { viewFieldLabel } from './fieldCatalog';
import { boardSettingsFor, completionPhase, moveManualItem, selectViewItems, viewDependsOnCurrentTime, type ViewEvaluation } from './viewSelectors';
import { useViewNow } from './useViewEvaluation';
import { recordDiagnostic } from '../../services/diagnostics';
import { previewCompletionSound } from '../../hooks/useUiSounds';
import { UserDataText, useTranslation } from '../../i18n-react';
import { longListClass } from '../../performance/longList';

export const VIEW_LIVE_TICK_MS = 1_000;
export const viewNeedsLiveClock = (view: Pick<SavedView, 'fields'> & Partial<Pick<SavedView, 'scripts'>>, workspace?: WorkspaceDocument) => workspace
  ? viewDependsOnCurrentTime(workspace, view as SavedView)
  : view.fields.some((field) => field === 'scripts' || field.startsWith('script.') || field === 'view_scripts' || field.startsWith('view_script.'));

export function ViewResults({ view, workspace, evaluation, onEdit, onState, onReorder, celebrationColors = new Map<string, string>() }: {
  view: SavedView; workspace: WorkspaceDocument; onEdit: (item: UniversalItem) => void;
  evaluation?: ViewEvaluation; onState: (item: UniversalItem, state: UniversalItem['state'], celebrationColor?: string) => void; onReorder?: ((itemIds: string[]) => void) | undefined; celebrationColors?: ReadonlyMap<string, string> | undefined;
}) {
  const t = useTranslation(workspace.calendarPreferences.language);
  const fallbackNow = useViewNow(workspace, view, evaluation?.now);
  const liveNow = evaluation?.now ?? fallbackNow;
  const renderWorkspace = workspace;
  const renderView = view;
  const items = evaluation?.items ?? selectViewItems(renderWorkspace, renderView, liveNow);
  const drag = useRef<{ itemId: string; targetId?: string | undefined; after?: boolean | undefined } | null>(null);
  const stateCommittedOnPointerDown = useRef(new Set<string>());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const itemIds = items.map((item) => item.id);
  const itemSignature = itemIds.join('|');
  const previousItemIds = useRef<string[] | null>(null);
  useEffect(() => {
    const previous = previousItemIds.current;
    if (previous === null) {
      recordDiagnostic({
        kind: 'result', message: 'View results rendered', operation: 'View result visibility', outcome: 'succeeded',
        details: JSON.stringify({ viewId: renderView.id, renderer: renderView.renderer, count: itemIds.length, itemIds: itemIds.slice(0, 100), truncated: itemIds.length > 100 }),
      });
    } else {
      const previousSet = new Set(previous);
      const currentSet = new Set(itemIds);
      const appeared = itemIds.filter((id) => !previousSet.has(id));
      const disappeared = previous.filter((id) => !currentSet.has(id));
      if (appeared.length || disappeared.length) recordDiagnostic({
        kind: 'result', message: itemIds.length === 0 && previous.length > 0 ? 'View results became empty' : 'View result membership changed', operation: 'View result visibility', outcome: 'succeeded',
        details: JSON.stringify({ viewId: renderView.id, renderer: renderView.renderer, previousCount: previous.length, count: itemIds.length, appeared: appeared.slice(0, 100), disappeared: disappeared.slice(0, 100), truncated: appeared.length > 100 || disappeared.length > 100 }),
      });
    }
    previousItemIds.current = itemIds;
  }, [itemSignature, renderView.id, renderView.renderer]);
  const visibleFields = renderView.fields ?? [];
  const today = liveNow.toISOString().slice(0, 10);
  const stateButtonLabel = (item: UniversalItem) => item.habit
    ? t(item.habit.completedDates?.includes(today) ? 'Undo habit completion today' : 'Complete habit today')
    : `${renderWorkspace.calendarPreferences.language === 'en'
      ? (item.state === 'open' ? 'Complete' : 'Reopen')
      : t(item.state === 'open' ? 'Complete item' : 'Reopen item')} ${item.title}`;
  const readOnlyExternal = (item: UniversalItem) => Boolean(item.external?.readOnly);
  const nextState = (item: UniversalItem): UniversalItem['state'] => item.habit && item.habit.completedDates?.includes(today) ? 'open' : item.state === 'open' ? 'done' : 'open';
  const celebrationColor = (item: UniversalItem) => celebrationColors.get(item.id);
  const isCelebrating = (item: UniversalItem) => celebrationColors.has(item.id);
  const isExiting = (item: UniversalItem) => completionPhase(item.id) === 'exiting';
  const celebrationStyle = (item: UniversalItem) => {
    const color = celebrationColor(item);
    return color ? ({ '--completion-accent': color } as CSSProperties) : undefined;
  };
  const changeState = (item: UniversalItem) => onState(item, nextState(item), view.accent ?? 'var(--color-text)');
  const previewState = (item: UniversalItem) => { if (isOpen(item)) previewCompletionSound(item.id, workspace.calendarPreferences.appearance.tickSound); };
  const isOpen = (item: UniversalItem) => item.state === 'open' && !item.habit?.completedDates?.includes(today);
  const beginStateChange = (item: UniversalItem, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (readOnlyExternal(item)) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    previewState(item);
    if (event.pointerType === 'mouse') return;
    stateCommittedOnPointerDown.current.add(item.id);
    changeState(item);
  };
  const finishStateChange = (item: UniversalItem) => {
    if (readOnlyExternal(item)) return;
    if (stateCommittedOnPointerDown.current.delete(item.id)) return;
    changeState(item);
  };
  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (current?.targetId && onReorder) onReorder(moveManualItem(itemIds, current.itemId, current.targetId, current.after));
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null; setDraggingId(null); setDropTargetId(null);
  };
  const cancelDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null; setDraggingId(null); setDropTargetId(null);
  };
  const dragHandle = (item: UniversalItem) => <button
    type="button"
    className="view-drag-handle"
    aria-label={t(`Reorder ${item.title}`)}
    translate="no"
    data-utm-user-data
    aria-grabbed={draggingId === item.id}
    title="Drag to set a manual order. Use arrow keys for precise movement."
    onClick={(event) => event.stopPropagation()}
    onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (!onReorder || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
      const index = itemIds.indexOf(item.id); const direction = event.key === 'ArrowUp' ? -1 : 1; const target = itemIds[index + direction];
      if (!target) return; event.preventDefault(); event.stopPropagation(); onReorder(moveManualItem(itemIds, item.id, target, direction > 0));
    }}
    onPointerDown={(event) => {
      if (!onReorder || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { itemId: item.id }; setDraggingId(item.id);
    }}
    onPointerMove={(event) => {
      if (!drag.current) return;
      const target = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-view-item-id]');
      const targetId = target?.dataset.viewItemId;
      if (!targetId || targetId === drag.current.itemId) { drag.current.targetId = undefined; setDropTargetId(null); return; }
      const bounds = target.getBoundingClientRect(); drag.current.targetId = targetId; drag.current.after = event.clientY >= bounds.top + bounds.height / 2; setDropTargetId(targetId);
    }}
    onPointerUp={finishDrag}
    onPointerCancel={cancelDrag}
  ><span aria-hidden>⠿</span></button>;
  const fieldContent = (item: UniversalItem, omit: string[] = []) => <span className="renderer-fields">{visibleFields.filter((field) => !omit.includes(field)).map((field) => {
    if (field === 'title') return <strong key={field}><UserDataText>{item.title}</UserDataText></strong>;
    const value = displayViewValue(readItemField(item, field, renderWorkspace, liveNow, renderView.scripts), field, renderWorkspace.calendarPreferences.language);
    const label = viewFieldLabel(renderWorkspace, field, renderView.scripts);
    return value ? <span key={field} aria-label={`${label}: ${value}`}><FieldIcon path={field} label={label} /><UserDataText>{value}</UserDataText></span> : null;
  })}</span>;
  if (!items.length) return <p className="empty">{t('No items match this view.')}</p>;
  if (renderView.renderer === 'calendar') {
    const dated = items.flatMap((item) => { const date = item.schedule?.startAt ?? item.schedule?.dueAt; return date ? [{ item, date }] : []; });
    return dated.length ? <div className="calendar-strip">{dated.map(({ item, date }) => <article className={`calendar-item state-${item.state}${isCelebrating(item) ? ' is-celebrating' : ''}${isExiting(item) ? ' is-exiting' : ''}`} style={celebrationStyle(item)} key={item.id}><button className="state-toggle" disabled={readOnlyExternal(item)} data-sound={isOpen(item) && !readOnlyExternal(item) ? 'none' : undefined} aria-label={readOnlyExternal(item) ? t('Read-only Google Calendar event') : stateButtonLabel(item)} translate="no" data-utm-user-data onPointerDown={(event) => beginStateChange(item, event)} onClick={() => finishStateChange(item)}>{isOpen(item) ? '' : '✓'}</button><button className="calendar-main" onClick={() => onEdit(item)}><time dateTime={date}>{formatViewDate(date, false, renderWorkspace.calendarPreferences.language)}</time>{fieldContent(item, ['schedule.startAt', 'schedule.dueAt'])}</button></article>)}</div> : <p className="empty">{t('Matching items have no dates.')}</p>;
  }
  if (renderView.renderer === 'board') {
    const settings = boardSettingsFor(renderView);
    const columns = settings.groupBy === 'tag'
      ? [...new Set(items.flatMap((item) => item.tags))].sort((a, b) => a.localeCompare(b)).map((tag) => ({ key: tag, label: `#${tag}`, userData: true, items: items.filter((item) => item.tags.includes(tag)) })).concat([{ key: '__untagged__', label: 'No tags', userData: false, items: items.filter((item) => item.tags.length === 0) }])
      : settings.states.map((state) => ({ key: state, label: stateNames[state], userData: false, items: items.filter((item) => item.state === state) }));
    const visibleColumns = columns.filter((column) => settings.showEmpty || column.items.length > 0);
    return visibleColumns.length ? <div className="mini-board">{visibleColumns.map(({ key, label, userData, items: columnItems }) => <section key={key}><h4>{userData ? <UserDataText>{label}</UserDataText> : t(label)}</h4>{columnItems.map((item) => <article className={`board-item state-${item.state}${isCelebrating(item) ? ' is-celebrating' : ''}${isExiting(item) ? ' is-exiting' : ''}`} style={celebrationStyle(item)} key={item.id}><button className="state-toggle" disabled={readOnlyExternal(item)} data-sound={isOpen(item) && !readOnlyExternal(item) ? 'none' : undefined} aria-label={readOnlyExternal(item) ? t('Read-only Google Calendar event') : stateButtonLabel(item)} translate="no" data-utm-user-data onPointerDown={(event) => beginStateChange(item, event)} onClick={() => finishStateChange(item)}>{isOpen(item) ? '' : '✓'}</button><button className="board-item-main" onClick={() => onEdit(item)}>{fieldContent(item, ['state'])}</button></article>)}</section>)}</div> : <p className="empty">{t('No items match this board.')}</p>;
  }
  if (renderView.renderer === 'table') return <div className="table-wrap renderer-table-wrap"><table><thead><tr><th className="reorder-column"><span className="sr-only">{t('Manual order')}</span></th><th className="state-column"><span className="sr-only">{t('Complete')}</span></th>{visibleFields.map((field) => { const label = viewFieldLabel(renderWorkspace, field, renderView.scripts); return <th key={field} aria-label={label} title={label}><FieldIcon path={field} label={label} /><span className="sr-only">{t(label)}</span></th>; })}</tr></thead><tbody>{items.map((item) => <tr data-view-item-id={item.id} className={`state-${item.state}${isCelebrating(item) ? ' is-celebrating' : ''}${isExiting(item) ? ' is-exiting' : ''}${draggingId === item.id ? ' is-dragging' : ''}${dropTargetId === item.id ? ' is-drop-target' : ''}`} style={celebrationStyle(item)} key={item.id} onClick={() => onEdit(item)}><td className="reorder-column">{dragHandle(item)}</td><td className="state-column"><button className="state-toggle" disabled={readOnlyExternal(item)} data-sound={isOpen(item) && !readOnlyExternal(item) ? 'none' : undefined} aria-label={readOnlyExternal(item) ? t('Read-only Google Calendar event') : stateButtonLabel(item)} translate="no" data-utm-user-data onPointerDown={(event) => { event.stopPropagation(); beginStateChange(item, event); }} onClick={(event) => { event.stopPropagation(); finishStateChange(item); }}>{isOpen(item) ? '' : '✓'}</button></td>{visibleFields.map((field) => { const value = displayViewValue(readItemField(item, field, renderWorkspace, liveNow, renderView.scripts), field, renderWorkspace.calendarPreferences.language); return <td key={field} data-field={field} translate="no" data-utm-user-data title={field === 'bodyMarkdown' ? value : undefined}>{value}</td>; })}</tr>)}</tbody></table></div>;
  return <div className={longListClass('item-list reorderable-item-list', items.length)}>{items.map((item) => <div data-view-item-id={item.id} className={`view-item-exit-shell${isExiting(item) ? ' is-exiting' : ''}`} key={item.id}><div className={`reorderable-view-item${draggingId === item.id ? ' is-dragging' : ''}${dropTargetId === item.id ? ' is-drop-target' : ''}${isCelebrating(item) ? ' is-celebrating' : ''}`} style={celebrationStyle(item)}>{dragHandle(item)}<ItemCard item={item} celebrating={false} fields={visibleFields} workspace={renderWorkspace} now={liveNow} viewScripts={renderView.scripts ?? []} onEdit={() => onEdit(item)} onState={(state) => onState(item, state, view.accent ?? 'var(--color-text)')} /></div></div>)}</div>;
}
