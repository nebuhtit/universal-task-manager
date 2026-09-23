import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  createOccurrence, effectiveWorkspaceNow,
  type ItemPreset, type ProjectedOccurrence, type UniversalItem, type WorkspaceDocument,
} from '@utm/core';
import { LineIcon } from '../../components/ui/icons';
import { persistUiBoolean, readUiBoolean } from '../../components/ui/PersistedDetails';
import { Button, IconButton, Surface } from '../../components/ui/primitives';
import { formatCompactRemainingDuration } from '../views/ViewMetricsSummary';
import { ViewResults } from '../views/ViewResults';
import { clockService } from '../../services/clockService';
import { completionHoldsSnapshot, sortViewItems, subscribeCompletionHolds } from '../views/viewSelectors';
import { useViewNow, useWorkspaceBoundaryNow } from '../views/useViewEvaluation';
import { CalendarDayViewEditor } from './CalendarDayViewEditor';
import { CalendarTimeline } from './CalendarTimeline';
import { calendarDayView, evaluateCalendarRange } from './calendarEvaluation';
import { calendarVisibleCapacity } from './calendarCapacity';
import { MoonPhase } from './MoonPhase';
import { calendarUndatedItems, showOverdueToday } from './calendarVisibility';
import './calendar.css';

const DAY_MS = 86_400_000;
const subscribeCapacityClock = (listener: () => void) => clockService.subscribe(listener, 60_000);
type NavigatorMode = 'week' | 'month';

function localDateKey(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch { return date.toISOString().slice(0, 10); }
}

const dateFromKey = (key: string) => new Date(`${key}T12:00:00.000Z`);
const shiftDateKey = (key: string, days: number) => new Date(dateFromKey(key).getTime() + days * DAY_MS).toISOString().slice(0, 10);
const monthStart = (key: string) => `${key.slice(0, 7)}-01`;
function nextMonthStart(key: string): string {
  const [year, month] = key.slice(0, 7).split('-').map(Number);
  return new Date(Date.UTC(year!, month!, 1, 12)).toISOString().slice(0, 10);
}
function shiftMonth(key: string, direction: -1 | 1): string {
  const [year, month, day] = key.split('-').map(Number);
  const target = new Date(Date.UTC(year!, month! - 1 + direction, 1, 12));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
  target.setUTCDate(Math.min(day!, lastDay));
  return target.toISOString().slice(0, 10);
}
function weekStart(key: string, startsOn: 0 | 1): string {
  const weekday = dateFromKey(key).getUTCDay();
  return shiftDateKey(key, -((weekday - startsOn + 7) % 7));
}

