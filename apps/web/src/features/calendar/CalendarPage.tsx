import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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
import { completionHoldsSnapshot, hasCompletionHolds, sortViewItems, subscribeCompletionHolds } from '../views/viewSelectors';
import { useCalendarNow, useWorkspaceBoundaryNow } from '../views/useViewEvaluation';
import { createCalendarPageCache, type CalendarPageCache } from './calendarPageCache';
import { calendarListFields, calendarTimelineFields } from './calendarCardFields';
import { CalendarTimeline } from './CalendarTimeline';
import { calendarDayView } from './calendarEvaluation';
import { buildCalendarPlan, calendarListOrder, calendarReorderIssue, planningEnabled, planningReason } from './calendarPlanning';
import { ResponsiveDialog } from '../../components/ui/ResponsiveDialog';
import { prepareCalendarProjectionBoundaries } from './calendarProjectionCache';
import { DayWeather } from '../weather/DayWeather';
import { MoonPhase } from './MoonPhase';
import { useCalendarPeriodSwipe } from './useCalendarPeriodSwipe';
import { useCalendarSwipeMotion } from './useCalendarSwipeMotion';
import { CalendarSwipePages, type CalendarSwipePage } from './CalendarSwipePages';
import { useCalendarAdjacentSlides } from './useCalendarAdjacentSlides';
import { createCalendarSlidesRunner } from './calendarSlidesWorker';
import { showOverdueToday } from './calendarVisibility';
import { recordDiagnostic } from '../../services/diagnostics';
import { labelProfileAction, recordProfileCommit } from '../../services/performanceProfile';
import './calendar.css';

const DAY_MS = 86_400_000;
const CalendarDayViewEditor = lazy(() => import('./CalendarDayViewEditor').then(module => ({ default: module.CalendarDayViewEditor })));
const subscribeCapacityClock = (listener: () => void) => clockService.subscribe(listener, 60_000);
const capacityClockSnapshot = () => Math.floor(clockService.getSnapshot() / 60_000);
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

