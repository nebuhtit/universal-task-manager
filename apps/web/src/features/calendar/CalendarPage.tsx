import { useMemo, useState } from 'react';
import {
  applyGoogleCalendarSync, calculateViewTimeMetrics, createId, createOccurrence, projectOccurrences,
  type GoogleCalendarPreferences,
  type ItemPreset, type ProjectedOccurrence, type SavedView, type UniversalItem,
  type ViewTimeMetrics, type WorkspaceDocument,
} from '@utm/core';
import { LineIcon } from '../../components/ui/icons';
import { ResponsiveDialog } from '../../components/ui/ResponsiveDialog';
import { SearchableDisclosureList } from '../../components/ui/SearchableDisclosureList';
import { Button, Checkbox, Disclosure, Field, IconButton, Input, Select, Surface } from '../../components/ui/primitives';
import { recordDiagnostic } from '../../services/diagnostics';
import { stateNames } from '../items';
import { ViewMetricsSummary } from '../views/ViewMetricsSummary';
import { ViewResults } from '../views/ViewResults';
import { selectViewItems } from '../views/viewSelectors';
import { GOOGLE_CALENDAR_CLIENT_ID, requestGoogleCalendarToken, synchronizeGoogleCalendars } from '../../services/googleCalendar';
import './calendar.css';

const DAY_MS = 86_400_000;
const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
type NavigatorMode = 'week' | 'month';
type GoogleSyncLogEntry = { at: string; level: 'info' | 'error'; message: string };

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

function overlapsDay(item: UniversalItem, start: Date, end: Date): boolean {
  const startsAt = Date.parse(item.schedule?.startAt ?? item.schedule?.dueAt ?? '');
  if (!Number.isFinite(startsAt)) return false;
  const endsAt = Date.parse(item.schedule?.endAt ?? item.schedule?.startAt ?? item.schedule?.dueAt ?? '');
  if (!Number.isFinite(endsAt) || endsAt <= startsAt) return startsAt >= start.getTime() && startsAt < end.getTime();
  return startsAt < end.getTime() && endsAt > start.getTime();
}

