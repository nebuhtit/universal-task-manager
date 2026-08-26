import type { UniversalItem, WorkspaceDocument } from '@utm/core';
import { formatViewDate } from '../../utils/dates';
import { displayViewValue, inferredPreset, priorityNames, readItemField, viewFieldLabel } from './fieldDisplay';
import { FieldIcon } from './FieldIcon';

export function ItemCard({ item, onEdit, onState, fields, workspace, celebrating = false }: { item: UniversalItem; onEdit: () => void; onState: (state: UniversalItem['state']) => void; fields?: string[]; workspace?: WorkspaceDocument; celebrating?: boolean }) {
  const due = item.schedule?.dueAt ?? item.schedule?.startAt;
  const today = new Date().toISOString().slice(0, 10);
  const isHabit = Boolean(item.habit);
  const habitCompletedToday = isHabit && Boolean(item.habit?.completedDates?.includes(today));
  const visiblyClosed = isHabit ? habitCompletedToday : item.state !== 'open';
  const customDisplay = fields !== undefined;
  const metadataFields = (fields?.filter((field) => field !== 'title' && field !== 'priority') ?? [])
    .map((field) => ({ field, value: displayViewValue(readItemField(item, field, workspace), field, workspace?.calendarPreferences.language) }));
  return <article className={`item-card state-${item.state}${celebrating ? ' is-celebrating' : ''}`}>
    <button className="state-toggle" aria-label={isHabit ? (habitCompletedToday ? 'Undo habit completion today' : 'Complete habit today') : item.state === 'open' ? 'Complete item' : 'Reopen item'} onClick={() => onState(visiblyClosed ? 'open' : 'done')}>
      {visiblyClosed ? '✓' : ''}
    </button>
    <button className="item-main" onClick={onEdit}>
      {(!customDisplay || fields?.includes('title')) && <span className="item-title">{item.title}</span>}
      {!customDisplay && <span className="item-meta"><span className={`preset ${inferredPreset(item)}`}>{inferredPreset(item)}</span>{due && <span>{formatViewDate(due, !item.schedule?.allDay, workspace?.calendarPreferences.language)}</span>}{item.schedule?.estimatedDuration && <span>{item.schedule.estimatedDuration}</span>}{item.tags.slice(0, 2).map((tag) => <span key={tag}>#{tag}</span>)}{item.closure?.reason === 'auto_renew' && <span className="auto-pill">auto-closed</span>}</span>}
      {customDisplay && metadataFields.length > 0 && <span className="view-item-fields">{metadataFields.map(({ field, value }) => { const label = viewFieldLabel(workspace!, field); return <span key={field} aria-label={value ? `${label}: ${value}` : label}>{value && <FieldIcon path={field} label={label} />}{value}</span>; })}</span>}
    </button>
    {item.priority && (!customDisplay || fields?.includes('priority')) ? <button className={`priority p${item.priority}`} title={`Priority ${item.priority}: ${priorityNames[item.priority]}. Click to edit.`} aria-label={`Priority ${item.priority}: ${priorityNames[item.priority]}. Edit item`} onClick={onEdit}>{priorityNames[item.priority]}</button> : null}
  </article>;
}
