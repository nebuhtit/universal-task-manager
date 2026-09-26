import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  createOccurrence, effectiveWorkspaceNow, zonedDateStart,
  type ItemPreset, type ProjectedOccurrence, type UniversalItem, type WorkspaceDocument,
} from '@utm/core';
import { LineIcon } from '../../components/ui/icons';
import { persistUiBoolean, readUiBoolean } from '../../components/ui/PersistedDetails';
import { Button, IconButton, Surface } from '../../components/ui/primitives';
import { formatCompactRemainingDuration } from '../views/ViewMetricsSummary';
import { ViewResults } from '../views/ViewResults';
import { clockService } from '../../services/clockService';
import { completionHoldsSnapshot, sortViewItems, subscribeCompletionHolds } from '../views/viewSelectors';
import { useCalendarNow, useWorkspaceBoundaryNow } from '../views/useViewEvaluation';
import { CalendarDayViewEditor } from './CalendarDayViewEditor';
import { calendarListFields, calendarTimelineFields } from './calendarCardFields';
import { CalendarTimeline } from './CalendarTimeline';
import { calendarDayView, createCalendarEvaluator } from './calendarEvaluation';
import { calendarVisibleCapacity, createCalendarCapacityCache } from './calendarCapacity';
import { prepareTimelineData } from './timelineData';
import { buildCalendarPlan, calendarPlanMetricItems, calendarReorderIssue, createCalendarPlanCache, planningEnabled, planningReason } from './calendarPlanning';
import { ResponsiveDialog } from '../../components/ui/ResponsiveDialog';
import { calendarProjectionPadding } from './calendarProjectionCache';
import { MoonPhase } from './MoonPhase';
import { useCalendarPeriodSwipe } from './useCalendarPeriodSwipe';
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

