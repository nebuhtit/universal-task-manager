import { useMemo, useState, useSyncExternalStore } from 'react';
import {
  createOccurrence,
  type ItemPreset, type ProjectedOccurrence, type UniversalItem, type ViewTimeMetrics, type WorkspaceDocument,
} from '@utm/core';
import { LineIcon } from '../../components/ui/icons';
import { Button, IconButton, Surface } from '../../components/ui/primitives';
import { ViewMetricsSummary } from '../views/ViewMetricsSummary';
import { ViewResults } from '../views/ViewResults';
import { completionHoldsSnapshot, subscribeCompletionHolds } from '../views/viewSelectors';
import { useViewNow, useWorkspaceBoundaryNow } from '../views/useViewEvaluation';
import { CalendarDayViewEditor } from './CalendarDayViewEditor';
import { calendarDayView, evaluateCalendarRange } from './calendarEvaluation';
import './calendar.css';

const DAY_MS = 86_400_000;
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

const navigationMetrics = (metrics: ViewTimeMetrics): ViewTimeMetrics => ({ ...metrics, remainingDurationMs: 0 });

export function CalendarPage({ workspace, now: suppliedNow, commit, onEditItem, onState, createUiItem: _createUiItem, celebrationColors = new Map() }: {
  workspace: WorkspaceDocument;
  now?: Date;
  commit: (message: string, mutation: (draft: WorkspaceDocument) => void) => void;
  onEditItem: (item: UniversalItem) => void;
  onState: (item: UniversalItem, state: UniversalItem['state'], celebrationColor?: string) => void;
  createUiItem: (title?: string, preset?: ItemPreset, now?: Date) => UniversalItem;
  celebrationColors?: ReadonlyMap<string, string>;
}) {
  const preferences = workspace.calendarPreferences;
  const navigationNow = useWorkspaceBoundaryNow(workspace, suppliedNow);
  const initialNow = suppliedNow ?? navigationNow;
  const [selectedDate, setSelectedDate] = useState(() => localDateKey(initialNow, preferences.timezone));
  const [navigatorMode, setNavigatorMode] = useState<NavigatorMode>('week');
  const [editorOpen, setEditorOpen] = useState(false);
  const completionVersion = useSyncExternalStore(subscribeCompletionHolds, completionHoldsSnapshot, completionHoldsSnapshot);
  const selectedDayView = calendarDayView(selectedDate, preferences.dayView);
  const now = useViewNow(workspace, selectedDayView, suppliedNow);
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
  const rowsById = new Map(selected.entries.map(({ row, item }) => [item.id, row]));
  const formatDate = (key: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(preferences.language, { ...options, timeZone: 'UTC' }).format(dateFromKey(key));
  const selectedLabel = formatDate(selectedDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const weekdayOffset = navigatorMode === 'month' ? (dateFromKey(rangeStartKey).getUTCDay() - preferences.weekStartsOn + 7) % 7 : 0;
  const labelWeek = weekStart('2026-08-31', preferences.weekStartsOn);

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
    const source = row ? materialize(row) : workspace.items[item.id] ?? item;
    if (source) onEditItem(source);
  };
  const changeState = (item: UniversalItem, state: UniversalItem['state'], color?: string) => {
    if (item.external?.readOnly) { window.open(item.external.sourceUrl, '_blank', 'noopener,noreferrer'); return; }
    const row = rowsById.get(item.id);
    const source = row ? materialize(row) : workspace.items[item.id] ?? item;
    if (source) window.setTimeout(() => onState(source, state, color), 0);
  };

  return <section className="calendar-page page-section">
    <header className="calendar-title">
      <div><p className="eyebrow">CALENDAR</p><h1>{selectedLabel}</h1><ViewMetricsSummary metrics={selected.metrics} language={preferences.language} /></div>
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
      <div className={`calendar-day-panel is-${navigatorMode}`}>
        {navigatorMode === 'month' && Array.from({ length: 7 }, (_, index) => <span className="calendar-weekday-label" key={index}>{formatDate(shiftDateKey(labelWeek, index), { weekday: 'short' })}</span>)}
        {navigatorMode === 'month' && Array.from({ length: weekdayOffset }, (_, index) => <span className="calendar-day-spacer" key={index} />)}
        {dayKeys.map((key) => <button type="button" className={`calendar-day-choice${key === selectedDate ? ' selected' : ''}${key === todayKey ? ' today' : ''}`} aria-pressed={key === selectedDate} onClick={() => setSelectedDate(key)} key={key}>
          <span className="calendar-day-label"><b>{navigatorMode === 'week' ? formatDate(key, { weekday: 'short' }) : Number(key.slice(-2))}</b>{navigatorMode === 'week' && <small>{formatDate(key, { day: 'numeric', month: 'short' })}</small>}</span>
          <ViewMetricsSummary metrics={navigationMetrics(dayData[key]!.metrics)} language={preferences.language} />
        </button>)}
      </div>
    </Surface>

    <Surface className="calendar-day-list"><ViewResults view={selected.view} workspace={calendar.workspace} evaluation={selected.evaluation} onEdit={openItem} onState={changeState} celebrationColors={celebrationColors} /></Surface>
    <CalendarDayViewEditor open={editorOpen} workspace={workspace} onOpenChange={setEditorOpen} onSave={(dayView) => commit('Save calendar day view', (draft) => { draft.calendarPreferences.dayView = structuredClone(dayView); })} />
  </section>;
}