export function CalendarPage({ workspace, now: suppliedNow, commit, onEditItem, onState, createUiItem: _createUiItem, celebrationColors = new Map(), requestedDate, onSelectedDateChange }: {
  workspace: WorkspaceDocument;
  now?: Date;
  commit: (message: string, mutation: (draft: WorkspaceDocument) => void) => void;
  onEditItem: (item: UniversalItem) => void;
  onState: (item: UniversalItem, state: UniversalItem['state'], celebrationColor?: string) => void;
  createUiItem: (title?: string, preset?: ItemPreset, now?: Date) => UniversalItem;
  celebrationColors?: ReadonlyMap<string, string>;
  requestedDate?: { key: string; request: number };
  onSelectedDateChange?: (key: string) => void;
}) {
  const preferences = workspace.calendarPreferences;
  const navigationNow = useWorkspaceBoundaryNow(workspace, suppliedNow);
  const initialNow = suppliedNow ?? navigationNow;
  const [selectedDate, setSelectedDate] = useState(() => localDateKey(initialNow, preferences.timezone));
  useEffect(() => { onSelectedDateChange?.(selectedDate); }, [selectedDate, onSelectedDateChange]);
  useEffect(() => { if (requestedDate) setSelectedDate(requestedDate.key); }, [requestedDate]);
  const [navigatorMode, setNavigatorMode] = useState<NavigatorMode>('week');
  const [editorOpen, setEditorOpen] = useState(false);
  const [allDayOpen, setAllDayOpen] = useState(() => readUiBoolean('calendar:all-day', true));
  const dayPanelRef = useRef<HTMLDivElement>(null);
  const todayChoiceRef = useRef<HTMLButtonElement>(null);
  const completionVersion = useSyncExternalStore(subscribeCompletionHolds, completionHoldsSnapshot, completionHoldsSnapshot);
  const selectedDayView = calendarDayView(selectedDate, preferences.dayView);
  const now = useViewNow(workspace, selectedDayView, suppliedNow);
  const capacityClock = useSyncExternalStore(subscribeCapacityClock, clockService.getSnapshot, clockService.getSnapshot);
  const capacityNow = suppliedNow ?? effectiveWorkspaceNow(workspace, new Date(capacityClock));
  const todayKey = localDateKey(suppliedNow ?? navigationNow, preferences.timezone);
  const rangeStartKey = navigatorMode === 'week' ? weekStart(selectedDate, preferences.weekStartsOn) : monthStart(selectedDate);
  const rangeEndKey = navigatorMode === 'week' ? shiftDateKey(rangeStartKey, 7) : nextMonthStart(selectedDate);

  const dayKeys = useMemo(() => {
    const keys: string[] = [];
    for (let key = rangeStartKey; key < rangeEndKey; key = shiftDateKey(key, 1)) keys.push(key);
    return keys;
  }, [rangeStartKey, rangeEndKey]);
  const calendar = useMemo(() => evaluateCalendarRange(workspace, rangeStartKey, rangeEndKey, preferences.dayView, now), [completionVersion, workspace, rangeStartKey, rangeEndKey, preferences.dayView, now.getTime()]);
  const dayData = calendar.days;
  const selected = dayData[selectedDate]!;
  const overdueIds = new Set(selected.evaluation.items.filter(item => showOverdueToday(item, selectedDate, now, preferences.timezone, item.occurrence ? workspace.items[item.occurrence.seriesId] : undefined)).map(item => item.id));
  const allDayIds = new Set(selected.evaluation.items.filter(item => item.schedule?.allDay && !overdueIds.has(item.id)).map(item => item.id));
  const selectedIds = new Set(selected.evaluation.items.map(item => item.id));
  const allUndatedItems = useMemo(() => calendarUndatedItems(workspace, now), [workspace, now.getTime()]);
  const undatedItems = sortViewItems(workspace, selected.view, allUndatedItems.filter(item => !selectedIds.has(item.id)), now);
  const capacities = useMemo(() => Object.fromEntries(dayKeys.map(key => [key, calendarVisibleCapacity(workspace, dayData[key]!, key, capacityNow, allUndatedItems, allDayOpen)])), [workspace, dayData, dayKeys, capacityNow.getTime(), allUndatedItems, allDayOpen]);
  const capacityLabel = (key: string, compact = false) => {
    const result = capacities[key]!;
    const amount = formatCompactRemainingDuration(Math.abs(result.freeMs), preferences.language) || '0min';
    const reserve = result.hiddenReservedMs > 0 ? ` · ${preferences.language === 'ru' ? 'скрытый резерв' : 'hidden reserve'} ${formatCompactRemainingDuration(result.hiddenReservedMs, preferences.language)}` : '';
    return `${result.freeMs < 0 ? (preferences.language === 'ru' ? 'Перегрузка' : 'Over capacity') : (preferences.language === 'ru' ? 'Свободно' : 'Free')} ${amount}${compact ? '' : reserve}`;
  };
  const timelineSettings = preferences.timeline ?? { mode: 'list' as const, hideSleep: false };
  const setTimelineSetting = (changes: Partial<typeof timelineSettings>) => commit('Calendar visibility', draft => { draft.calendarPreferences.timeline = { ...draft.calendarPreferences.timeline, mode: 'list', hideSleep: draft.calendarPreferences.timeline?.hideSleep ?? false, ...changes }; });
  const rowsById = new Map(selected.entries.map(({ row, item }) => [item.id, row]));
  const formatDate = (key: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(preferences.language, { ...options, timeZone: 'UTC' }).format(dateFromKey(key));
  const selectedLabel = formatDate(selectedDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const weekdayOffset = navigatorMode === 'month' ? (dateFromKey(rangeStartKey).getUTCDay() - preferences.weekStartsOn + 7) % 7 : 0;
  const labelWeek = weekStart('2026-08-31', preferences.weekStartsOn);

  useLayoutEffect(() => {
    if (navigatorMode !== 'week' || selectedDate !== todayKey) return;
    const panel = dayPanelRef.current;
    const today = todayChoiceRef.current;
    if (!panel || !today || panel.scrollWidth <= panel.clientWidth) return;
    panel.scrollLeft = Math.max(0, today.offsetLeft - (panel.clientWidth - today.offsetWidth) / 2);
  }, [navigatorMode, selectedDate, todayKey]);

  const materialize = (row: ProjectedOccurrence): UniversalItem | undefined => {
    if (!row.virtual) return workspace.items[row.materializedItemId ?? row.id];
    let result: UniversalItem | undefined;
    commit('Materialize calendar occurrence', (draft) => {
      const source = draft.items[row.sourceItemId];
      if (!source || !row.recurrenceId) return;
      const occurrence = createOccurrence(source, new Date(row.recurrenceId), 0);
      draft.items[occurrence.id] = occurrence;
      result = structuredClone(occurrence);
    });
    return result;
  };
  const openItem = (item: UniversalItem) => {
    const row = rowsById.get(item.id);
    const source = row ? materialize(row) : resolveTimelineItem(item);
    if (source) onEditItem(source);
  };
  const changeState = (item: UniversalItem, state: UniversalItem['state'], color?: string) => {
    if (item.external?.readOnly) { window.open(item.external.sourceUrl, '_blank', 'noopener,noreferrer'); return; }
    const row = rowsById.get(item.id);
    const source = row ? materialize(row) : resolveTimelineItem(item);
    if (source) window.setTimeout(() => onState(source, state, color), 0);
  };

  const resolveTimelineItem = (item: UniversalItem): UniversalItem | undefined => {
    if (workspace.items[item.id]) return workspace.items[item.id];
    if (!item.occurrence) return item;
    let result: UniversalItem | undefined;
    commit('Materialize timeline occurrence', draft => {
      const series = draft.items[item.occurrence!.seriesId];
      if (!series) return;
      const occurrence = createOccurrence(series, new Date(item.occurrence!.recurrenceId), 0);
      draft.items[occurrence.id] = occurrence;
      result = structuredClone(occurrence);
    });
    return result;
  };

  return <section className="calendar-page page-section">
    <header className="calendar-title">
      <div><div className="calendar-heading-date"><h1>{selectedLabel}</h1><MoonPhase dateKey={selectedDate} zone={preferences.timezone} ru={preferences.language === 'ru'} /></div>{selected.view.statistics?.showTime !== false && <span className="view-metrics-summary" data-testid="calendar-header-capacity">{capacityLabel(selectedDate)}</span>}</div>
      <IconButton size="compact" variant="ghost" onClick={() => setEditorOpen(true)} aria-label="Edit calendar day view"><LineIcon name="settings" /></IconButton>
    </header>

    <Surface className="calendar-navigator">
      <div className="calendar-navigator-toolbar">
        <div className="calendar-period-switch" aria-label="Calendar navigation mode">
          {(['week', 'month'] as const).map((mode) => <Button size="compact" variant="ghost" aria-pressed={navigatorMode === mode} className={navigatorMode === mode ? 'active' : ''} key={mode} onClick={() => setNavigatorMode(mode)}>{mode === 'week' ? 'Week' : 'Month'}</Button>)}
        </div>
        <div className="calendar-period-actions">
          <IconButton size="compact" variant="ghost" aria-label="Previous period" onClick={() => setSelectedDate(navigatorMode === 'week' ? shiftDateKey(selectedDate, -7) : shiftMonth(selectedDate, -1))}>‹</IconButton>
          <Button size="compact" variant="ghost" onClick={() => setSelectedDate(todayKey)}>Today</Button>
          <IconButton size="compact" variant="ghost" aria-label="Next period" onClick={() => setSelectedDate(navigatorMode === 'week' ? shiftDateKey(selectedDate, 7) : shiftMonth(selectedDate, 1))}>›</IconButton>
        </div>
      </div>
      <div className={`calendar-day-panel is-${navigatorMode}`} ref={dayPanelRef}>
        {navigatorMode === 'month' && Array.from({ length: 7 }, (_, index) => <span className="calendar-weekday-label" key={index}>{formatDate(shiftDateKey(labelWeek, index), { weekday: 'short' })}</span>)}
        {navigatorMode === 'month' && Array.from({ length: weekdayOffset }, (_, index) => <span className="calendar-day-spacer" key={index} />)}
        {dayKeys.map((key) => <button type="button" ref={key === todayKey ? todayChoiceRef : undefined} className={`calendar-day-choice${key === selectedDate ? ' selected' : ''}${key === todayKey ? ' today' : ''}`} aria-pressed={key === selectedDate} aria-current={key === todayKey ? 'date' : undefined} onClick={() => setSelectedDate(key)} key={key}>
          <span className="calendar-day-label"><b>{navigatorMode === 'week' ? formatDate(key, { weekday: 'short' }) : Number(key.slice(-2))}</b>{navigatorMode === 'week' && <small>{formatDate(key, { day: 'numeric', month: 'short' })}</small>}</span>
          {dayData[key]!.view.statistics?.showTime !== false && <span className="view-metrics-summary" aria-label={capacityLabel(key)}>{capacityLabel(key, true)}{capacities[key]!.hiddenReservedMs > 0 ? ' *' : ''}</span>}
        </button>)}
      </div>
    </Surface>

    <div className="calendar-display-switch" role="group" aria-label="Calendar display mode">
      <Button size="compact" aria-pressed={preferences.timeline?.mode !== 'timeline'} onClick={() => commit('Calendar list mode', draft => { draft.calendarPreferences.timeline = { ...preferences.timeline, mode: 'list', hideSleep: preferences.timeline?.hideSleep ?? false }; })}>{preferences.language === 'ru' ? 'Список' : 'List'}</Button>
      <Button size="compact" aria-pressed={preferences.timeline?.mode === 'timeline'} onClick={() => commit('Calendar timeline mode', draft => { draft.calendarPreferences.timeline = { ...preferences.timeline, mode: 'timeline', hideSleep: preferences.timeline?.hideSleep ?? false }; })}>Timeline</Button>
    </div>
    {preferences.timeline?.mode === 'timeline'
      ? <CalendarTimeline workspace={workspace} dateKey={selectedDate} now={now} suppliedNow={suppliedNow} capacityLabel={capacityLabel(selectedDate)} reservedItems={selected.reservedItems.filter(item => !selected.evaluation.items.some(visible => (visible.occurrence?.seriesId ?? visible.id) === (item.occurrence?.seriesId ?? item.id)))} allDayOpen={allDayOpen} onAllDayChange={setAllDayOpen} onEdit={openItem} onState={changeState} onPreferences={settings => commit('Timeline preferences', draft => { draft.calendarPreferences.timeline = settings; })} onSwipeDay={direction => setSelectedDate(current => shiftDateKey(current, direction))} />
      : <><div className="timeline-toolbar calendar-list-toolbar">
        {overdueIds.size > 0 && <Button size="compact" aria-pressed={timelineSettings.showOverdue !== false} onClick={() => setTimelineSetting({ showOverdue: timelineSettings.showOverdue === false })}>{preferences.language === 'ru' ? 'Просрочено' : 'Overdue'} · {overdueIds.size}</Button>}
        <Button size="compact" aria-pressed={timelineSettings.showUndated === true} onClick={() => setTimelineSetting({ showUndated: timelineSettings.showUndated !== true })}>{preferences.language === 'ru' ? 'Без даты' : 'No date'}{undatedItems.length ? ` · ${undatedItems.length}` : ''}</Button>
        {allDayIds.size > 0 && <Button size="compact" aria-pressed={allDayOpen} onClick={() => { const next = !allDayOpen; persistUiBoolean('calendar:all-day', next); setAllDayOpen(next); }}>{preferences.language === 'ru' ? 'Весь день' : 'All day'} · {allDayIds.size}</Button>}
      </div><Surface className="calendar-day-list">
        {overdueIds.size > 0 && timelineSettings.showOverdue !== false && <div className="calendar-overdue"><h2>{preferences.language === 'ru' ? 'Просрочено' : 'Overdue'} · {overdueIds.size}</h2><ViewResults view={selected.view} workspace={calendar.workspace} evaluation={selected.evaluation} hiddenItemIds={new Set(selected.evaluation.items.filter(item => !overdueIds.has(item.id)).map(item => item.id))} onEdit={openItem} onState={changeState} celebrationColors={celebrationColors} /></div>}
        {allDayIds.size > 0 && allDayOpen && <div className="calendar-all-day"><h2>{preferences.language === 'ru' ? 'Весь день' : 'All day'} · {allDayIds.size}</h2><ViewResults view={selected.view} workspace={calendar.workspace} evaluation={selected.evaluation} hiddenItemIds={new Set(selected.evaluation.items.filter(item => !allDayIds.has(item.id)).map(item => item.id))} onEdit={openItem} onState={changeState} celebrationColors={celebrationColors} /></div>}
        <ViewResults view={selected.view} workspace={calendar.workspace} evaluation={selected.evaluation} hiddenItemIds={new Set(selected.evaluation.items.filter(item => overdueIds.has(item.id) || allDayIds.has(item.id)).map(item => item.id))} onEdit={openItem} onState={changeState} celebrationColors={celebrationColors} />
        {timelineSettings.showUndated === true && undatedItems.length > 0 && <div className="calendar-no-date"><h2>{preferences.language === 'ru' ? 'Без даты' : 'No date'} · {undatedItems.length}</h2><ViewResults view={selected.view} workspace={workspace} evaluation={{ items: undatedItems, metrics: null, now }} onEdit={openItem} onState={changeState} celebrationColors={celebrationColors} /></div>}
      </Surface></>}
    <CalendarDayViewEditor open={editorOpen} workspace={workspace} onOpenChange={setEditorOpen} onSave={(dayView, timeline) => commit('Save calendar day view', (draft) => { draft.calendarPreferences.dayView = structuredClone(dayView); draft.calendarPreferences.timeline = structuredClone(timeline); })} />
  </section>;
}
