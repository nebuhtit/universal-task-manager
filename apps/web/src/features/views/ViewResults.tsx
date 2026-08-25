import { useEffect, useMemo, useState } from 'react';
import type { SavedView, UniversalItem, WorkspaceDocument } from '@utm/core';
import { ItemCard, displayViewValue, readItemField, stateNames } from '../items';
import { formatViewDate } from '../../utils/dates';
import { viewFieldLabel } from './fieldCatalog';
import { boardSettingsFor, selectViewItems } from './viewSelectors';

const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function ViewResults({ view, workspace, onEdit, onState, celebratingIds = new Set<string>() }: {
  view: SavedView; workspace: WorkspaceDocument; onEdit: (item: UniversalItem) => void;
  onState: (item: UniversalItem, state: UniversalItem['state']) => void; celebratingIds?: ReadonlySet<string> | undefined;
}) {
  const [liveNow, setLiveNow] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setLiveNow(new Date()), 30_000); return () => window.clearInterval(timer); }, []);
  const renderWorkspace = useMemo(() => clean(workspace), [workspace]);
  const renderView = useMemo(() => clean(view), [view]);
  const items = selectViewItems(renderWorkspace, renderView);
  const visibleFields = renderView.fields ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const stateButtonLabel = (item: UniversalItem) => item.habit
    ? (item.habit.completedDates?.includes(today) ? 'Undo habit completion today' : 'Complete habit today')
    : item.state === 'open' ? `Complete ${item.title}` : `Reopen ${item.title}`;
  const nextState = (item: UniversalItem): UniversalItem['state'] => item.habit && item.habit.completedDates?.includes(today) ? 'open' : item.state === 'open' ? 'done' : 'open';
  const isCelebrating = (item: UniversalItem) => celebratingIds.has(item.id);
  const isOpen = (item: UniversalItem) => item.state === 'open' && !item.habit?.completedDates?.includes(today);
  const fieldContent = (item: UniversalItem, omit: string[] = []) => <span className="renderer-fields">{visibleFields.filter((field) => !omit.includes(field)).map((field) => {
    if (field === 'title') return <strong key={field}>{item.title}</strong>;
    const value = displayViewValue(readItemField(item, field, renderWorkspace, liveNow), field, renderWorkspace.calendarPreferences.language);
    return value ? <span key={field}><small>{viewFieldLabel(renderWorkspace, field)}</small>{value}</span> : null;
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
  if (renderView.renderer === 'table') return <div className="table-wrap renderer-table-wrap"><table><thead><tr><th className="state-column"><span className="sr-only">Complete</span></th>{visibleFields.map((field) => <th key={field}>{viewFieldLabel(renderWorkspace, field)}</th>)}</tr></thead><tbody>{items.map((item) => <tr className={`state-${item.state}${isCelebrating(item) ? ' is-celebrating' : ''}`} key={item.id} onClick={() => onEdit(item)}><td className="state-column"><button className="state-toggle" aria-label={stateButtonLabel(item)} onClick={(event) => { event.stopPropagation(); onState(item, nextState(item)); }}>{isOpen(item) ? '' : '✓'}</button></td>{visibleFields.map((field) => <td key={field}>{displayViewValue(readItemField(item, field, renderWorkspace, liveNow), field, renderWorkspace.calendarPreferences.language)}</td>)}</tr>)}</tbody></table></div>;
  return <div className="item-list">{items.map((item) => <ItemCard key={item.id} item={item} celebrating={isCelebrating(item)} fields={visibleFields} workspace={renderWorkspace} onEdit={() => onEdit(item)} onState={(state) => onState(item, state)} />)}</div>;
}
