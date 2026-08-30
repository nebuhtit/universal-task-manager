import { organizationAccentFor, type UniversalItem, type WorkspaceDocument } from '@utm/core';
import type { CSSProperties } from 'react';
import { formatViewDate } from '../../utils/dates';
import { displayViewValue, inferredPreset, priorityNames, readItemField, viewFieldLabel } from './fieldDisplay';
import { FieldIcon } from './FieldIcon';

export function ItemCard({ item, onEdit, onState, fields, workspace, now, celebrating = false }: { item: UniversalItem; onEdit: () => void; onState: (state: UniversalItem['state']) => void; fields?: string[]; workspace?: WorkspaceDocument; now?: Date; celebrating?: boolean }) {
  const due = item.schedule?.dueAt ?? item.schedule?.startAt;
  const today = (now ?? new Date()).toISOString().slice(0, 10);
  const isHabit = Boolean(item.habit);
  const habitCompletedToday = isHabit && Boolean(item.habit?.completedDates?.includes(today));
  const visiblyClosed = isHabit ? habitCompletedToday : item.state !== 'open';
  const customDisplay = fields !== undefined;
  const metadataFields = (fields?.filter((field) => field !== 'title') ?? [])
    .map((field) => ({
      field,
      value: field === 'priority' && item.priority !== undefined
        ? priorityNames[item.priority]
        : displayViewValue(readItemField(item, field, workspace, now), field, workspace?.calendarPreferences.language),
    }));
  const organizationValue = (field: string) => {
    const names = field === 'area' || field === 'areas' ? item.areas : field === 'project' || field === 'projects' ? item.projects : field === 'tags' ? item.tags : null;
    if (!names || !workspace) return null;
    const kind = field === 'area' || field === 'areas' ? 'area' : field === 'project' || field === 'projects' ? 'project' : 'tag';
    return <>{names.map((name, index) => <span className="organization-colored-name" style={{ '--organization-accent': organizationAccentFor(workspace, kind, name) } as CSSProperties} key={name}>{index ? ', ' : ''}{kind === 'tag' ? '#' : ''}{name}</span>)}</>;
  };
  return <article className={`item-card state-${item.state}${celebrating ? ' is-celebrating' : ''}`}>
    <button className="state-toggle" aria-label={isHabit ? (habitCompletedToday ? 'Undo habit completion today' : 'Complete habit today') : item.state === 'open' ? 'Complete item' : 'Reopen item'} onClick={() => onState(visiblyClosed ? 'open' : 'done')}>
      {visiblyClosed ? '✓' : ''}
    </button>
    <button className="item-main" onClick={onEdit}>
      {(!customDisplay || fields?.includes('title')) && <span className="item-title">{item.title}</span>}
      {!customDisplay && <span className="item-meta"><span className={`preset ${inferredPreset(item)}`}>{inferredPreset(item)}</span>{due && <span>{formatViewDate(due, !item.schedule?.allDay, workspace?.calendarPreferences.language)}</span>}{item.schedule?.estimatedDuration && <span>{item.schedule.estimatedDuration}</span>}{item.tags.slice(0, 2).map((tag) => <span className="organization-colored-name" style={{ '--organization-accent': workspace ? organizationAccentFor(workspace, 'tag', tag) : undefined } as CSSProperties} key={tag}>#{tag}</span>)}{item.closure?.reason === 'auto_renew' && <span className="auto-pill">auto-closed</span>}</span>}
      {customDisplay && metadataFields.length > 0 && <span className="view-item-fields">{metadataFields.map(({ field, value }) => { const label = viewFieldLabel(workspace!, field); const coloredValue = organizationValue(field); return <span key={field} data-field={field} title={field === 'bodyMarkdown' ? value : undefined} aria-label={value ? `${label}: ${value}` : undefined}>{value && <FieldIcon path={field} label={label} />}{coloredValue ?? value}</span>; })}</span>}
    </button>
    {item.priority && !customDisplay ? <button className={`priority p${item.priority}`} title={`Priority ${item.priority}: ${priorityNames[item.priority]}. Click to edit.`} aria-label={`Priority ${item.priority}: ${priorityNames[item.priority]}. Edit item`} onClick={onEdit}>{priorityNames[item.priority]}</button> : null}
  </article>;
}
