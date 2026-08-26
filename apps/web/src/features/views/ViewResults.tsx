import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { effectiveWorkspaceNow, type SavedView, type UniversalItem, type WorkspaceDocument } from '@utm/core';
import { FieldIcon, ItemCard, displayViewValue, readItemField, stateNames } from '../items';
import { formatViewDate } from '../../utils/dates';
import { viewFieldLabel } from './fieldCatalog';
import { boardSettingsFor, moveManualItem, selectViewItems } from './viewSelectors';

const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const VIEW_LIVE_TICK_MS = 1_000;
export const viewNeedsLiveClock = (view: Pick<SavedView, 'fields'>) => view.fields.some((field) => field === 'scripts' || field.startsWith('script.'));

export function ViewResults({ view, workspace, onEdit, onState, onReorder, celebratingIds = new Set<string>() }: {
  view: SavedView; workspace: WorkspaceDocument; onEdit: (item: UniversalItem) => void;
  onState: (item: UniversalItem, state: UniversalItem['state']) => void; onReorder?: ((itemIds: string[]) => void) | undefined; celebratingIds?: ReadonlySet<string> | undefined;
}) {
  const [liveNow, setLiveNow] = useState(() => effectiveWorkspaceNow(workspace));
  const hasLiveScriptField = viewNeedsLiveClock(view);
  useEffect(() => {
    if (!hasLiveScriptField) return undefined;
    const updateClock = () => setLiveNow(effectiveWorkspaceNow(workspace));
    updateClock();
    const timer = window.setInterval(updateClock, VIEW_LIVE_TICK_MS);
    return () => window.clearInterval(timer);
  }, [hasLiveScriptField, workspace.calendarPreferences.testClock]);
  const renderWorkspace = useMemo(() => clean(workspace), [workspace]);
  const renderView = useMemo(() => clean(view), [view]);
  const items = selectViewItems(renderWorkspace, renderView);
  const drag = useRef<{ itemId: string; targetId?: string | undefined; after?: boolean | undefined } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const itemIds = items.map((item) => item.id);
  const visibleFields = renderView.fields ?? [];
  const today = liveNow.toISOString().slice(0, 10);
  const stateButtonLabel = (item: UniversalItem) => item.habit
    ? (item.habit.completedDates?.includes(today) ? 'Undo habit completion today' : 'Complete habit today')
    : item.state === 'open' ? `Complete ${item.title}` : `Reopen ${item.title}`;
  const nextState = (item: UniversalItem): UniversalItem['state'] => item.habit && item.habit.completedDates?.includes(today) ? 'open' : item.state === 'open' ? 'done' : 'open';
  const isCelebrating = (item: UniversalItem) => celebratingIds.has(item.id);
  const isOpen = (item: UniversalItem) => item.state === 'open' && !item.habit?.completedDates?.includes(today);
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
    aria-label={`Reorder ${item.title}`}
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
    if (field === 'title') return <strong key={field}>{item.title}</strong>;
    const value = displayViewValue(readItemField(item, field, renderWorkspace, liveNow), field, renderWorkspace.calendarPreferences.language);
    const label = viewFieldLabel(renderWorkspace, field);
    return value ? <span key={field} aria-label={`${label}: ${value}`}><FieldIcon path={field} label={label} />{value}</span> : null;
  })}</span>;
  if (!items.length) return <p className="empty">No items match this view.</p>;
  if (renderView.renderer === 'calendar') {
    const dated = items.flatMap((item) => { const date = item.schedule?.startAt ?? item.schedule?.dueAt; return date ? [{ item, date }] : []; });
    return dated.length ? <div className="calendar-strip">{dated.map(({ item, date }) => <article className={`calendar-item state-${item.state}${isCelebrating(item) ? ' is-celebrating' : ''}`} key={item.id}><button className="state-toggle" aria-label={stateButtonLabel(item)} onClick={() => onState(item, nextState(item))}>{isOpen(item) ? '' : '✓'}</button><button className="calendar-main" onClick={() => onEdit(item)}><time dateTime={date}>{formatViewDate(date, false, renderWorkspace.calendarPreferences.language)}</time>{fieldContent(item, ['schedule.startAt', 'schedule.dueAt'])}</button></article>)}</div> : <p className="empty">Matching items have no dates.</p>;
  }
  if (renderView.renderer === 'board') {
    const settings = boardSettingsFor(renderView);
    const columns = settings.groupBy === 'tag'
      ? [...new Set(items.flatMap((item) => item.tags))].sort((a, b) => a.localeCompare(b)).map((tag) => ({ key: tag, label: `#${tag}`, items: items.filter((item) => item.tags.includes(tag)) })).concat([{ key: '__untagged__', label: 'No tags', items: items.filter((item) => item.tags.length === 0) }])
      : settings.states.map((state) => ({ key: state, label: stateNames[state], items: items.filter((item) => item.state === state) }));
    const visibleColumns = columns.filter((column) => settings.showEmpty || column.items.length > 0);
    return visibleColumns.length ? <div className="mini-board">{visibleColumns.map(({ key, label, items: columnItems }) => <section key={key}><h4>{label}</h4>{columnItems.map((item) => <article className={`board-item state-${item.state}${isCelebrating(item) ? ' is-celebrating' : ''}`} key={item.id}><button className="state-toggle" aria-label={stateButtonLabel(item)} onClick={() => onState(item, nextState(item))}>{isOpen(item) ? '' : '✓'}</button><button className="board-item-main" onClick={() => onEdit(item)}>{fieldContent(item, ['state'])}</button></article>)}</section>)}</div> : <p className="empty">No items match this board.</p>;
  }
  if (renderView.renderer === 'table') return <div className="table-wrap renderer-table-wrap"><table><thead><tr><th className="reorder-column"><span className="sr-only">Manual order</span></th><th className="state-column"><span className="sr-only">Complete</span></th>{visibleFields.map((field) => { const label = viewFieldLabel(renderWorkspace, field); return <th key={field} aria-label={label} title={label}><FieldIcon path={field} label={label} /><span className="sr-only">{label}</span></th>; })}</tr></thead><tbody>{items.map((item) => <tr data-view-item-id={item.id} className={`state-${item.state}${isCelebrating(item) ? ' is-celebrating' : ''}${draggingId === item.id ? ' is-dragging' : ''}${dropTargetId === item.id ? ' is-drop-target' : ''}`} key={item.id} onClick={() => onEdit(item)}><td className="reorder-column">{dragHandle(item)}</td><td className="state-column"><button className="state-toggle" aria-label={stateButtonLabel(item)} onClick={(event) => { event.stopPropagation(); onState(item, nextState(item)); }}>{isOpen(item) ? '' : '✓'}</button></td>{visibleFields.map((field) => { const value = displayViewValue(readItemField(item, field, renderWorkspace, liveNow), field, renderWorkspace.calendarPreferences.language); return <td key={field} data-field={field} title={field === 'bodyMarkdown' ? value : undefined}>{value}</td>; })}</tr>)}</tbody></table></div>;
  return <div className="item-list reorderable-item-list">{items.map((item) => <div data-view-item-id={item.id} className={`reorderable-view-item${draggingId === item.id ? ' is-dragging' : ''}${dropTargetId === item.id ? ' is-drop-target' : ''}`} key={item.id}>{dragHandle(item)}<ItemCard item={item} celebrating={isCelebrating(item)} fields={visibleFields} workspace={renderWorkspace} now={liveNow} onEdit={() => onEdit(item)} onState={(state) => onState(item, state)} /></div>)}</div>;
}
