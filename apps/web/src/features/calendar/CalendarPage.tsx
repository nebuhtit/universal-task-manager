import { useMemo, useState } from 'react';
import {
  calculateViewTimeMetrics, createOccurrence, projectOccurrences,
  type ItemPreset, type ProjectedOccurrence, type SavedView, type UniversalItem,
  type ViewTimeMetrics, type WorkspaceDocument,
} from '@utm/core';
import { LineIcon } from '../../components/ui/icons';
import { Button, IconButton, Surface } from '../../components/ui/primitives';
import { ViewMetricsSummary } from '../views/ViewMetricsSummary';
import { ViewResults } from '../views/ViewResults';
import { selectViewItems } from '../views/viewSelectors';
import { CalendarDayViewEditor } from './CalendarDayViewEditor';
import './calendar.css';

const DAY_MS = 86_400_000;
const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
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

function zonedStart(key: string, timeZone: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  const wallClock = Date.UTC(year!, month! - 1, day!);
  let instant = new Date(wallClock);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(instant);
    const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
    const displayed = Date.UTC(values.year!, values.month! - 1, values.day!, values.hour!, values.minute!, values.second!);
    const next = new Date(wallClock - (displayed - instant.getTime()));
    if (next.getTime() === instant.getTime()) break;
    instant = next;
  }
  return instant;
}

function itemForRow(workspace: WorkspaceDocument, row: ProjectedOccurrence): UniversalItem | null {
  const source = workspace.items[row.materializedItemId ?? row.sourceItemId];
  if (!source) return null;
  if (!row.virtual) return clean({ ...source, schedule: row.schedule, state: row.state });
  if (!row.recurrenceId) return null;
  const projected = createOccurrence(source, new Date(row.recurrenceId), 0);
  projected.id = row.id;
  projected.schedule = clean(row.schedule);
  projected.state = row.state;
  return projected;
}

function dayView(key: string, workspace: WorkspaceDocument): SavedView {
  const settings = workspace.calendarPreferences.dayView;
  const filter = settings.filter.source.trim() || 'true';
  return {
    id: `calendar:${key}`,
    name: key,
    renderer: 'list',
    fields: [...settings.fields],
    query: { source: `(scheduleInPeriod("custom", "${settings.scheduleSources.join(',')}", false, 7, "${key}", "${key}")) && (${filter})` },
    sort: settings.sort.map((rule) => ({ field: rule.expression, direction: rule.direction, nulls: rule.nulls })),
    ...(settings.sortSource ? { sortSource: settings.sortSource } : {}),
    statistics: { showTime: true, reservedItemIds: [] },
  };
}

const navigationMetrics = (metrics: ViewTimeMetrics): ViewTimeMetrics => ({ ...metrics, remainingDurationMs: 0 });

export function CalendarPage({ workspace, now, commit, onEditItem, onState, createUiItem: _createUiItem, celebrationColors = new Map() }: {
  workspace: WorkspaceDocument;
  now: Date;
  commit: (message: string, mutation: (draft: WorkspaceDocument) => void) => void;
  onEditItem: (item: UniversalItem) => void;
  onState: (item: UniversalItem, state: UniversalItem['state'], celebrationColor?: string) => void;
  createUiItem: (title?: string, preset?: ItemPreset, now?: Date) => UniversalItem;
  celebrationColors?: ReadonlyMap<string, string>;
}) {
  const preferences = workspace.calendarPreferences;
  const [selectedDate, setSelectedDate] = useState(() => localDateKey(now, preferences.timezone));
  const [navigatorMode, setNavigatorMode] = useState<NavigatorMode>('week');
  const [editorOpen, setEditorOpen] = useState(false);
  const todayKey = localDateKey(now, preferences.timezone);
  const rangeStartKey = navigatorMode === 'week' ? weekStart(selectedDate, preferences.weekStartsOn) : monthStart(selectedDate);
  const rangeEndKey = navigatorMode === 'week' ? shiftDateKey(rangeStartKey, 7) : nextMonthStart(selectedDate);
  const rangeStart = zonedStart(rangeStartKey, preferences.timezone);
  const rangeEnd = zonedStart(rangeEndKey, preferences.timezone);

  const projected = useMemo(() => projectOccurrences(workspace, rangeStart, rangeEnd)
    .map((row) => ({ row, item: itemForRow(workspace, row) }))
    .filter((entry): entry is { row: ProjectedOccurrence; item: UniversalItem } => Boolean(entry.item)), [workspace, rangeStart.getTime(), rangeEnd.getTime()]);

  const dayKeys = useMemo(() => {
    const keys: string[] = [];
    for (let key = rangeStartKey; key < rangeEndKey; key = shiftDateKey(key, 1)) keys.push(key);
    return keys;
  }, [rangeStartKey, rangeEndKey]);
  const dayData = useMemo(() => Object.fromEntries(dayKeys.map((key) => {
    const view = dayView(key, workspace);
    const candidateWorkspace = clean(workspace);
    candidateWorkspace.items = Object.fromEntries(projected.map(({ item }) => [item.id, clean(item)]));
    const selectedItems = selectViewItems(candidateWorkspace, view, new Date((zonedStart(key, preferences.timezone).getTime() + zonedStart(shiftDateKey(key, 1), preferences.timezone).getTime()) / 2));
    const accepted = new Set(selectedItems.map((item) => item.id));
    const entries = projected.filter(({ item }) => accepted.has(item.id));
    candidateWorkspace.items = Object.fromEntries(selectedItems.map((item) => [item.id, clean(item)]));
    const metrics = calculateViewTimeMetrics(candidateWorkspace, view, selectedItems, now);
    return [key, { entries, view, workspace: candidateWorkspace, metrics }];
  })), [dayKeys, projected, preferences.timezone, preferences.dayView, workspace, now.getTime()]);

  const emptyWorkspace = clean(workspace); emptyWorkspace.items = {};
  const selected = dayData[selectedDate] ?? { entries: [], view: dayView(selectedDate, workspace), workspace: emptyWorkspace, metrics: calculateViewTimeMetrics(emptyWorkspace, dayView(selectedDate, workspace), [], now) };
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
      result = clean(occurrence);
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

    <Surface className="calendar-day-list"><ViewResults view={selected.view} workspace={selected.workspace} onEdit={openItem} onState={changeState} celebrationColors={celebrationColors} /></Surface>
    <CalendarDayViewEditor open={editorOpen} workspace={workspace} onOpenChange={setEditorOpen} onSave={(dayView) => commit('Save calendar day view', (draft) => { draft.calendarPreferences.dayView = clean(dayView); })} />
  </section>;
}