export function CalendarPage({ workspace, computationCache, now: suppliedNow, commit, onEditItem, onState, createUiItem, onCreateItem, celebrationColors = new Map(), requestedDate, initialDate, onSelectedDateChange, onPlanningNotice }: {
  workspace: WorkspaceDocument;
  computationCache?: { current: CalendarPageCache | null };
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
  const periodMotion = useCalendarSwipeMotion(`${navigatorMode}:${navigatorMode === 'week' ? weekStart(selectedDate, preferences.weekStartsOn) : selectedDate.slice(0, 7)}`);
  const dayMotion = useCalendarSwipeMotion(selectedDate);
  const movePeriod = (direction: -1 | 1) => periodMotion.navigate(direction, () => setSelectedDate(current => navigatorMode === 'week' ? shiftDateKey(current, direction * 7) : shiftMonth(current, direction)));
  const periodSwipe = useCalendarPeriodSwipe(movePeriod, periodMotion);
  const [compactNavigator, setCompactNavigator] = useState(true);
  const [timelineToolbarHost, setTimelineToolbarHost] = useState<HTMLDivElement | null>(null);
  const calendarRoot = useRef<HTMLElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const navigationScrollTarget = (collapsed: boolean) => {
    const root = calendarRoot.current, controls = controlsRef.current;
    if (!root || !controls) return window.scrollY;
    const topbar = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
    return Math.max(0, window.scrollY + (collapsed ? controls.getBoundingClientRect().bottom : root.getBoundingClientRect().top) - topbar);
  };
  useLayoutEffect(() => {
    const root = calendarRoot.current;
    if (!root) return;
    const controls = controlsRef.current;
    const measure = () => root.style.setProperty('--calendar-controls-height', `${controls?.getBoundingClientRect().height ?? 0}px`);
    measure();
    const observer = controls ? new ResizeObserver(measure) : undefined;
    if (controls) observer?.observe(controls);
    // Keep layout constant. The browser moves the controls with the finger;
    // only the week strip sticks. Never resize the header in a scroll handler.
    const scroll = () => {
      const topbar = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
      const bounds = controlsRef.current?.getBoundingClientRect();
      const reveal = bounds ? Math.max(0, Math.min(1, (bounds.bottom - topbar) / Math.max(1, bounds.height))) : 0;
      root.style.setProperty('--calendar-reveal', String(reveal));
      setCompactNavigator(reveal <= 0.01);
    };
    window.scrollTo({ top: navigationScrollTarget(true), behavior: 'instant' });
    scroll();
    window.addEventListener('scroll', scroll, { passive: true });
    return () => { observer?.disconnect(); window.removeEventListener('scroll', scroll); };
  }, []);
  const [editorOpen, setEditorOpen] = useState(false);
  const [planningMessage, setPlanningMessage] = useState('');
  const repairedSignature = useRef('');
  const [resetStep, setResetStep] = useState(0);
  // Presentation only: never feed this temporary order into planning or storage.
  const [listOrders, setListOrders] = useState<Record<string, string[]>>({});
  useEffect(() => { setListOrders({}); }, [workspace.workspaceId]);
  const pendingOrderFocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    const id = pendingOrderFocus.current;
    if (!id) return;
    pendingOrderFocus.current = null;
    const row = [...document.querySelectorAll<HTMLElement>('.calendar-page [data-view-item-id]')].find(node => node.dataset.viewItemId === id);
    const handle = row?.querySelector<HTMLButtonElement>('.view-drag-handle') ?? [...document.querySelectorAll<HTMLButtonElement>('.calendar-page [data-calendar-handle-id]')].find(node => node.dataset.calendarHandleId === id);
    (handle ?? row?.querySelector<HTMLElement>('.item-main'))?.focus({ preventScroll: true });
  }, [workspace, listOrders]);
  useEffect(() => { setResetStep(0); setPlanningMessage(''); }, [selectedDate]);
  const [allDayOpen, setAllDayOpen] = useState(() => readUiBoolean('calendar:all-day', true));
  const dayPanelRef = useRef<HTMLDivElement>(null);
  const todayChoiceRef = useRef<HTMLButtonElement>(null);
  const completionVersion = useSyncExternalStore(subscribeCompletionHolds, completionHoldsSnapshot, completionHoldsSnapshot);
  const selectedDayView = useMemo(() => ({ ...calendarDayView(selectedDate, preferences.dayView), fields: [...new Set([...calendarListFields(preferences.dayView), ...calendarTimelineFields(preferences.dayView)])] }), [selectedDate, preferences.dayView]);
  const calculations = useMemo(() => {
    if (computationCache?.current?.workspaceId === workspace.workspaceId) return computationCache.current;
    const cache = createCalendarPageCache(workspace.workspaceId);
    if (computationCache) computationCache.current = cache;
    return cache;
  }, [workspace.workspaceId, computationCache]);
  const { evaluator } = calculations;
  const createAt = (at: number) => {
    const draft = createUiItem('', 'task', suppliedNow ?? new Date());
    draft.schedule = { timezone: preferences.timezone, startAt: new Date(at).toISOString(), endAt: new Date(at + 3_600_000).toISOString(), estimatedDuration: 'PT1H' };
    onCreateItem?.(draft);
  };
  const capacityClock = useSyncExternalStore(subscribeCapacityClock, capacityClockSnapshot, capacityClockSnapshot);
  // Optional idle-render commits must not resample this minute clock and
  // invalidate/restart their own preparation on every unrelated second tick.
  const capacityNow = useMemo(() => suppliedNow ?? effectiveWorkspaceNow(workspace, new Date(clockService.getSnapshot())), [workspace, suppliedNow, capacityClock]);
  const todayKey = localDateKey(suppliedNow ?? navigationNow, preferences.timezone);
  const selectedWeekStart = weekStart(selectedDate, preferences.weekStartsOn);
  const rangeStartKey = navigatorMode === 'week' ? selectedWeekStart : weekStart(monthStart(selectedDate), preferences.weekStartsOn);
  const rangeEndKey = navigatorMode === 'week' ? shiftDateKey(rangeStartKey, 7) : shiftDateKey(weekStart(shiftDateKey(nextMonthStart(selectedDate), -1), preferences.weekStartsOn), 7);
  const projectedBoundaries = useMemo(() => {
    const prepared = calculations.peekProjectionBoundaries(workspace, rangeStartKey, rangeEndKey, selectedDate);
    if (prepared) return prepared;
    const startedAt = performance.now();
    const boundaries = prepareCalendarProjectionBoundaries(evaluator.projections, workspace, rangeStartKey, rangeEndKey, [selectedDate]);
    const result = [...boundaries.period, ...boundaries.days[selectedDate]!];
    if (performance.now() - startedAt >= 100) recordDiagnostic({ kind: 'result', message: 'Calendar projection boundaries calculated', operation: 'Calendar internal projection', outcome: 'succeeded', durationMs: Math.round(performance.now() - startedAt), details: JSON.stringify({ boundaries: result.length }) });
    return result;
  }, [calculations, evaluator, workspace, rangeStartKey, rangeEndKey, selectedDate, preferences.timezone]);
  const now = useCalendarNow(workspace, selectedDayView, projectedBoundaries, suppliedNow);

  const dayKeys = useMemo(() => {
    const keys: string[] = [];
    for (let key = rangeStartKey; key < rangeEndKey; key = shiftDateKey(key, 1)) keys.push(key);
    return keys;
  }, [rangeStartKey, rangeEndKey]);
  const range = useMemo(() => {
    const startedAt = performance.now();
    const result = calculations.rangeFor(workspace, rangeStartKey, rangeEndKey, now, capacityNow, allDayOpen);
    if (performance.now() - startedAt >= 100) recordDiagnostic({ kind: 'result', message: 'Calendar evaluation completed', operation: 'Calendar internal evaluation', outcome: 'succeeded', durationMs: Math.round(performance.now() - startedAt), details: JSON.stringify({ days: Object.keys(result.calendar.days).length, items: Object.values(result.calendar.days).reduce((sum, day) => sum + day.evaluation.items.length, 0) }) });
    return result;
  }, [calculations, completionVersion, workspace, rangeStartKey, rangeEndKey, now.getTime(), capacityNow.getTime(), allDayOpen]);
  const { calendar, preparedDays, plans, capacities } = range;
  const dayData = calendar.days;
  const planning = planningEnabled(workspace);
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
  const selected = plan ? { ...originalSelected, evaluation: { metrics: originalSelected.evaluation.metrics, now: originalSelected.evaluation.now, items: [...plan.items, ...originalSelected.evaluation.items.filter(item => !plan.ids.includes(item.id))] } } : { ...originalSelected, evaluation: { ...originalSelected.evaluation, items: calendarListOrder(originalSelected.evaluation.items, preferences.planning?.orders?.[selectedDate]) } };
  const reorder = (ids: string[], movedId: string) => {
    if (plan && preparedDays && plan.ids.includes(movedId)) {
      const next = buildCalendarPlan(workspace, selectedDate, preparedDays[selectedDate]!, capacityNow, originalSelected.reservedItems, ids);
      const issue = calendarReorderIssue(plan, next, movedId, capacityNow, preferences.timezone, preferences.timeline?.mode !== 'timeline');
      if (issue) { const message = `${issue.item.title}: ${planningReason(issue.reason, preferences.language === 'ru')}`; setPlanningMessage(message); onPlanningNotice?.(message); return; }
    }
    setPlanningMessage('');
    pendingOrderFocus.current = movedId;
    commit('Calendar day order', draft => { draft.calendarPreferences.planning ??= {}; draft.calendarPreferences.planning.orders ??= {}; draft.calendarPreferences.planning.orders[selectedDate] = [...ids]; });
  };
  const listView = { ...selected.view, fields: calendarListFields(preferences.dayView) };
  const overdueIds = new Set(selected.evaluation.items.filter(item => showOverdueToday(item, selectedDate, now, preferences.timezone, item.occurrence ? workspace.items[item.occurrence.seriesId] : undefined)).map(item => item.id));
  const allDayIds = new Set(selected.evaluation.items.filter(item => item.schedule?.allDay && !overdueIds.has(item.id)).map(item => item.id));
  const selectedIds = new Set(selected.evaluation.items.map(item => item.id));
  const allUndatedItems = range.undated;
  const unsortedUndatedItems = calendarListOrder(sortViewItems(workspace, selected.view, allUndatedItems.filter(item => !selectedIds.has(item.id) || (plan?.movable.has(item.id) && !plan.pins.has(item.id))), now), preferences.planning?.orders?.[selectedDate]);
  const undatedItems = plan ? [...unsortedUndatedItems].sort((a, b) => plan.ids.indexOf(a.id) - plan.ids.indexOf(b.id)) : unsortedUndatedItems;
  const undatedIds = new Set(undatedItems.map(item => item.id));
  const temporaryOrder = listOrders[selectedDate];
  const listItems = [...new Map([...selected.evaluation.items, ...undatedItems].map(item => [item.id, item])).values()];
  const listEvaluation = temporaryOrder ? { ...selected.evaluation, items: calendarListOrder(listItems, temporaryOrder) } : selected.evaluation;
  const orderProps = { onReorder: (ids: string[], movedId: string) => {
    pendingOrderFocus.current = movedId;
    setListOrders(current => ({ ...current, [selectedDate]: [...ids] }));
  }, reorderIds: calendarListOrder(listItems, temporaryOrder).map(item => item.id), referenceIds: plan ? new Set(plan.pins.keys()) : undefined };
  const manuallyOrdered = Boolean(temporaryOrder || (plan && preferences.planning?.orders?.[selectedDate]?.length));
  const categoryLabels = new Map(listItems.flatMap(item => {
    const label = overdueIds.has(item.id) ? (preferences.language === 'ru' ? 'Просрочено' : 'Overdue') : allDayIds.has(item.id) ? (preferences.language === 'ru' ? 'Весь день' : 'All day') : undatedIds.has(item.id) ? (preferences.language === 'ru' ? 'Без даты' : 'No date') : '';
    return label ? [[item.id, label] as const] : [];
  }));
  const capacityLabel = (key: string, compact = false, values = capacities) => {
    const result = values[key]!;
    const amount = formatCompactRemainingDuration(Math.abs(result.freeMs), preferences.language) || '0min';
    const reserve = result.hiddenReservedMs > 0 ? ` · ${preferences.language === 'ru' ? 'скрытый резерв' : 'hidden reserve'} ${formatCompactRemainingDuration(result.hiddenReservedMs, preferences.language)}` : '';
    return `${result.freeMs < 0 ? (preferences.language === 'ru' ? 'Перегрузка' : 'Over capacity') : (preferences.language === 'ru' ? 'Свободно' : 'Free')} ${amount}${compact ? '' : reserve}`;
  };
  const timelineSettings = preferences.timeline ?? { mode: 'list' as const, hideSleep: false };
  const [displayMode, setDisplayMode] = useState<'list' | 'timeline'>(() => {
    const saved = readUiBoolean('calendar:display-timeline', preferences.timeline?.mode === 'timeline');
    return saved ? 'timeline' : 'list';
  });
  useLayoutEffect(() => recordProfileCommit('calendar'));
  const displayModeStartedAt = useRef<number | null>(null);
  useEffect(() => {
    const startedAt = displayModeStartedAt.current;
    if (startedAt === null) return;
    displayModeStartedAt.current = null;
    recordDiagnostic({ kind: 'result', message: `Calendar ${displayMode} mode committed`, operation: 'Calendar display mode UI', outcome: 'succeeded', durationMs: Math.round(performance.now() - startedAt), details: JSON.stringify({ mode: displayMode, items: selected.evaluation.items.length }) });
  }, [displayMode, selected.evaluation.items.length]);
  const changeDisplayMode = (mode: 'list' | 'timeline') => {
    if (mode === displayMode) return;
    labelProfileAction(mode === 'list' ? 'calendar-list' : 'calendar-timeline');
    displayModeStartedAt.current = performance.now();
    recordDiagnostic({ kind: 'action', message: `Calendar ${mode} mode requested`, operation: 'Calendar display mode UI', outcome: 'started', details: JSON.stringify({ from: displayMode, items: selected.evaluation.items.length }) });
    setDisplayMode(mode);
    persistUiBoolean('calendar:display-timeline', mode === 'timeline');
  };
  const setTimelineSetting = (changes: Partial<typeof timelineSettings>) => commit('Calendar visibility', draft => { draft.calendarPreferences.timeline = { ...draft.calendarPreferences.timeline, mode: 'list', hideSleep: draft.calendarPreferences.timeline?.hideSleep ?? false, ...changes }; });
  const rowsById = new Map(selected.entries.map(({ row, item }) => [item.id, row]));
  const formatDate = (key: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(preferences.language, { ...options, timeZone: 'UTC' }).format(dateFromKey(key));
  const selectedLabel = formatDate(selectedDate, { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
  const weekdayOffset = navigatorMode === 'month' ? (dateFromKey(monthStart(selectedDate)).getUTCDay() - preferences.weekStartsOn + 7) % 7 : 0;
  const showWeek = navigatorMode === 'week';
  const visibleDayKeys = dayKeys.filter(key => showWeek ? key >= selectedWeekStart && key < shiftDateKey(selectedWeekStart, 7) : key.slice(0, 7) === selectedDate.slice(0, 7));
  const labelWeek = weekStart('2026-08-31', preferences.weekStartsOn);
  const adjacentIdentity = useMemo(() => ({}), [workspace, selectedDate, navigatorMode, displayMode, now.getTime(), capacityNow.getTime(), completionVersion, allDayOpen]);
  const selectedPrepared = displayMode === 'timeline' ? preparedDays?.[selectedDate] ?? calculations.timelineFor(workspace, selectedDate, now) : undefined;
  const slideRunner = useMemo(() => createCalendarSlidesRunner(), []);
  useEffect(() => () => slideRunner.dispose(), [slideRunner]);
  useCalendarAdjacentSlides(adjacentIdentity, async (direction, signal) => {
    if (hasCompletionHolds()) return;
    const adjacentDate = shiftDateKey(selectedDate, direction);
    const ranges: Array<{ start: string; end: string }> = [];
    if (showWeek) {
      const start = shiftDateKey(selectedWeekStart, direction * 7);
      if (!calculations.peekRange(workspace, start, shiftDateKey(start, 7), now, capacityNow, allDayOpen)) ranges.push({ start, end: shiftDateKey(start, 7) });
    } else if (!dayData[adjacentDate] && !calculations.peekRange(workspace, adjacentDate, shiftDateKey(adjacentDate, 1), now, capacityNow, allDayOpen)) ranges.push({ start: adjacentDate, end: shiftDateKey(adjacentDate, 1) });
    const timelines = displayMode === 'timeline' && !preparedDays?.[adjacentDate] && !calculations.peekTimeline(workspace, adjacentDate, now) ? [adjacentDate] : [];
    if (!ranges.length && !timelines.length) return;
    const result = await slideRunner.prepare(workspace, { ranges, timelines, now: +now, capacityNow: +capacityNow, allDayOpen }, signal);
    if (result && !signal.aborted && !hasCompletionHolds()) calculations.acceptPrepared(workspace, now, capacityNow, allDayOpen, completionVersion, result);
  });

  const neighbouringRange = (key: string) => {
    if (dayData[key]) return range;
    const start = showWeek ? weekStart(key, preferences.weekStartsOn) : key;
    return calculations.peekRange(workspace, start, shiftDateKey(start, showWeek ? 7 : 1), now, capacityNow, allDayOpen);
  };

  useLayoutEffect(() => {
    if (navigatorMode !== 'week' || selectedDate !== todayKey) return;
    const panel = dayPanelRef.current;
    const today = todayChoiceRef.current;
    if (!panel || !today || panel.scrollWidth <= panel.clientWidth) return;
    panel.scrollLeft = Math.max(0, today.offsetLeft - (panel.clientWidth - today.offsetWidth) / 2);
  }, [navigatorMode, selectedDate, todayKey]);

  const materialize = (row: ProjectedOccurrence): UniversalItem | undefined => {
    if (!row.virtual) return workspace.items[row.materializedItemId ?? row.id];
    const source = workspace.items[row.sourceItemId];
    if (!source || !row.recurrenceId) return undefined;
    // Opening a projected cycle is read-only. Persist it only when the user
    // actually saves, completes, moves, or deletes that cycle.
    return createOccurrence(source, new Date(row.recurrenceId), 0);
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
    const series = workspace.items[item.occurrence.seriesId];
    return series ? createOccurrence(series, new Date(item.occurrence.recurrenceId), item.occurrence.sequence) : undefined;
  };

  const renderDayPanel = (keys: string[], source = range, active = true) => <div className={`${active ? 'calendar-day-panel ' : ''}is-${showWeek ? 'week' : 'month'} calendar-day-strip`} ref={active ? dayPanelRef : undefined} {...(active ? periodSwipe.handlers : {})}>
    {!showWeek && Array.from({ length: 7 }, (_, index) => <span className="calendar-weekday-label" key={index}>{formatDate(shiftDateKey(labelWeek, index), { weekday: 'short' })}</span>)}
    {!showWeek && Array.from({ length: weekdayOffset }, (_, index) => <span className="calendar-day-spacer" key={index} />)}
    {keys.map(key => <button type="button" data-date={active ? key : undefined} ref={active && key === todayKey ? todayChoiceRef : undefined} className={`calendar-day-choice${key === selectedDate ? ' selected' : ''}${key === todayKey ? ' today' : ''}`} aria-pressed={key === selectedDate} aria-current={key === todayKey ? 'date' : undefined} onClick={active ? () => setSelectedDate(key) : undefined} key={key}>
      <span className="calendar-day-label"><b>{showWeek ? formatDate(key, { weekday: 'short' }) : Number(key.slice(-2))}</b>{showWeek && <small>{formatDate(key, { day: 'numeric', month: 'short' })}</small>}</span>
      {source.calendar.days[key]!.view.statistics?.showTime !== false && <span className="view-metrics-summary" aria-label={capacityLabel(key, false, source.capacities)}>{capacityLabel(key, true, source.capacities)}{source.capacities[key]!.hiddenReservedMs > 0 ? ' *' : ''}</span>}
    </button>)}
  </div>;
  const periodPage = (direction: -1 | 1): CalendarSwipePage | undefined => {
    if (!showWeek) return undefined;
    const start = shiftDateKey(selectedWeekStart, direction * 7);
    const source = calculations.peekRange(workspace, start, shiftDateKey(start, 7), now, capacityNow, allDayOpen);
    return source ? { key: start, content: renderDayPanel(Array.from({ length: 7 }, (_, index) => shiftDateKey(start, index)), source, false) } : undefined;
  };
  const timelinePage = (key: string, active: boolean): CalendarSwipePage | undefined => {
    const source = active ? range : neighbouringRange(key);
    const prepared = active ? selectedPrepared : source?.preparedDays?.[key] ?? calculations.peekTimeline(workspace, key, now);
    if (!source || !prepared) return undefined;
    const day = source.calendar.days[key]!, dayPlan = source.plans?.[key];
    const items = active ? selected.evaluation.items : dayPlan ? [...dayPlan.items, ...day.evaluation.items.filter(item => !dayPlan.ids.includes(item.id))] : calendarListOrder(day.evaluation.items, preferences.planning?.orders?.[key]);
    return { key, content: <CalendarTimeline preview={!active} toolbarHost={active ? timelineToolbarHost : null} preparedDay={prepared} listItems={items} plan={dayPlan} planningNow={capacityNow} projectionCache={evaluator.projections} workspace={workspace} dateKey={key} now={now} suppliedNow={active ? suppliedNow : now} capacityLabel={capacityLabel(key, false, source.capacities)} reservedItems={day.reservedItems.filter(item => !items.some(visible => (visible.occurrence?.seriesId ?? visible.id) === (item.occurrence?.seriesId ?? item.id)))} allDayOpen={allDayOpen} onEdit={active ? openItem : () => undefined} onState={active ? changeState : undefined} onPreferences={active ? settings => commit('Timeline preferences', draft => { draft.calendarPreferences.timeline = settings; }) : () => undefined} {...(active ? { onCreateAt: createAt, onAllDayChange: setAllDayOpen, swipeFeedback: dayMotion, onSwipeDay: (direction: -1 | 1) => dayMotion.navigate(direction, () => setSelectedDate(current => shiftDateKey(current, direction))) } : {})} /> };
  };

  return <section className={`calendar-page page-section${compactNavigator ? ' is-compact' : ''}`} ref={calendarRoot}>
    <div className="calendar-navigation">
    <div className="calendar-navigation-body" ref={controlsRef}><div className="calendar-navigation-inner">
    <header className="calendar-title">
      <div><div className="calendar-heading-date"><h1>{selectedLabel}</h1><MoonPhase dateKey={selectedDate} zone={preferences.timezone} ru={preferences.language === 'ru'} />{selectedDate >= todayKey && <DayWeather dateKey={selectedDate} zone={preferences.timezone} ru={preferences.language === 'ru'} />}</div>{selected.view.statistics?.showTime !== false && <span className="view-metrics-summary" data-testid="calendar-header-capacity">{capacityLabel(selectedDate)}</span>}</div>
      <IconButton size="compact" variant="ghost" onClick={() => setEditorOpen(true)} aria-label="Edit calendar day view"><LineIcon name="settings" /></IconButton>
    </header>

    <div className="calendar-view-toolbar">
    <div className="calendar-display-switch" role="group" aria-label="Calendar display mode">
      <Button size="compact" aria-pressed={displayMode === 'list'} onClick={() => changeDisplayMode('list')}>{preferences.language === 'ru' ? 'Список' : 'List'}</Button>
      <Button size="compact" aria-pressed={displayMode === 'timeline'} onClick={() => changeDisplayMode('timeline')}>Timeline</Button>
    </div>
    <div className={`calendar-filter-controls${displayMode === 'list' ? ' calendar-list-toolbar' : ''}`} ref={setTimelineToolbarHost}>
      {displayMode === 'list' && <>
        {overdueIds.size > 0 && <Button size="compact" variant="ghost" aria-pressed={timelineSettings.showOverdue !== false} onClick={() => setTimelineSetting({ showOverdue: timelineSettings.showOverdue === false })}>{preferences.language === 'ru' ? 'Просрочено' : 'Overdue'} · {overdueIds.size}</Button>}
        <Button size="compact" variant="ghost" aria-pressed={timelineSettings.showUndated === true} onClick={() => setTimelineSetting({ showUndated: timelineSettings.showUndated !== true })}>{preferences.language === 'ru' ? 'Без даты' : 'No date'}{undatedItems.length ? ` · ${undatedItems.length}` : ''}</Button>
        {allDayIds.size > 0 && <Button size="compact" variant="ghost" aria-pressed={allDayOpen} onClick={() => { const next = !allDayOpen; persistUiBoolean('calendar:all-day', next); setAllDayOpen(next); }}>{preferences.language === 'ru' ? 'Весь день' : 'All day'} · {allDayIds.size}</Button>}
      </>}
    </div>
    </div>
    </div></div>
    <Surface className="calendar-navigator">
      <div className="calendar-navigator-toolbar-reveal" inert={compactNavigator}><div className="calendar-navigator-toolbar">
        <div className="calendar-period-switch" aria-label="Calendar navigation mode">
          {(['week', 'month'] as const).map((mode) => <Button size="compact" variant="ghost" aria-pressed={navigatorMode === mode} className={navigatorMode === mode ? 'active' : ''} key={mode} onClick={() => setNavigatorMode(mode)}>{mode === 'week' ? 'Week' : 'Month'}</Button>)}
        </div>
        <div className="calendar-period-actions">
          {selectedDate !== todayKey && <Button size="compact" variant="ghost" onClick={() => setSelectedDate(todayKey)}>Today</Button>}
          <IconButton size="compact" variant="ghost" aria-label="Previous period" onClick={() => movePeriod(-1)}>‹</IconButton>
          <IconButton size="compact" variant="ghost" aria-label="Next period" onClick={() => movePeriod(1)}>›</IconButton>
        </div>
      </div></div>
      <CalendarSwipePages className="calendar-period-swipe-track" trackRef={periodMotion.ref} current={{ key: rangeStartKey, content: renderDayPanel(visibleDayKeys) }} previous={periodPage(-1)} next={periodPage(1)} />
    </Surface>
    </div>
    {displayMode === 'timeline'
      ? <CalendarSwipePages className="calendar-day-swipe-content" trackRef={dayMotion.ref} current={timelinePage(selectedDate, true)!} previous={timelinePage(shiftDateKey(selectedDate, -1), false)} next={timelinePage(shiftDateKey(selectedDate, 1), false)} />
      : <><Surface className="calendar-day-list">
        {manuallyOrdered ? <ViewResults {...orderProps} itemLabels={categoryLabels} view={listView} calendarTimeOnly workspace={calendar.workspace} evaluation={listEvaluation} hiddenItemIds={new Set(listEvaluation.items.filter(item => !plan?.pins.has(item.id) && ((overdueIds.has(item.id) && timelineSettings.showOverdue === false) || (allDayIds.has(item.id) && !allDayOpen) || (undatedIds.has(item.id) && timelineSettings.showUndated !== true))).map(item => item.id))} onEdit={openItem} onState={changeState} celebrationColors={celebrationColors} /> : <>
        {overdueIds.size > 0 && timelineSettings.showOverdue !== false && <div className="calendar-overdue"><h2>{preferences.language === 'ru' ? 'Просрочено' : 'Overdue'} · {overdueIds.size}</h2><ViewResults {...orderProps} view={listView} calendarTimeOnly workspace={calendar.workspace} evaluation={selected.evaluation} hiddenItemIds={new Set(selected.evaluation.items.filter(item => !overdueIds.has(item.id)).map(item => item.id))} onEdit={openItem} onState={changeState} celebrationColors={celebrationColors} /></div>}
        {allDayIds.size > 0 && allDayOpen && <div className="calendar-all-day"><h2>{preferences.language === 'ru' ? 'Весь день' : 'All day'} · {allDayIds.size}</h2><ViewResults {...orderProps} view={listView} calendarTimeOnly workspace={calendar.workspace} evaluation={selected.evaluation} hiddenItemIds={new Set(selected.evaluation.items.filter(item => !allDayIds.has(item.id)).map(item => item.id))} onEdit={openItem} onState={changeState} celebrationColors={celebrationColors} /></div>}
        <ViewResults {...orderProps} view={listView} calendarTimeOnly workspace={calendar.workspace} evaluation={selected.evaluation} hiddenItemIds={new Set(selected.evaluation.items.filter(item => overdueIds.has(item.id) || allDayIds.has(item.id) || undatedIds.has(item.id)).map(item => item.id))} onEdit={openItem} onState={changeState} celebrationColors={celebrationColors} />
        {timelineSettings.showUndated === true && undatedItems.length > 0 && <div className="calendar-no-date"><h2>{preferences.language === 'ru' ? 'Без даты' : 'No date'} · {undatedItems.length}</h2><ViewResults {...orderProps} view={listView} calendarTimeOnly workspace={workspace} evaluation={{ items: undatedItems, metrics: null, now }} onEdit={openItem} onState={changeState} celebrationColors={celebrationColors} /></div>}
      </>}</Surface></>}
    {displayMode === 'list' && <>
      <Button size="compact" disabled={!temporaryOrder} onClick={() => setListOrders(current => { const next = { ...current }; delete next[selectedDate]; return next; })}>{preferences.language === 'ru' ? 'Сбросить порядок списка' : 'Reset list order'}</Button>
      {(planning || Boolean(preferences.planning?.orders?.[selectedDate]?.length)) && <Button size="compact" onClick={() => setResetStep(1)} disabled={!preferences.planning?.orders?.[selectedDate]?.length}>{preferences.language === 'ru' ? 'Сбросить порядок дня' : 'Reset day order'}</Button>}
    </>}
    {planningMessage && <p role="status">{planningMessage}</p>}
    <ResponsiveDialog open={resetStep > 0} onOpenChange={open => { if (!open) setResetStep(0); }} title={preferences.language === 'ru' ? 'Сброс порядка' : 'Reset order'} ariaLabel="Reset calendar order">
      <p>{resetStep === 1 ? (preferences.language === 'ru' ? 'Вернуть исходную сортировку? Закрепления и items останутся без изменений.' : 'Restore the initial sorting? Pins and items will not change.') : `${preferences.language === 'ru' ? 'Подтвердите сброс порядка только для' : 'Confirm resetting order only for'} ${selectedLabel} (${selectedDate}).`}</p>
      <Button onClick={() => { if (resetStep === 1) setResetStep(2); else { commit('Reset calendar day order', draft => { if (draft.calendarPreferences.planning?.orders) delete draft.calendarPreferences.planning.orders[selectedDate]; }); setResetStep(0); } }}>{resetStep === 1 ? (preferences.language === 'ru' ? 'Продолжить' : 'Continue') : (preferences.language === 'ru' ? 'Подтвердить сброс' : 'Confirm reset')}</Button>
      <Button onClick={() => setResetStep(0)}>{preferences.language === 'ru' ? 'Отмена' : 'Cancel'}</Button>
    </ResponsiveDialog>
    {editorOpen && <Suspense fallback={null}><CalendarDayViewEditor open={editorOpen} workspace={workspace} selectedDate={selectedDate} now={now} projectionCache={evaluator.projections} onOpenChange={setEditorOpen} onSave={(dayView, timeline) => commit('Save calendar day view', (draft) => { draft.calendarPreferences.dayView = structuredClone(dayView); draft.calendarPreferences.timeline = structuredClone(timeline); })} /></Suspense>}
  </section>;
}
