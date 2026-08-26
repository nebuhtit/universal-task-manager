import { useEffect, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/react/daygrid';
import timeGridPlugin from '@fullcalendar/react/timegrid';
import listPlugin from '@fullcalendar/react/list';
import interactionPlugin, { Draggable } from '@fullcalendar/react/interaction';
import type { CalendarApi, DateClickInfo, DateSelectInfo, DatesSetInfo, EventClickInfo, EventDropInfo, EventInput, EventReceiveInfo, EventResizeDoneInfo } from '@fullcalendar/react';
import '@fullcalendar/react/skeleton.css';
import { CloseIcon, LineIcon } from '../../components/ui/icons';
import { ResponsiveDialog } from '../../components/ui/ResponsiveDialog';
import { Button, Checkbox, Field, IconButton, Input, Select, Surface } from '../../components/ui/primitives';
import { dateInput, fromDateInput, isSleepTime } from '../../utils/dates';
import { compileQuery, materializeProjectedOccurrence, moveCalendarItems, moveRecurringOccurrence, projectOccurrences, resizeCalendarItem, type CalendarViewMode, type ItemPreset, type ProjectedOccurrence, type RecurrenceEditScope, type Schedule, type UniversalItem, type WorkspaceDocument } from '@utm/core';
import { inferredPreset, priorityNames, stateNames } from '../items';
import './calendar.css';

const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type CalendarPendingMove = { rows: ProjectedOccurrence[]; deltaMs: number };
export function CalendarPage({ workspace, now, commit, onEditItem, createUiItem }: {
  workspace: WorkspaceDocument; now: Date; commit: (message: string, mutation: (draft: WorkspaceDocument) => void) => void; onEditItem: (item: UniversalItem) => void; createUiItem: (title?: string, preset?: ItemPreset, now?: Date) => UniversalItem;
}) {
  const preferences = workspace.calendarPreferences;
  const initialMode: CalendarViewMode = typeof window !== 'undefined' && window.innerWidth <= 620 && preferences.lastMode === 'month' ? 'day' : preferences.lastMode;
  const [mode, setMode] = useState<CalendarViewMode>(initialMode);
  const [range, setRange] = useState(() => ({ start: new Date(now.getFullYear(), now.getMonth(), 1), end: new Date(now.getFullYear(), now.getMonth() + 1, 8) }));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [quickDraft, setQuickDraft] = useState<UniversalItem | null>(null);
  const [pendingMove, setPendingMove] = useState<CalendarPendingMove | null>(null);
  const [undoItems, setUndoItems] = useState<Record<string, UniversalItem> | null>(null);
  const [moveDialog, setMoveDialog] = useState(false);
  const [moveTarget, setMoveTarget] = useState('');
  const [unscheduledOpen, setUnscheduledOpen] = useState(false);
  const [calendarSettingsOpen, setCalendarSettingsOpen] = useState(false);
  const unscheduledRef = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<{ getApi: () => CalendarApi }>(null);

  const projected = useMemo(() => {
    const all = projectOccurrences(workspace, range.start, range.end);
    const predicate = preferences.selectedViewId ? (() => {
      const view = workspace.views[preferences.selectedViewId!];
      if (!view) return (_row: ProjectedOccurrence) => true;
      try {
        const compiled = compileQuery(view.query.source.trim() || 'true', undefined, { timeZone: preferences.timezone, weekStartsOn: preferences.weekStartsOn });
        return (row: ProjectedOccurrence) => {
          const source = workspace.items[row.materializedItemId ?? row.sourceItemId];
          if (!source) return false;
          const logical = row.virtual ? { ...clean(source), role: 'occurrence' as const, state: row.state, schedule: row.schedule } : source;
          try { return compiled(logical); } catch { return false; }
        };
      } catch { return (_row: ProjectedOccurrence) => false; }
    })() : (_row: ProjectedOccurrence) => true;
    return all.filter((row) => preferences.includeStates.includes(row.state) && predicate(row));
  }, [workspace, range.start, range.end, preferences.selectedViewId, preferences.includeStates]);
  const byId = useMemo(() => new Map(projected.map((row) => [row.id, row])), [projected]);
  const unscheduled = Object.values(workspace.items).filter((item) => !item.deletedAt && item.role !== 'series_template' && !item.schedule?.startAt && !item.schedule?.dueAt);

  useEffect(() => {
    const container = unscheduledRef.current; if (!container) return;
    const draggable = new Draggable(container, {
      itemSelector: '.unscheduled-item', longPressDelay: 420,
      eventData: (element) => ({ id: `external:${(element as HTMLElement).dataset.itemId}`, title: (element as HTMLElement).dataset.title, duration: '00:30' }),
    });
    return () => draggable.destroy();
  }, [unscheduled.map((item) => item.id).join('|')]);

  useEffect(() => {
    if (!undoItems) return; const timer = window.setTimeout(() => setUndoItems(null), 8_000); return () => window.clearTimeout(timer);
  }, [undoItems]);

  const setCalendarMode = (next: CalendarViewMode) => {
    setMode(next); calendarRef.current?.getApi().changeView(next === 'month' ? 'dayGridMonth' : next === 'week' ? 'timeGridWeek' : next === 'day' ? 'timeGridDay' : next === 'three_day' ? 'timeGridThreeDay' : 'listYear');
    commit('Save calendar mode', (draft) => { draft.calendarPreferences.lastMode = next; });
  };
  const saveUndoPoint = () => setUndoItems(clean(workspace.items));
  const applyMove = (rows: ProjectedOccurrence[], deltaMs: number, scope: RecurrenceEditScope) => {
    saveUndoPoint();
    commit(rows.length > 1 ? 'Move selected calendar items' : 'Move calendar item', (draft) => {
      const ordinaryIds: string[] = [];
      const movedSeries = new Set<string>();
      rows.forEach((row) => {
        if (row.seriesId) {
          if (scope === 'entire_series' && movedSeries.has(row.seriesId)) return;
          moveRecurringOccurrence(draft, row, deltaMs, scope, now); movedSeries.add(row.seriesId);
        } else ordinaryIds.push(materializeProjectedOccurrence(draft, row, now).id);
      });
      if (ordinaryIds.length) moveCalendarItems(draft, ordinaryIds, deltaMs, now);
    });
    setSelected(new Set()); setPendingMove(null);
  };
  const requestMove = (row: ProjectedOccurrence, deltaMs: number) => {
    const rows = selected.has(row.id) ? projected.filter((entry) => selected.has(entry.id)) : [row];
    if (rows.some((entry) => entry.seriesId)) setPendingMove({ rows, deltaMs });
    else applyMove(rows, deltaMs, 'this_occurrence');
  };
  const createDraftForRange = (start: Date, end: Date | null, allDay: boolean) => {
    const item = createUiItem('', 'task', start);
    item.schedule = { timezone: preferences.timezone, startAt: start.toISOString(), endAt: (end ?? new Date(start.getTime() + preferences.defaultDurationMinutes * 60_000)).toISOString(), ...(allDay ? { allDay: true } : {}) };
    setQuickDraft(item);
  };
  const patchQuickSchedule = (key: 'startAt' | 'endAt', value: string) => setQuickDraft((current) => {
    if (!current) return current;
    const schedule = { ...current.schedule! } as Record<string, unknown>; const converted = fromDateInput(value);
    if (converted) schedule[key] = converted; else delete schedule[key];
    return { ...current, schedule: schedule as unknown as Schedule };
  });
  const openProjected = (row: ProjectedOccurrence) => {
    let opened: UniversalItem | undefined;
    if (row.virtual) commit('Materialize calendar occurrence', (draft) => { opened = clean(materializeProjectedOccurrence(draft, row, now)); });
    else opened = workspace.items[row.materializedItemId ?? row.id];
    if (opened) onEditItem(clean(opened));
  };
  const events: EventInput[] = projected.map((row) => {
    const start = row.schedule.startAt ?? row.schedule.dueAt!;
    const defaultEnd = row.schedule.startAt ? new Date(new Date(start).getTime() + preferences.defaultDurationMinutes * 60_000).toISOString() : undefined;
    const end = row.schedule.endAt ?? defaultEnd;
    return {
      id: row.id, title: row.title || 'Untitled', start, ...(end ? { end } : {}), allDay: Boolean(row.schedule.allDay),
      editable: true, durationEditable: !row.dueOnly, class: [`calendar-state-${row.state}`, `calendar-priority-${row.priority ?? 0}`, row.schedule.startAt && !row.schedule.allDay ? 'calendar-time-event' : '', row.dueOnly ? 'calendar-due-only' : '', selected.has(row.id) ? 'calendar-selected' : ''].filter(Boolean).join(' '),
      extendedProps: { row },
    };
  });
  const handleEventClick = (info: EventClickInfo) => {
    const row = byId.get(info.event.id); if (!row) return;
    if (info.jsEvent.shiftKey) { setSelected((current) => { const next = new Set(current); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next; }); return; }
    openProjected(row);
  };
  const handleSelect = (info: DateSelectInfo) => {
    if (info.jsEvent?.shiftKey || info.jsEvent === null) {
      const start = info.start.getTime(); const end = info.end.getTime();
      setSelected(new Set(projected.filter((row) => { const value = new Date(row.schedule.startAt ?? row.schedule.dueAt!).getTime(); return value >= start && value < end; }).map((row) => row.id)));
      return;
    }
    createDraftForRange(info.start, info.end, info.allDay);
  };
  const handleDrop = (info: EventDropInfo) => {
    const row = byId.get(info.event.id); const start = info.event.start; if (!row || !start) { info.revert(); return; }
    const original = new Date(row.schedule.startAt ?? row.schedule.dueAt!).getTime(); const delta = start.getTime() - original;
    info.revert(); requestMove(row, delta);
  };
  const handleResize = (info: EventResizeDoneInfo) => {
    const row = byId.get(info.event.id); const start = info.event.start; const end = info.event.end; info.revert(); if (!row || !start || !end) return;
    saveUndoPoint();
    commit('Resize calendar item', (draft) => { const item = materializeProjectedOccurrence(draft, row, now); resizeCalendarItem(draft, item.id, end.toISOString(), now, start.toISOString()); });
  };
  const handleExternal = (info: EventReceiveInfo) => {
    const itemId = info.event.id.replace(/^external:/, ''); const start = info.event.start; const end = info.event.end; const allDay = info.event.allDay; info.revert(); if (!start) return;
    saveUndoPoint();
    commit('Schedule unscheduled item', (draft) => { const item = draft.items[itemId]; if (!item) return; item.schedule = { timezone: preferences.timezone, startAt: start.toISOString(), endAt: (end ?? new Date(start.getTime() + preferences.defaultDurationMinutes * 60_000)).toISOString(), ...(allDay ? { allDay: true } : {}) }; item.updatedAt = now.toISOString(); item.revision += 1; });
    setUnscheduledOpen(false);
  };
  const selectedRows = projected.filter((row) => selected.has(row.id));
  const performKeyboardMove = () => {
    if (!selectedRows.length || !moveTarget) return;
    const earliest = Math.min(...selectedRows.map((row) => new Date(row.schedule.startAt ?? row.schedule.dueAt!).getTime()));
    const delta = new Date(moveTarget).getTime() - earliest;
    if (selectedRows.some((row) => row.seriesId)) setPendingMove({ rows: selectedRows, deltaMs: delta }); else applyMove(selectedRows, delta, 'this_occurrence');
    setMoveDialog(false);
  };

  return <section className="calendar-page page-section">
    <div className="calendar-title">
      <div><p className="eyebrow">TIME, WITHOUT SILOS</p><h1>Calendar</h1></div>
      <div className="calendar-nav">
        <IconButton size="compact" variant="ghost" onClick={() => setCalendarSettingsOpen(true)} aria-label="Calendar settings"><LineIcon name="settings" /></IconButton>
        <IconButton size="compact" variant="ghost" onClick={() => calendarRef.current?.getApi().prev()} aria-label="Previous period">‹</IconButton>
        <Button size="compact" variant="ghost" onClick={() => calendarRef.current?.getApi().today()}>Today</Button>
        <IconButton size="compact" variant="ghost" onClick={() => calendarRef.current?.getApi().next()} aria-label="Next period">›</IconButton>
      </div>
    </div>
    <div className="calendar-controls">
      <div className="calendar-modes" aria-label="Calendar view">
        {(['month', ...(window.innerWidth <= 620 ? ['three_day'] : ['week']), 'day', 'agenda'] as CalendarViewMode[]).map((entry) => <Button
          variant="ghost"
          size="compact"
          className={mode === entry ? 'active' : ''}
          aria-pressed={mode === entry}
          key={entry}
          onClick={() => setCalendarMode(entry)}
        >{entry === 'three_day' ? '3 days' : entry}</Button>)}
      </div>
      <Field label="Saved view" className="calendar-view-field">
        <Select value={preferences.selectedViewId ?? ''} onChange={(event) => commit('Set calendar view filter', (draft) => {
          if (event.target.value) draft.calendarPreferences.selectedViewId = event.target.value;
          else delete draft.calendarPreferences.selectedViewId;
        })}>
          <option value="">All active + completed</option>
          {Object.values(workspace.views).map((view) => <option value={view.id} key={view.id}>{view.name}</option>)}
        </Select>
      </Field>
      <Button size="compact" className="unscheduled-toggle" onClick={() => setUnscheduledOpen(true)}>Unscheduled ({unscheduled.length})</Button>
    </div>
    <div className="calendar-state-filters" aria-label="Calendar item states">
      {(['open', 'done', 'auto_closed', 'cancelled', 'archived'] as const).map((state) => <Checkbox
        key={state}
        label={stateNames[state]}
        checked={preferences.includeStates.includes(state)}
        onChange={() => commit('Change calendar state filters', (draft) => {
          const values = draft.calendarPreferences.includeStates;
          const index = values.indexOf(state);
          if (index >= 0) values.splice(index, 1); else values.push(state);
        })}
      />)}
    </div>
    {selected.size > 0 && <Surface variant="muted" className="selection-bar">
      <strong>{selected.size} selected</strong>
      <Button size="compact" onClick={() => {
        const earliest = Math.min(...selectedRows.map((row) => new Date(row.schedule.startAt ?? row.schedule.dueAt!).getTime()));
        setMoveTarget(dateInput(new Date(earliest).toISOString()));
        setMoveDialog(true);
      }}>Move selected…</Button>
      <Button size="compact" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
    </Surface>}
    <div className="calendar-layout">
      <Surface className="calendar-main-panel"><FullCalendar ref={calendarRef} plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]} initialDate={now} now={now.toISOString()} initialView={mode === 'month' ? 'dayGridMonth' : mode === 'week' ? 'timeGridWeek' : mode === 'day' ? 'timeGridDay' : mode === 'three_day' ? 'timeGridThreeDay' : 'listYear'} views={{ timeGridThreeDay: { type: 'timeGrid', duration: { days: 3 } } }} headerToolbar={false} events={events} editable eventResizableFromStart selectable selectMirror droppable nowIndicator weekends={preferences.weekends} firstDay={preferences.weekStartsOn} slotMinTime="00:00:00" slotMaxTime="24:00:00" scrollTime={`${preferences.sleepSchedule.wake}:00`} scrollTimeReset={false} slotHeaderContent={(info) => info.isTime ? `${info.date.getHours()}:${String(info.date.getMinutes()).padStart(2, '0')}` : info.text} slotLaneClass={(info) => [info.isMajor ? 'calendar-hour-line' : 'calendar-half-hour-line', isSleepTime(info.date, preferences.sleepSchedule) ? 'calendar-sleep-slot' : ''].filter(Boolean).join(' ')} slotHeaderClass={(info) => info.isTime && isSleepTime(info.date, preferences.sleepSchedule) ? 'calendar-sleep-label' : ''} snapDuration={`00:${String(preferences.snapMinutes).padStart(2, '0')}:00`} slotDuration="00:30:00" longPressDelay={420} eventLongPressDelay={420} selectLongPressDelay={420} height="auto" datesSet={(info: DatesSetInfo) => setRange((current) => current.start.getTime() === info.start.getTime() && current.end.getTime() === info.end.getTime() ? current : { start: info.start, end: info.end })} dateClick={(info: DateClickInfo) => createDraftForRange(info.date, null, info.allDay)} select={handleSelect} eventClick={handleEventClick} eventDrop={handleDrop} eventResize={handleResize} eventReceive={handleExternal} eventContent={(info) => { const row = info.event.extendedProps.row as ProjectedOccurrence | undefined; return <span className="calendar-event-content"><i aria-hidden>{selected.has(info.event.id) ? '✓' : ''}</i><span>{info.event.title}</span>{row?.schedule.dueAt && !row.dueOnly && <b title="Has deadline">◆</b>}</span>; }} eventDidMount={(info) => { let timer = 0; info.el.addEventListener('touchstart', () => { timer = window.setTimeout(() => setSelected((current) => new Set(current).add(info.event.id)), 460); }, { passive: true }); info.el.addEventListener('touchend', () => window.clearTimeout(timer), { passive: true }); }} /></Surface>
      <Surface ref={unscheduledRef} role="complementary" className={`unscheduled-panel ${unscheduledOpen ? 'open' : ''}`}>
        <header><div><h2>Unscheduled</h2><p>Drag an item into the calendar.</p></div><IconButton size="compact" variant="ghost" className="mobile-unscheduled-close" aria-label="Close unscheduled items" onClick={() => setUnscheduledOpen(false)}><CloseIcon /></IconButton></header>
        <div>{unscheduled.map((item) => <Button variant="ghost" className="unscheduled-item" data-item-id={item.id} data-title={item.title} key={item.id} onClick={() => onEditItem(item)}><span>{item.title}</span><small>{inferredPreset(item)}</small></Button>)}{!unscheduled.length && <p className="empty">Everything has a date.</p>}</div>
      </Surface>
    </div>
    <ResponsiveDialog
      open={Boolean(quickDraft)}
      onOpenChange={(open) => { if (!open) setQuickDraft(null); }}
      title="New calendar item"
      closeLabel="Close quick create"
      className="quick-event"
      initialFocus
      footer={quickDraft && <><Button onClick={() => { onEditItem(quickDraft); setQuickDraft(null); }}>More options</Button><Button variant="primary" disabled={!quickDraft.title.trim()} onClick={() => { commit('Create calendar item', (draft) => { draft.items[quickDraft.id] = clean({ ...quickDraft, title: quickDraft.title.trim() }); }); setQuickDraft(null); }}>Save</Button></>}
    >
      {quickDraft && <div className="calendar-dialog-fields">
        <Field label="Title"><Input value={quickDraft.title} onChange={(event) => setQuickDraft({ ...quickDraft, title: event.target.value })} /></Field>
        <div className="calendar-field-grid">
          <Field label="Start"><Input type="datetime-local" value={dateInput(quickDraft.schedule?.startAt)} onChange={(event) => patchQuickSchedule('startAt', event.target.value)} /></Field>
          <Field label="End"><Input type="datetime-local" value={dateInput(quickDraft.schedule?.endAt)} onChange={(event) => patchQuickSchedule('endAt', event.target.value)} /></Field>
        </div>
        <Field label="Priority"><Select value={quickDraft.priority ?? 0} onChange={(event) => setQuickDraft({ ...quickDraft, priority: Number(event.target.value) as NonNullable<UniversalItem['priority']> })}>{[0, 1, 2, 3, 4].map((value) => <option value={value} key={value}>{value === 0 ? 'None' : priorityNames[value as 1 | 2 | 3 | 4]}</option>)}</Select></Field>
      </div>}
    </ResponsiveDialog>
    <ResponsiveDialog open={Boolean(pendingMove)} onOpenChange={(open) => { if (!open) setPendingMove(null); }} title="Move repeating item" closeLabel="Cancel recurring move">
      {pendingMove && <><p>{pendingMove.rows.length > 1 ? 'Choose one scope for the selected recurring items. You can move individual rows separately afterwards.' : 'Which part of the series should move?'}</p><div className="scope-actions"><Button onClick={() => applyMove(pendingMove.rows, pendingMove.deltaMs, 'this_occurrence')}>This occurrence</Button><Button onClick={() => applyMove(pendingMove.rows, pendingMove.deltaMs, 'this_and_future')}>This and future</Button><Button onClick={() => applyMove(pendingMove.rows, pendingMove.deltaMs, 'entire_series')}>Entire series</Button></div></>}
    </ResponsiveDialog>
    <ResponsiveDialog open={moveDialog} onOpenChange={setMoveDialog} title="Move selected items" closeLabel="Close move dialog" footer={<><Button onClick={() => setMoveDialog(false)}>Cancel</Button><Button variant="primary" onClick={performKeyboardMove}>Move group</Button></>}>
      <p>Set the new date and time for the earliest selected item. Every selected item keeps the same relative distance.</p>
      <Field label="New start"><Input type="datetime-local" value={moveTarget} onChange={(event) => setMoveTarget(event.target.value)} /></Field>
    </ResponsiveDialog>
    {undoItems && <div className="calendar-undo" role="status"><span>Calendar change saved</span><Button size="compact" onClick={() => { commit('Undo calendar operation', (draft) => { draft.items = clean(undoItems); }); setUndoItems(null); }}>Undo</Button></div>}
    <ResponsiveDialog open={calendarSettingsOpen} onOpenChange={setCalendarSettingsOpen} title="Calendar settings" closeLabel="Close calendar settings">
      <div className="calendar-dialog-fields">
        <Field label="Timezone"><Input value={preferences.timezone} onChange={(event) => commit('Change calendar timezone', (draft) => { draft.calendarPreferences.timezone = event.target.value; })} /></Field>
        <div className="calendar-field-grid">
          <Field label="Wake time"><Input type="time" value={preferences.sleepSchedule.wake} onChange={(event) => commit('Change wake time', (draft) => { draft.calendarPreferences.sleepSchedule.wake = event.target.value; })} /></Field>
          <Field label="Sleep time"><Input type="time" value={preferences.sleepSchedule.sleep} onChange={(event) => commit('Change sleep time', (draft) => { draft.calendarPreferences.sleepSchedule.sleep = event.target.value; })} /></Field>
          <Field label="Snap minutes"><Input type="number" min="5" step="5" value={preferences.snapMinutes} onChange={(event) => commit('Change calendar snap', (draft) => { draft.calendarPreferences.snapMinutes = Math.max(5, Number(event.target.value) || 15); })} /></Field>
          <Field label="Default duration"><Input type="number" min="5" step="5" value={preferences.defaultDurationMinutes} onChange={(event) => commit('Change default duration', (draft) => { draft.calendarPreferences.defaultDurationMinutes = Math.max(5, Number(event.target.value) || 30); })} /></Field>
        </div>
        <p className="ui-field-hint">The full 24-hour day stays available. Time between Sleep and Wake is shaded in the calendar.</p>
        <Checkbox label="Show weekends" checked={preferences.weekends} onChange={(event) => commit('Toggle calendar weekends', (draft) => { draft.calendarPreferences.weekends = event.target.checked; })} />
        <Field label="Week starts"><Select value={preferences.weekStartsOn} onChange={(event) => commit('Change first weekday', (draft) => { draft.calendarPreferences.weekStartsOn = Number(event.target.value) as 0 | 1; })}><option value="1">Monday</option><option value="0">Sunday</option></Select></Field>
      </div>
    </ResponsiveDialog>
  </section>;
}