export function CalendarPage({ workspace, now: suppliedNow, commit, onEditItem, onState, createUiItem, onCreateItem, celebrationColors = new Map(), requestedDate, initialDate, onSelectedDateChange, onPlanningNotice }: {
  workspace: WorkspaceDocument;
  now?: Date;
  commit: (message: string, mutation: (draft: WorkspaceDocument) => void) => boolean | void;
  onEditItem: (item: UniversalItem) => void;
  onCreateItem?: (item: UniversalItem) => void;
  onState: (item: UniversalItem, state: UniversalItem['state'], celebrationColor?: string) => void;
  createUiItem: (title?: string, preset?: ItemPreset, now?: Date) => UniversalItem;
  celebrationColors?: ReadonlyMap<string, string>;
  requestedDate?: { key: string; request: number };
  initialDate?: string;
  onSelectedDateChange?: (key: string) => void;
  onPlanningNotice?: (message: string) => void;
}) {
  const preferences = workspace.calendarPreferences;
  const navigationNow = useWorkspaceBoundaryNow(workspace, suppliedNow);
  const initialNow = suppliedNow ?? navigationNow;
  const [selectedDate, setSelectedDate] = useState(() => initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate) ? initialDate : localDateKey(initialNow, preferences.timezone));
  useEffect(() => { onSelectedDateChange?.(selectedDate); }, [selectedDate, onSelectedDateChange]);
  useEffect(() => { if (requestedDate) setSelectedDate(requestedDate.key); }, [requestedDate]);
  const [navigatorMode, setNavigatorMode] = useState<NavigatorMode>('week');
  const movePeriod = (direction: -1 | 1) => setSelectedDate(current => navigatorMode === 'week' ? shiftDateKey(current, direction * 7) : shiftMonth(current, direction));
  const periodSwipe = useCalendarPeriodSwipe(movePeriod);
  const [compactNavigator, setCompactNavigator] = useState(false);
  const calendarRoot = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLElement>(null);
  const navigatorStart = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const title = titleRef.current, root = calendarRoot.current, start = navigatorStart.current;
    if (!title || !root || !start) return;
    let frame = 0, pointerActive = false, releaseTimer = 0;
    const update = () => {
      frame = 0;
      root.style.setProperty('--calendar-title-height', `${title.getBoundingClientRect().height}px`);
      const top = parseFloat(getComputedStyle(title).top) + title.getBoundingClientRect().height;
      // Do not move a pressed card between pointerdown and click as the
      // navigator collapses after scrolling (especially on touch WebKit).
      // Hysteresis prevents subpixel/iOS rubber-band scroll from repeatedly
      // expanding and collapsing at the sticky boundary.
      if (!pointerActive) {
        const distance = start.getBoundingClientRect().top - top;
        setCompactNavigator(current => current ? distance < 4 : distance < -4);
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const pointerStart = () => { window.clearTimeout(releaseTimer); pointerActive = true; };
    const pointerEnd = () => { window.clearTimeout(releaseTimer); pointerActive = false; schedule(); };
    // WebKit can paint between pointerup and its synthesized click. Keep the
    // target still until click dispatch; a cancelled drag has no click to await.
    const pointerUp = () => { releaseTimer = window.setTimeout(pointerEnd, 350); };
    const observer = new ResizeObserver(schedule); observer.observe(title);
    window.addEventListener('scroll', schedule, { passive: true, capture: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('pointerdown', pointerStart, true);
    window.addEventListener('pointerup', pointerUp, true);
    window.addEventListener('click', pointerEnd, true);
    window.addEventListener('pointercancel', pointerEnd, true);
    update();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); window.clearTimeout(releaseTimer); window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); window.removeEventListener('pointerdown', pointerStart, true); window.removeEventListener('pointerup', pointerUp, true); window.removeEventListener('click', pointerEnd, true); window.removeEventListener('pointercancel', pointerEnd, true); };
  }, []);
  const [editorOpen, setEditorOpen] = useState(false);
  const [planningMessage, setPlanningMessage] = useState('');
  const repairedSignature = useRef('');
  const [resetStep, setResetStep] = useState(0);
  const pendingOrderFocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    const id = pendingOrderFocus.current;
    if (!id) return;
    pendingOrderFocus.current = null;
    const row = [...document.querySelectorAll<HTMLElement>('.calendar-page [data-view-item-id]')].find(node => node.dataset.viewItemId === id);
    const handle = row?.querySelector<HTMLButtonElement>('.view-drag-handle') ?? [...document.querySelectorAll<HTMLButtonElement>('.calendar-page [data-calendar-handle-id]')].find(node => node.dataset.calendarHandleId === id);
    handle?.focus({ preventScroll: true });
  }, [workspace]);
  useEffect(() => { setResetStep(0); setPlanningMessage(''); }, [selectedDate]);
  const [allDayOpen, setAllDayOpen] = useState(() => readUiBoolean('calendar:all-day', true));
  const dayPanelRef = useRef<HTMLDivElement>(null);
  const todayChoiceRef = useRef<HTMLButtonElement>(null);
  const completionVersion = useSyncExternalStore(subscribeCompletionHolds, completionHoldsSnapshot, completionHoldsSnapshot);
  const selectedDayView = useMemo(() => ({ ...calendarDayView(selectedDate, preferences.dayView), fields: [...new Set([...calendarListFields(preferences.dayView), ...calendarTimelineFields(preferences.dayView)])] }), [selectedDate, preferences.dayView]);
  const evaluator = useMemo(() => createCalendarEvaluator(), []);
  const capacityCache = useMemo(() => createCalendarCapacityCache(), []);
  const planCache = useMemo(() => createCalendarPlanCache(), []);
  const createAt = (at: number) => {
    const draft = createUiItem('', 'task', suppliedNow ?? new Date());
    draft.schedule = { timezone: preferences.timezone, startAt: new Date(at).toISOString(), endAt: new Date(at + 3_600_000).toISOString(), estimatedDuration: 'PT1H' };
    onCreateItem?.(draft);
  };
  const capacityClock = useSyncExternalStore(subscribeCapacityClock, clockService.getSnapshot, clockService.getSnapshot);
  const capacityNow = suppliedNow ?? effectiveWorkspaceNow(workspace, new Date(capacityClock));
  const todayKey = localDateKey(suppliedNow ?? navigationNow, preferences.timezone);
  const selectedWeekStart = weekStart(selectedDate, preferences.weekStartsOn);
  const rangeStartKey = navigatorMode === 'week' ? selectedWeekStart : weekStart(monthStart(selectedDate), preferences.weekStartsOn);
  const rangeEndKey = navigatorMode === 'week' ? shiftDateKey(rangeStartKey, 7) : shiftDateKey(weekStart(shiftDateKey(nextMonthStart(selectedDate), -1), preferences.weekStartsOn), 7);
  const projectedBoundaries = useMemo(() => {
    const { padding } = calendarProjectionPadding(Object.values(evaluator.projections.workspaceFor(workspace).items));
    const rows = [
      ...evaluator.projections.project(workspace, zonedDateStart(rangeStartKey, preferences.timezone), zonedDateStart(rangeEndKey, preferences.timezone)),
      ...evaluator.projections.project(workspace, new Date(+zonedDateStart(selectedDate, preferences.timezone) - padding), new Date(+zonedDateStart(shiftDateKey(selectedDate, 1), preferences.timezone) + padding)),
    ];
    return rows.flatMap(row => [row.schedule.availableFrom, row.schedule.startAt, row.schedule.endAt, row.schedule.dueAt]).map(value => Date.parse(value ?? '')).filter(Number.isFinite);
  }, [evaluator, workspace, rangeStartKey, rangeEndKey, selectedDate, preferences.timezone]);
  const now = useCalendarNow(workspace, selectedDayView, projectedBoundaries, suppliedNow);

  const dayKeys = useMemo(() => {
    const keys: string[] = [];
    for (let key = rangeStartKey; key < rangeEndKey; key = shiftDateKey(key, 1)) keys.push(key);
    return keys;
  }, [rangeStartKey, rangeEndKey]);
  const calendar = useMemo(() => evaluator.evaluate(workspace, rangeStartKey, rangeEndKey, preferences.dayView, now), [evaluator, completionVersion, workspace, rangeStartKey, rangeEndKey, preferences.dayView, now.getTime()]);
  const dayData = calendar.days;
  const planning = planningEnabled(workspace);
  const preparedDays = useMemo(() => planning ? Object.fromEntries(dayKeys.map(key => [key, prepareTimelineData(workspace, key, now, evaluator.projections)])) : null, [planning, workspace, dayKeys, now.getTime(), evaluator]);
  const plans = useMemo(() => preparedDays ? Object.fromEntries(dayKeys.map(key => [key, planCache(workspace, key, preparedDays[key]!, capacityNow, dayData[key]!.reservedItems)])) : null, [planCache, preparedDays, workspace, dayKeys, capacityNow.getTime(), dayData]);
  const plan = plans?.[selectedDate];
  useEffect(() => {
    if (!plan?.repairedOrder) return;
    const old = workspace.calendarPreferences.planning?.orders?.[selectedDate];
    const signature = JSON.stringify([selectedDate, old, plan.repairedOrder]);
    if (repairedSignature.current === signature) return;
    repairedSignature.current = signature;
    const result = commit('Repair calendar day order', draft => {
      if (JSON.stringify(draft.calendarPreferences.planning?.orders?.[selectedDate]) !== JSON.stringify(old)) return;
      draft.calendarPreferences.planning!.orders![selectedDate] = [...plan.repairedOrder!];
    });
    if (result !== false) onPlanningNotice?.(preferences.language === 'ru' ? 'Порядок дня исправлен: задачи перенесены перед событиями, мешавшими успеть до Due.' : 'Day order repaired: tasks moved before events that blocked their Due.');
  }, [plan, selectedDate, workspace, commit, onPlanningNotice, preferences.language]);
  const originalSelected = dayData[selectedDate]!;
  const selected = plan ? { ...originalSelected, evaluation: { metrics: originalSelected.evaluation.metrics, now: originalSelected.evaluation.now, items: [...plan.items, ...originalSelected.evaluation.items.filter(item => !plan.ids.includes(item.id))] } } : originalSelected;
  const reorder = (ids: string[], movedId: string) => {
    if (!plan || !preparedDays) return;
    const next = buildCalendarPlan(workspace, selectedDate, preparedDays[selectedDate]!, capacityNow, originalSelected.reservedItems, ids);
    const issue = calendarReorderIssue(plan, next, movedId, capacityNow, preferences.timezone, preferences.timeline?.mode !== 'timeline');
    if (issue) { const message = `${issue.item.title}: ${planningReason(issue.reason, preferences.language === 'ru')}`; setPlanningMessage(message); onPlanningNotice?.(message); return; }
    setPlanningMessage('');
    pendingOrderFocus.current = movedId;
    commit('Calendar day order', draft => { draft.calendarPreferences.planning ??= {}; draft.calendarPreferences.planning.orders ??= {}; draft.calendarPreferences.planning.orders[selectedDate] = [...ids]; });
  };
  const orderProps = { onReorder: plan ? reorder : undefined, reorderIds: plan?.ids, movableIds: plan ? new Set([...plan.movable, ...plan.fixed.keys()]) : undefined, referenceIds: plan ? new Set(plan.pins.keys()) : undefined };
  const listView = { ...selected.view, fields: calendarListFields(preferences.dayView) };
  const overdueIds = new Set(selected.evaluation.items.filter(item => showOverdueToday(item, selectedDate, now, preferences.timezone, item.occurrence ? workspace.items[item.occurrence.seriesId] : undefined)).map(item => item.id));
  const allDayIds = new Set(selected.evaluation.items.filter(item => item.schedule?.allDay && !overdueIds.has(item.id)).map(item => item.id));
  const selectedIds = new Set(selected.evaluation.items.map(item => item.id));
  const allUndatedItems = useMemo(() => calendarUndatedItems(workspace, now), [workspace, now.getTime()]);
  const unsortedUndatedItems = sortViewItems(workspace, selected.view, allUndatedItems.filter(item => !selectedIds.has(item.id) || (plan?.movable.has(item.id) && !plan.pins.has(item.id))), now);
  const undatedItems = plan ? [...unsortedUndatedItems].sort((a, b) => plan.ids.indexOf(a.id) - plan.ids.indexOf(b.id)) : unsortedUndatedItems;
  const undatedIds = new Set(undatedItems.map(item => item.id));
  const manuallyOrdered = Boolean(plan && preferences.planning?.orders?.[selectedDate]?.length);
  const categoryLabels = new Map(selected.evaluation.items.flatMap(item => {
    const label = overdueIds.has(item.id) ? (preferences.language === 'ru' ? 'Просрочено' : 'Overdue') : allDayIds.has(item.id) ? (preferences.language === 'ru' ? 'Весь день' : 'All day') : undatedIds.has(item.id) ? (preferences.language === 'ru' ? 'Без даты' : 'No date') : '';
    return label ? [[item.id, label] as const] : [];
  }));
  const capacities = useMemo(() => Object.fromEntries(dayKeys.map(key => {
    const day = dayData[key]!, dayPlan = plans?.[key];
    return [key, dayPlan ? calendarVisibleCapacity(workspace, { ...day, evaluation: { ...day.evaluation, items: calendarPlanMetricItems(dayPlan, day.evaluation.items) } }, key, capacityNow, allUndatedItems.filter(item => !dayPlan.ids.includes(item.id)), allDayOpen) : capacityCache.calculate(workspace, day, key, capacityNow, allUndatedItems, allDayOpen)];
  })), [plans, capacityCache, workspace, dayData, dayKeys, capacityNow.getTime(), allUndatedItems, allDayOpen]);
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
  const weekdayOffset = navigatorMode === 'month' ? (dateFromKey(monthStart(selectedDate)).getUTCDay() - preferences.weekStartsOn + 7) % 7 : 0;
  const showWeek = navigatorMode === 'week' || compactNavigator;
  const visibleDayKeys = dayKeys.filter(key => showWeek ? key >= selectedWeekStart && key < shiftDateKey(selectedWeekStart, 7) : key.slice(0, 7) === selectedDate.slice(0, 7));
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

  return <section className={`calendar-page page-section${compactNavigator ? ' is-compact' : ''}`} ref={calendarRoot}>
    <header className="calendar-title" ref={titleRef} inert={compactNavigator}>
      <div><div className="calendar-heading-date"><h1>{selectedLabel}</h1><MoonPhase dateKey={selectedDate} zone={preferences.timezone} ru={preferences.language === 'ru'} /></div>{selected.view.statistics?.showTime !== false && <span className="view-metrics-summary" data-testid="calendar-header-capacity">{capacityLabel(selectedDate)}</span>}</div>
      <IconButton size="compact" variant="ghost" onClick={() => setEditorOpen(true)} aria-label="Edit calendar day view"><LineIcon name="settings" /></IconButton>
    </header>

    <div ref={navigatorStart} className="calendar-navigator-start" aria-hidden="true" />
    <Surface className={`calendar-navigator${compactNavigator ? ' is-compact' : ''}`}>
      <div className="calendar-navigator-toolbar" hidden={compactNavigator}>
        <div className="calendar-period-switch" aria-label="Calendar navigation mode">
          {(['week', 'month'] as const).map((mode) => <Button size="compact" variant="ghost" aria-pressed={navigatorMode === mode} className={navigatorMode === mode ? 'active' : ''} key={mode} onClick={() => setNavigatorMode(mode)}>{mode === 'week' ? 'Week' : 'Month'}</Button>)}
        </div>
        <div className="calendar-period-actions">
          {selectedDate !== todayKey && <Button size="compact" variant="ghost" onClick={() => setSelectedDate(todayKey)}>Today</Button>}
          <IconButton size="compact" variant="ghost" aria-label="Previous period" onClick={() => movePeriod(-1)}>‹</IconButton>
          <IconButton size="compact" variant="ghost" aria-label="Next period" onClick={() => movePeriod(1)}>›</IconButton>
        </div>
      </div>
      <div className={`calendar-day-panel is-${showWeek ? 'week' : 'month'}`} ref={dayPanelRef} {...periodSwipe}>
        {!showWeek && Array.from({ length: 7 }, (_, index) => <span className="calendar-weekday-label" key={index}>{formatDate(shiftDateKey(labelWeek, index), { weekday: 'short' })}</span>)}
        {!showWeek && Array.from({ length: weekdayOffset }, (_, index) => <span className="calendar-day-spacer" key={index} />)}
        {visibleDayKeys.map((key) => <button type="button" data-date={key} ref={key === todayKey ? todayChoiceRef : undefined} className={`calendar-day-choice${key === selectedDate ? ' selected' : ''}${key === todayKey ? ' today' : ''}`} aria-pressed={key === selectedDate} aria-current={key === todayKey ? 'date' : undefined} onClick={() => setSelectedDate(key)} key={key}>
          <span className="calendar-day-label"><b>{showWeek ? formatDate(key, { weekday: 'short' }) : Number(key.slice(-2))}</b>{showWeek && <small>{formatDate(key, { day: 'numeric', month: 'short' })}</small>}</span>
          {dayData[key]!.view.statistics?.showTime !== false && <span className="view-metrics-summary" aria-label={capacityLabel(key)}>{capacityLabel(key, true)}{capacities[key]!.hiddenReservedMs > 0 ? ' *' : ''}</span>}
        </button>)}
      </div>
    </Surface>

    <div className="calendar-display-switch" role="group" aria-label="Calendar display mode">
      <Button size="compact" aria-pressed={preferences.timeline?.mode !== 'timeline'} onClick={() => commit('Calendar list mode', draft => { draft.calendarPreferences.timeline = { ...preferences.timeline, mode: 'list', hideSleep: preferences.timeline?.hideSleep ?? false }; })}>{preferences.language === 'ru' ? 'Список' : 'List'}</Button>
      <Button size="compact" aria-pressed={preferences.timeline?.mode === 'timeline'} onClick={() => commit('Calendar timeline mode', draft => { draft.calendarPreferences.timeline = { ...preferences.timeline, mode: 'timeline', hideSleep: preferences.timeline?.hideSleep ?? false }; })}>Timeline</Button>
    </div>
    {preferences.timeline?.mode === 'timeline'
      ? <CalendarTimeline listItems={selected.evaluation.items} plan={plan} onReorder={plan ? reorder : undefined} onCreateAt={createAt} planningNow={capacityNow} projectionCache={evaluator.projections} workspace={workspace} dateKey={selectedDate} now={now} suppliedNow={suppliedNow} capacityLabel={capacityLabel(selectedDate)} reservedItems={selected.reservedItems.filter(item => !selected.evaluation.items.some(visible => (visible.occurrence?.seriesId ?? visible.id) === (item.occurrence?.seriesId ?? item.id)))} allDayOpen={allDayOpen} onAllDayChange={setAllDayOpen} onEdit={openItem} onState={changeState} onPreferences={settings => commit('Timeline preferences', draft => { draft.calendarPreferences.timeline = settings; })} onSwipeDay={direction => setSelectedDate(current => shiftDateKey(current, direction))} />
      : <><div className="timeline-toolbar calendar-list-toolbar">
        {overdueIds.size > 0 && <Button size="compact" aria-pressed={timelineSettings.showOverdue !== false} onClick={() => setTimelineSetting({ showOverdue: timelineSettings.showOverdue === false })}>{preferences.language === 'ru' ? 'Просрочено' : 'Overdue'} · {overdueIds.size}</Button>}
        <Button size="compact" aria-pressed={timelineSettings.showUndated === true} onClick={() => setTimelineSetting({ showUndated: timelineSettings.showUndated !== true })}>{preferences.language === 'ru' ? 'Без даты' : 'No date'}{undatedItems.length ? ` · ${undatedItems.length}` : ''}</Button>
        {allDayIds.size > 0 && <Button size="compact" aria-pressed={allDayOpen} onClick={() => { const next = !allDayOpen; persistUiBoolean('calendar:all-day', next); setAllDayOpen(next); }}>{preferences.language === 'ru' ? 'Весь день' : 'All day'} · {allDayIds.size}</Button>}
      </div><Surface className="calendar-day-list">
        {manuallyOrdered ? <ViewResults {...orderProps} itemLabels={categoryLabels} view={listView} calendarTimeOnly workspace={calendar.workspace} evaluation={selected.evaluation} hiddenItemIds={new Set(selected.evaluation.items.filter(item => !plan?.pins.has(item.id) && ((overdueIds.has(item.id) && timelineSettings.showOverdue === false) || (allDayIds.has(item.id) && !allDayOpen) || (undatedIds.has(item.id) && timelineSettings.showUndated !== true))).map(item => item.id))} onEdit={openItem} onState={changeState} celebrationColors={celebrationColors} /> : <>
        {overdueIds.size > 0 && timelineSettings.showOverdue !== false && <div className="calendar-overdue"><h2>{preferences.language === 'ru' ? 'Просрочено' : 'Overdue'} · {overdueIds.size}</h2><ViewResults {...orderProps} view={listView} calendarTimeOnly workspace={calendar.workspace} evaluation={selected.evaluation} hiddenItemIds={new Set(selected.evaluation.items.filter(item => !overdueIds.has(item.id)).map(item => item.id))} onEdit={openItem} onState={changeState} celebrationColors={celebrationColors} /></div>}
        {allDayIds.size > 0 && allDayOpen && <div className="calendar-all-day"><h2>{preferences.language === 'ru' ? 'Весь день' : 'All day'} · {allDayIds.size}</h2><ViewResults {...orderProps} view={listView} calendarTimeOnly workspace={calendar.workspace} evaluation={selected.evaluation} hiddenItemIds={new Set(selected.evaluation.items.filter(item => !allDayIds.has(item.id)).map(item => item.id))} onEdit={openItem} onState={changeState} celebrationColors={celebrationColors} /></div>}
        <ViewResults {...orderProps} view={listView} calendarTimeOnly workspace={calendar.workspace} evaluation={selected.evaluation} hiddenItemIds={new Set(selected.evaluation.items.filter(item => overdueIds.has(item.id) || allDayIds.has(item.id) || undatedIds.has(item.id)).map(item => item.id))} onEdit={openItem} onState={changeState} celebrationColors={celebrationColors} />
        {timelineSettings.showUndated === true && undatedItems.length > 0 && <div className="calendar-no-date"><h2>{preferences.language === 'ru' ? 'Без даты' : 'No date'} · {undatedItems.length}</h2><ViewResults {...orderProps} view={listView} calendarTimeOnly workspace={workspace} evaluation={{ items: undatedItems, metrics: null, now }} onEdit={openItem} onState={changeState} celebrationColors={celebrationColors} /></div>}
      </>}</Surface></>}
    {planning && <Button size="compact" onClick={() => setResetStep(1)} disabled={!preferences.planning?.orders?.[selectedDate]?.length}>{preferences.language === 'ru' ? 'Сбросить порядок дня' : 'Reset day order'}</Button>}
    {planningMessage && <p role="status">{planningMessage}</p>}
    <ResponsiveDialog open={resetStep > 0} onOpenChange={open => { if (!open) setResetStep(0); }} title={preferences.language === 'ru' ? 'Сброс порядка' : 'Reset order'} ariaLabel="Reset calendar order">
      <p>{resetStep === 1 ? (preferences.language === 'ru' ? 'Вернуть исходную сортировку? Закрепления и items останутся без изменений.' : 'Restore the initial sorting? Pins and items will not change.') : `${preferences.language === 'ru' ? 'Подтвердите сброс порядка только для' : 'Confirm resetting order only for'} ${selectedLabel} (${selectedDate}).`}</p>
      <Button onClick={() => { if (resetStep === 1) setResetStep(2); else { commit('Reset calendar day order', draft => { if (draft.calendarPreferences.planning?.orders) delete draft.calendarPreferences.planning.orders[selectedDate]; }); setResetStep(0); } }}>{resetStep === 1 ? (preferences.language === 'ru' ? 'Продолжить' : 'Continue') : (preferences.language === 'ru' ? 'Подтвердить сброс' : 'Confirm reset')}</Button>
      <Button onClick={() => setResetStep(0)}>{preferences.language === 'ru' ? 'Отмена' : 'Cancel'}</Button>
    </ResponsiveDialog>
    <CalendarDayViewEditor open={editorOpen} workspace={workspace} onOpenChange={setEditorOpen} onSave={(dayView, timeline) => commit('Save calendar day view', (draft) => { draft.calendarPreferences.dayView = structuredClone(dayView); draft.calendarPreferences.timeline = structuredClone(timeline); })} />
  </section>;
}