function dayView(key: string): SavedView {
  return {
    id: `calendar:${key}`,
    name: key,
    renderer: 'list',
    fields: ['title', 'bodyMarkdown', 'schedule.startAt', 'schedule.dueAt', 'tags', 'area', 'project', 'schedule.estimatedDuration', 'external.provider'],
    query: { source: `scheduleInPeriod("custom", "event_open,duration,due", false, 7, "${key}", "${key}")` },
    sort: [{ field: 'schedule.startAt', direction: 'asc', nulls: 'last' }, { field: 'schedule.dueAt', direction: 'asc', nulls: 'last' }],
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [googleToken, setGoogleToken] = useState<{ accessToken: string; expiresAt: number } | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState('');
  const [googleSyncStatus, setGoogleSyncStatus] = useState('');
  const [googleSyncLog, setGoogleSyncLog] = useState<GoogleSyncLogEntry[]>([]);
  const todayKey = localDateKey(now, preferences.timezone);
  const rangeStartKey = navigatorMode === 'week' ? weekStart(selectedDate, preferences.weekStartsOn) : monthStart(selectedDate);
  const rangeEndKey = navigatorMode === 'week' ? shiftDateKey(rangeStartKey, 7) : nextMonthStart(selectedDate);
  const rangeStart = zonedStart(rangeStartKey, preferences.timezone);
  const rangeEnd = zonedStart(rangeEndKey, preferences.timezone);

  const projected = useMemo(() => projectOccurrences(workspace, rangeStart, rangeEnd)
    .map((row) => ({ row, item: itemForRow(workspace, row) }))
    .filter((entry): entry is { row: ProjectedOccurrence; item: UniversalItem } => Boolean(entry.item))
    .filter(({ item }) => preferences.includeStates.includes(item.state)), [workspace, rangeStart.getTime(), rangeEnd.getTime(), preferences.includeStates.join('|')]);

  const filtered = useMemo(() => {
    const selectedView = preferences.selectedViewId ? workspace.views[preferences.selectedViewId] : undefined;
    if (!selectedView) return projected;
    const candidateWorkspace = clean(workspace);
    candidateWorkspace.items = Object.fromEntries(projected.map(({ item }) => [item.id, clean(item)]));
    const accepted = new Set(selectViewItems(candidateWorkspace, selectedView).map((item) => item.id));
    return projected.filter(({ item }) => accepted.has(item.id));
  }, [projected, preferences.selectedViewId, workspace]);

  const dayKeys = useMemo(() => {
    const keys: string[] = [];
    for (let key = rangeStartKey; key < rangeEndKey; key = shiftDateKey(key, 1)) keys.push(key);
    return keys;
  }, [rangeStartKey, rangeEndKey]);
  const dayData = useMemo(() => Object.fromEntries(dayKeys.map((key) => {
    const start = zonedStart(key, preferences.timezone);
    const end = zonedStart(shiftDateKey(key, 1), preferences.timezone);
    const entries = filtered.filter(({ item }) => overlapsDay(item, start, end));
    const view = dayView(key);
    const candidateWorkspace = clean(workspace);
    candidateWorkspace.items = Object.fromEntries(entries.map(({ item }) => [item.id, clean(item)]));
    const metrics = calculateViewTimeMetrics(candidateWorkspace, view, entries.map(({ item }) => item), now);
    return [key, { entries, view, workspace: candidateWorkspace, metrics }];
  })), [dayKeys, filtered, preferences.timezone, workspace, now.getTime()]);

  const emptyWorkspace = clean(workspace); emptyWorkspace.items = {};
  const selected = dayData[selectedDate] ?? { entries: [], view: dayView(selectedDate), workspace: emptyWorkspace, metrics: calculateViewTimeMetrics(emptyWorkspace, dayView(selectedDate), [], now) };
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

  const syncGoogle = async () => {
    const startedAt = performance.now();
    let diagnosticStage = 'authorization';
    const appendLog = (message: string, level: GoogleSyncLogEntry['level'] = 'info') => setGoogleSyncLog((entries) => [...entries, { at: new Date().toISOString(), level, message }].slice(-30));
    setGoogleBusy(true); setGoogleError('');
    const current: GoogleCalendarPreferences = preferences.googleCalendar ?? { connectionId: createId(), calendars: [], syncTokens: {} };
    try {
      const hasCurrentToken = Boolean(googleToken && googleToken.expiresAt > Date.now() + 60_000);
      setGoogleSyncStatus(hasCurrentToken ? 'Using current Google authorization…' : 'Waiting for Google authorization…');
      appendLog(hasCurrentToken ? 'Using current Google authorization.' : 'Waiting for Google authorization.');
      const token = hasCurrentToken ? googleToken! : await requestGoogleCalendarToken();
      setGoogleToken(token);
      appendLog('Google authorization received.');
      diagnosticStage = 'download';
      const result = await synchronizeGoogleCalendars(token.accessToken, current, (progress) => {
        diagnosticStage = progress.stage;
        setGoogleSyncStatus(progress.message);
        appendLog(progress.message);
      });
      diagnosticStage = 'save';
      setGoogleSyncStatus('Saving events to this workspace…');
      appendLog('Saving downloaded events to this workspace.');
      commit('Sync Google Calendar', (draft) => {
        for (const batch of result.batches) applyGoogleCalendarSync(draft, batch);
        draft.calendarPreferences.googleCalendar = {
          connectionId: current.connectionId, calendars: result.calendars, syncTokens: result.syncTokens, syncWindow: result.syncWindow,
          ...(result.accountEmail ? { accountEmail: result.accountEmail } : {}), lastSyncedAt: result.syncedAt,
        };
      });
      const eventCount = result.batches.reduce((total, batch) => total + batch.events.length, 0);
      const durationMs = Math.round(performance.now() - startedAt);
      setGoogleSyncStatus(`Sync complete: ${eventCount} events.`);
      appendLog(`Sync complete: ${eventCount} events in ${(durationMs / 1_000).toFixed(1)}s.`);
      recordDiagnostic({ kind: 'result', message: 'Google Calendar sync completed', operation: 'Google Calendar sync', outcome: 'succeeded', durationMs, details: JSON.stringify({ calendars: result.batches.length, events: eventCount }) });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      const durationMs = Math.round(performance.now() - startedAt);
      setGoogleError(`${message} Stage: ${diagnosticStage}.`);
      setGoogleSyncStatus('Sync failed.');
      appendLog(`Sync failed during ${diagnosticStage}: ${message}`, 'error');
      recordDiagnostic({
        kind: 'error', message: 'Google Calendar sync failed', operation: 'Google Calendar sync', outcome: 'failed', durationMs,
        details: JSON.stringify({ stage: diagnosticStage, status: (reason as { status?: unknown })?.status ?? null, errorType: reason instanceof Error ? reason.name : typeof reason }),
      });
      if (preferences.googleCalendar) commit('Record Google Calendar sync error', (draft) => { if (draft.calendarPreferences.googleCalendar) draft.calendarPreferences.googleCalendar.lastError = message; });
    } finally { setGoogleBusy(false); }
  };

  const selectGoogleCalendar = (calendarId: string) => commit('Select Google calendar', (draft) => {
    const google = draft.calendarPreferences.googleCalendar;
    if (!google) return;
    const calendar = google.calendars.find((entry) => entry.id === calendarId);
    if (!calendar) return;
    calendar.selected = !calendar.selected;
    delete google.syncTokens[calendarId];
    if (!calendar.selected) {
      Object.values(draft.items).forEach((item) => {
        if (item.external?.provider !== 'google_calendar' || item.external.connectionId !== google.connectionId || item.external.calendarId !== calendarId) return;
        delete draft.items[item.id]; delete draft.tombstones[item.id];
      });
    }
  });

  return <section className="calendar-page page-section">
    <header className="calendar-title">
      <div><p className="eyebrow">CALENDAR</p><h1>{selectedLabel}</h1><ViewMetricsSummary metrics={selected.metrics} language={preferences.language} /></div>
      <IconButton size="compact" variant="ghost" onClick={() => setSettingsOpen(true)} aria-label="Calendar settings"><LineIcon name="settings" /></IconButton>
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

    <SearchableDisclosureList uiKey="calendar:saved-view-filter" className="calendar-view-picker" summary={preferences.selectedViewId ? workspace.views[preferences.selectedViewId]?.name ?? 'All scheduled items' : 'All scheduled items'} items={[null, ...Object.values(workspace.views)]} getSearchText={(view) => view?.name ?? 'All scheduled items'} searchLabel="Search Saved views" searchPlaceholder="Search views" renderItem={(view) => <Button size="compact" variant="ghost" key={view?.id ?? 'all'} aria-pressed={(preferences.selectedViewId ?? '') === (view?.id ?? '')} onClick={(event) => { commit('Set calendar view filter', (draft) => { if (view) draft.calendarPreferences.selectedViewId = view.id; else delete draft.calendarPreferences.selectedViewId; }); event.currentTarget.closest('details')?.removeAttribute('open'); }}>{view?.name ?? 'All scheduled items'}</Button>} />

    <Surface className="calendar-day-list"><ViewResults view={selected.view} workspace={selected.workspace} onEdit={openItem} onState={changeState} celebrationColors={celebrationColors} /></Surface>

    <ResponsiveDialog open={settingsOpen} onOpenChange={setSettingsOpen} title="Calendar settings" closeLabel="Close calendar settings">
      <div className="calendar-dialog-fields">
        <Field label="Timezone"><Input value={preferences.timezone} onChange={(event) => commit('Change calendar timezone', (draft) => { draft.calendarPreferences.timezone = event.target.value; })} /></Field>
        <Field label="Week starts"><Select value={preferences.weekStartsOn} onChange={(event) => commit('Change first weekday', (draft) => { draft.calendarPreferences.weekStartsOn = Number(event.target.value) as 0 | 1; })}><option value="1">Monday</option><option value="0">Sunday</option></Select></Field>
        <div className="calendar-state-filters" aria-label="Calendar item states">{(['open', 'done', 'auto_closed', 'cancelled', 'archived'] as const).map((state) => <Checkbox key={state} label={stateNames[state]} checked={preferences.includeStates.includes(state)} onChange={() => commit('Change calendar state filters', (draft) => { const values = draft.calendarPreferences.includeStates; const index = values.indexOf(state); if (index >= 0) values.splice(index, 1); else values.push(state); })} />)}</div>
        <section className="calendar-google-settings" aria-label="Google Calendar sync">
          <div><strong>Google Calendar</strong><small>Read-only. Events are mirrored into this workspace; editing opens Google Calendar.</small></div>
          {!GOOGLE_CALENDAR_CLIENT_ID && <p className="hint">This build needs a Google OAuth client ID before connection is available.</p>}
          {preferences.googleCalendar?.accountEmail && <small>Connected as {preferences.googleCalendar.accountEmail}</small>}
          {preferences.googleCalendar?.calendars.length ? <div className="calendar-google-list">{preferences.googleCalendar.calendars.map((calendar) => <Checkbox key={calendar.id} label={`${calendar.name}${calendar.primary ? ' · primary' : ''}`} checked={calendar.selected} onChange={() => selectGoogleCalendar(calendar.id)} />)}</div> : null}
          <Button onClick={() => void syncGoogle()} disabled={googleBusy || !GOOGLE_CALENDAR_CLIENT_ID}>{googleBusy ? 'Syncing…' : preferences.googleCalendar ? 'Sync now' : 'Connect Google Calendar'}</Button>
          {googleSyncStatus && <small className="calendar-google-status" role="status" aria-live="polite">{googleSyncStatus}</small>}
          {preferences.googleCalendar?.lastSyncedAt && <small>Last synced {new Intl.DateTimeFormat(preferences.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(preferences.googleCalendar.lastSyncedAt))}</small>}
          {(googleError || preferences.googleCalendar?.lastError) && <p className="form-error" role="alert">{googleError || preferences.googleCalendar?.lastError}</p>}
          {googleSyncLog.length > 0 && <Disclosure uiKey="calendar:google-sync-log" persist={false} className="calendar-google-log" summary={<span>Sync log <small>{googleSyncLog.length}</small></span>}>
            <ol>{googleSyncLog.map((entry, index) => <li data-level={entry.level} key={`${entry.at}:${index}`}><time dateTime={entry.at}>{new Intl.DateTimeFormat(preferences.language, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(entry.at))}</time><span>{entry.message}</span></li>)}</ol>
          </Disclosure>}
        </section>
      </div>
    </ResponsiveDialog>
  </section>;
}
