import { organizationAccentFor, type ItemScriptField, type UniversalItem, type WorkspaceDocument } from '@utm/core';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { flushSync } from 'react-dom';
import { formatViewDate } from '../../utils/dates';
import { previewCompletionSound } from '../../hooks/useUiSounds';
import { displayViewValue, inferredPreset, priorityNames, readItemField, viewFieldLabel } from './fieldDisplay';
import { FieldIcon } from './FieldIcon';
import { UserDataText, useTranslation } from '../../i18n-react';
import { OverdueDueIndicator, overdueAgeWithoutActiveRange } from './OverdueDueIndicator';
import { ItemStateMarker } from './ItemStateMarker';

const touchStateCommits = new Map<string, number>();

export function ItemCard({ item, onEdit, onState, fields, workspace, now, viewScripts = [], celebrating = false }: { item: UniversalItem; onEdit: () => void; onState: (state: UniversalItem['state']) => void; fields?: string[]; workspace?: WorkspaceDocument; now?: Date; viewScripts?: readonly ItemScriptField[]; celebrating?: boolean }) {
  const t = useTranslation(workspace?.calendarPreferences.language ?? 'en');
  const due = item.schedule?.dueAt ?? item.schedule?.startAt;
  const today = (now ?? new Date()).toISOString().slice(0, 10);
  const isHabit = Boolean(item.habit);
  const readOnlyExternal = Boolean(item.external?.readOnly);
  const habitCompletedToday = isHabit && Boolean(item.habit?.completedDates?.includes(today));
  const visiblyClosed = isHabit ? habitCompletedToday : item.state !== 'open';
  const [optimisticClosed, setOptimisticClosed] = useState<boolean | null>(null);
  const optimisticReset = useRef<number | undefined>(undefined);
  const shownClosed = optimisticClosed ?? visiblyClosed;
  const primeStateToggle = (event?: ReactPointerEvent<HTMLButtonElement>) => {
    if (readOnlyExternal) return;
    if (event && event.pointerType === 'mouse' && event.button !== 0) return;
    if (!visiblyClosed) previewCompletionSound(item.id, workspace?.calendarPreferences.appearance.tickSound);
    flushSync(() => setOptimisticClosed(!visiblyClosed));
    if (optimisticReset.current) window.clearTimeout(optimisticReset.current);
    optimisticReset.current = window.setTimeout(() => setOptimisticClosed(null), 1_200);
  };
  const beginStateToggle = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (readOnlyExternal) return;
    primeStateToggle(event);
    if (event.pointerType === 'mouse') return;
    touchStateCommits.set(item.id, performance.now() + 1_000);
    const nextState = visiblyClosed ? 'open' : 'done';
    onState(nextState);
  };
  const finishStateToggle = () => {
    if (readOnlyExternal) return;
    const touchCommitUntil = touchStateCommits.get(item.id) ?? 0;
    touchStateCommits.delete(item.id);
    if (touchCommitUntil >= performance.now()) {
      return;
    }
    if (optimisticClosed === null) primeStateToggle();
    const nextState = visiblyClosed ? 'open' : 'done';
    onState(nextState);
  };
  useLayoutEffect(() => {
    if (optimisticClosed === visiblyClosed) {
      if (optimisticReset.current) window.clearTimeout(optimisticReset.current);
      optimisticReset.current = undefined;
      setOptimisticClosed(null);
    }
  }, [optimisticClosed, visiblyClosed]);
  useEffect(() => () => { if (optimisticReset.current) window.clearTimeout(optimisticReset.current); }, []);
  const customDisplay = fields !== undefined;
  const displayNow = now ?? new Date();
  const overdueAgeIndicatorEnabled = workspace?.calendarPreferences.appearance.overdueAgeIndicator !== false;
  const showOverdueDueIndicator = overdueAgeIndicatorEnabled && overdueAgeWithoutActiveRange(item, displayNow) !== null;
  const metadataFields = (fields?.filter((field) => field !== 'title') ?? [])
    .map((field) => ({
      field,
      value: field === 'priority' && item.priority !== undefined
        ? priorityNames[item.priority]
        : displayViewValue(readItemField(item, field, workspace, now, viewScripts), field, workspace?.calendarPreferences.language),
    }));
  const organizationValue = (field: string) => {
    const names = field === 'area' || field === 'areas' ? item.areas : field === 'project' || field === 'projects' ? item.projects : field === 'tags' ? item.tags : null;
    if (!names || !workspace) return null;
    const kind = field === 'area' || field === 'areas' ? 'area' : field === 'project' || field === 'projects' ? 'project' : 'tag';
    return <>{names.map((name, index) => <span className="organization-colored-name" translate="no" data-utm-user-data style={{ '--organization-accent': organizationAccentFor(workspace, kind, name) } as CSSProperties} key={name}>{index ? ', ' : ''}{kind === 'tag' ? '#' : ''}{name}</span>)}</>;
  };
  return <article className={`item-card state-${item.state}${celebrating ? ' is-celebrating' : ''}${optimisticClosed === true ? ' is-optimistic-complete' : optimisticClosed === false ? ' is-optimistic-reopen' : ''}`}>
    <ItemStateMarker item={item} googleLabel={t('Read-only Google Calendar event')} onOpen={onEdit}><button className={`state-toggle${optimisticClosed === true ? ' is-optimistic-closed' : ''}`} disabled={readOnlyExternal} data-sound={!visiblyClosed && !readOnlyExternal ? 'none' : undefined} aria-label={t(isHabit ? (habitCompletedToday ? 'Undo habit completion today' : 'Complete habit today') : item.state === 'open' ? 'Complete item' : 'Reopen item')} onPointerDown={beginStateToggle} onClick={finishStateToggle}>
      {shownClosed ? '✓' : ''}
    </button></ItemStateMarker>
    <button className="item-main" onClick={onEdit}>
      {(!customDisplay || fields?.includes('title')) && <UserDataText className="item-title">{item.title}</UserDataText>}
      {!customDisplay && <span className="item-meta"><OverdueDueIndicator item={item} now={displayNow} label={t('Overdue')} enabled={overdueAgeIndicatorEnabled} /><span className={`preset ${inferredPreset(item)}`}>{t(inferredPreset(item))}</span>{due && <span>{formatViewDate(due, !item.schedule?.allDay, workspace?.calendarPreferences.language)}</span>}{item.schedule?.estimatedDuration && <span>{item.schedule.estimatedDuration}</span>}{item.tags.slice(0, 2).map((tag) => <span className="organization-colored-name" translate="no" data-utm-user-data style={{ '--organization-accent': workspace ? organizationAccentFor(workspace, 'tag', tag) : undefined } as CSSProperties} key={tag}>#{tag}</span>)}{item.closure?.reason === 'auto_renew' && <span className="auto-pill">{t('auto-closed')}</span>}</span>}
      {customDisplay && (showOverdueDueIndicator || metadataFields.length > 0) && <span className="view-item-fields"><OverdueDueIndicator item={item} now={displayNow} label={t('Overdue')} enabled={overdueAgeIndicatorEnabled} />{metadataFields.map(({ field, value }) => { const label = viewFieldLabel(workspace!, field, viewScripts); const coloredValue = organizationValue(field); const interfaceValue = field === 'priority' || field === 'state' || field === 'preset'; return <span key={field} data-field={field} title={field === 'bodyMarkdown' ? value : undefined} aria-label={value ? `${label}: ${value}` : undefined}>{value && <FieldIcon path={field} label={label} />}{coloredValue ?? (interfaceValue ? t(value) : <UserDataText>{value}</UserDataText>)}</span>; })}</span>}
    </button>
    {item.priority && !customDisplay ? <button className={`priority p${item.priority}`} title={t(`Priority ${item.priority}: ${priorityNames[item.priority]}. Click to edit.`)} aria-label={t(`Priority ${item.priority}: ${priorityNames[item.priority]}. Edit item`)} onClick={onEdit}>{t(priorityNames[item.priority])}</button> : null}
  </article>;
}
