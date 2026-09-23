import { WeatherTimeline } from '../weather/WeatherTimeline';
import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { calendarDateKey, effectiveWorkspaceNow, type UniversalItem, type WorkspaceDocument } from '@utm/core';
import { LineIcon } from '../../components/ui/icons';
import { PersistedDetails, persistUiBoolean, readUiBoolean } from '../../components/ui/PersistedDetails';
import { SearchableDisclosureList } from '../../components/ui/SearchableDisclosureList';
import { ResponsiveDialog } from '../../components/ui/ResponsiveDialog';
import { Button } from '../../components/ui/primitives';
import { ItemCard } from '../items/ItemCard';
import { clockService } from '../../services/clockService';
import { displayViewValue, readItemField } from '../items/fieldDisplay';
import { timelineData } from './timelineData';
import { calendarUndatedItems } from './calendarVisibility';
import { buildSegments, layoutEvents, positionAt, type Segment } from './timelineLayout';
import './timeline.css';

const timeFormatters = new Map<string, Intl.DateTimeFormat>();
const timeLabel = (at: number, zone: string) => {
  let formatter = timeFormatters.get(zone);
  if (!formatter) {
    if (timeFormatters.size >= 8) timeFormatters.clear();
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    timeFormatters.set(zone, formatter);
  }
  return formatter.format(at);
};

export function TimelineNow({ workspace, segments, suppliedNow }: { workspace: WorkspaceDocument; segments: Segment[]; suppliedNow?: Date | undefined }) {
  const subscribe = useCallback((listener: () => void) => suppliedNow ? () => undefined : clockService.subscribe(listener, 60_000), [suppliedNow]);
  const snapshot = useCallback(() => Math.floor(effectiveWorkspaceNow(workspace, new Date(clockService.getSnapshot())).getTime() / 60_000), [workspace]);
  const minute = useSyncExternalStore(subscribe, snapshot, snapshot);
  const at = suppliedNow?.getTime() ?? minute * 60_000;
  const segment = segments.find(v => at >= v.start && at < v.end);
  if (!segment) return null;
  const top = segment.hidden ? segment.top + segment.height / 2 : positionAt(at, segments);
  return <div className={`timeline-now${segment.hidden ? ' is-hidden-time' : ''}`} style={{ top }} data-testid="timeline-now" aria-label={`Current time ${timeLabel(at, workspace.calendarPreferences.timezone)}`}><span>{timeLabel(at, workspace.calendarPreferences.timezone)}</span></div>;
}

export const CalendarTimeline = memo(function CalendarTimeline({ workspace, dateKey, now, suppliedNow, onEdit, onState, onPreferences }: {
  workspace: WorkspaceDocument; dateKey: string; now: Date; suppliedNow?: Date | undefined;
  onEdit: (item: UniversalItem) => void;
  onState?: ((item: UniversalItem, state: UniversalItem['state']) => void) | undefined;
  onPreferences: (settings: NonNullable<WorkspaceDocument['calendarPreferences']['timeline']>) => void;
}) {
  const ru = workspace.calendarPreferences.language === 'ru';
  const zone = workspace.calendarPreferences.timezone;
  const settings = workspace.calendarPreferences.timeline ?? { mode: 'timeline' as const, hideSleep: false };
  const [allDayOpen, setAllDayOpen] = useState(() => readUiBoolean('calendar:all-day', true));
  const [more, setMore] = useState<UniversalItem[]>([]);
  const [columns, setColumns] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 620px)').matches ? 2 : 4);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 620px)');
    const change = () => setColumns(media.matches ? 2 : 4);
    change(); media.addEventListener('change', change); return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => { setMore([]); }, [dateKey]);
  const data = useMemo(() => timelineData(workspace, dateKey, now), [workspace, dateKey, now.getTime()]);
  const undatedCount = useMemo(() => calendarUndatedItems(workspace, now).length, [workspace, now.getTime()]);
  const segments = useMemo(() => buildSegments(data.day, data.hidden), [data]);
  const layout = useMemo(() => layoutEvents(data.events, data.day, segments, columns), [data, segments, columns]);
  const height = Math.max((segments.at(-1)?.top ?? 0) + (segments.at(-1)?.height ?? 0), ...layout.events.map(v => v.top + v.height), ...layout.more.map(v => v.top + v.height));
  const sleepCandidates = Object.values(workspace.items).filter(item => !item.deletedAt && item.role !== 'occurrence' && item.schedule && !item.schedule.allDay);
  const selectedSleep = settings.sleepItemId ? workspace.items[settings.sleepItemId] : undefined;
  const ticks: number[] = [];
  for (let at = data.day.start; at < data.day.end; at += 60_000) if (timeLabel(at, zone).endsWith(':00') && !data.hidden.some(v => at >= v.start && at < v.end)) ticks.push(at);
  const columnStyle = (v: { top: number; height: number; column: number; columns: number }) => ({ top: v.top, height: v.height, left: `${v.column / v.columns * 100}%`, width: `${100 / v.columns}%` });
  const open = (item: UniversalItem) => { setMore([]); onEdit(item); };
  const durationLabel = (ms: number) => displayViewValue(`PT${Math.round(Math.abs(ms) / 1000)}S`, 'schedule.estimatedDuration', workspace.calendarPreferences.language);
  const cards = (items: UniversalItem[]) => <div className="item-list">{items.map(item => <ItemCard key={item.id} item={item} workspace={workspace} now={now} fields={workspace.calendarPreferences.dayView.fields} onEdit={() => open(item)} onState={state => onState?.(item, state)} />)}</div>;
  return <section className="calendar-timeline" aria-label="Timeline">
    <div className="timeline-toolbar">
      {data.overdue.length > 0 && <Button size="compact" aria-pressed={settings.showOverdue !== false} onClick={() => onPreferences({ ...settings, showOverdue: settings.showOverdue === false })}>{ru ? 'Просрочено' : 'Overdue'} · {data.overdue.length}</Button>}
      <Button size="compact" aria-pressed={settings.showUndated === true} onClick={() => onPreferences({ ...settings, showUndated: settings.showUndated !== true })}>{ru ? 'Без даты' : 'No date'}{undatedCount ? ` · ${undatedCount}` : ''}</Button>
      {data.allDay.length > 0 && <Button size="compact" aria-pressed={allDayOpen} onClick={() => { persistUiBoolean('calendar:all-day', !allDayOpen); setAllDayOpen(!allDayOpen); }}>{ru ? 'Весь день' : 'All day'} · {data.allDay.length}</Button>}
      <details><summary>{ru ? 'Настройки Timeline' : 'Timeline settings'}</summary><div className="timeline-sleep-settings">
        {workspace.calendarPreferences.showExplanations && <><p className="hint">{ru ? 'Duration недатированных задач учитывается в предварительном плане. Даты задач не меняются.' : 'Undated task durations count towards tentative planning. Item dates stay unchanged.'}</p><p>{ru ? 'Сжимается только свободная часть времени выбранного item.' : 'Only unoccupied time of the selected item is collapsed.'}</p></>}
        <p className="timeline-selected-sleep">{ru ? 'Сон: ' : 'Sleep: '}{selectedSleep?.title ?? (ru ? 'не выбран' : 'none')}</p>
        <Button size="compact" onClick={() => { const { sleepItemId: _id, ...rest } = settings; onPreferences({ ...rest, hideSleep: false }); }}>{ru ? 'Без исключения' : 'None'}</Button>
        <SearchableDisclosureList uiKey="timeline:sleep-picker" summary={ru ? 'Выбрать другой item…' : 'Choose another item…'} items={sleepCandidates} getSearchText={item => item.title} searchLabel={ru ? 'Найти item сна' : 'Find sleep item'} renderItem={item => <Button size="compact" key={item.id} aria-pressed={item.id === settings.sleepItemId} onClick={event => { onPreferences({ ...settings, sleepItemId: item.id, hideSleep: true }); event.currentTarget.closest('details')?.removeAttribute('open'); }}>{item.title}</Button>} />
      </div></details>
    </div>
    {data.sleepMissing && <p className="hint">{ru ? 'Нет интервала сна на этот день. Показаны полные сутки.' : 'No sleep interval for this day. Showing the full day.'}</p>}
    {data.projectionLimited && <p role="status">{ru ? 'Для повторений с длительностью более года показана ограниченная проекция.' : 'Recurrences longer than one year use a limited projection.'}</p>}
    {(data.planning.taskDurationMs > 0 || data.planning.overdueDurationMs > 0) && <div className="timeline-planning-summary" data-testid="timeline-planning-summary">
      <span>{ru ? 'Свободно по календарю' : 'Calendar free'}: {durationLabel(data.planning.calendarFreeMs)}</span>
      <strong>{data.planning.remainingMs < 0 ? (ru ? 'Не хватает' : 'Short by') : (ru ? 'Останется после задач' : 'After tasks')}: {durationLabel(data.planning.remainingMs)}</strong>
      {data.planning.overdueDurationMs > 0 && <strong>{ru ? 'После просроченных' : 'After overdue'}: {data.planning.remainingAfterOverdueMs < 0 ? '−' : ''}{durationLabel(data.planning.remainingAfterOverdueMs)}</strong>}
      {workspace.calendarPreferences.showExplanations && <small>{ru ? 'За выбранные сутки. Точечные блоки — предложение, даты задач не меняются.' : 'For the selected day. Dotted blocks are proposals; task dates stay unchanged.'}</small>}
      {dateKey === calendarDateKey(now, zone) && <span>{ru ? 'Сейчас до конца дня, после задач' : 'From now until day end, after tasks'}: {data.planning.remainingTodayMs < 0 ? '−' : ''}{durationLabel(data.planning.remainingTodayMs)}</span>}
      {data.planning.warnings.map(({ item, reason }) => <small key={item.id}>{item.title}: {reason === 'deadline' ? (ru ? 'Не помещается до Due' : 'Does not fit before Due') : reason === 'fragmented' ? (ru ? 'Времени суммарно хватает, но нет непрерывного окна' : 'Enough total time, but no continuous slot') : (ru ? 'Недостаточно свободного времени' : 'Not enough available time')}</small>)}
      {data.planning.unplaced.length > 0 && <small>{ru ? 'Не поместились целиком в свободные промежутки; показаны над шкалой' : 'No continuous slot; shown above the timeline'}: {data.planning.unplaced.length}</small>}
    </div>}
    {data.activeRange.length > 0 && <div className="timeline-top-items"><h2>{ru ? 'Активный диапазон' : 'Active range'}</h2>{cards(data.activeRange)}</div>}
    {data.plannedTasks.length > 0 && <div className="timeline-top-items"><h2>{ru ? 'Задачи на день' : 'Day tasks'}</h2>{cards(data.plannedTasks)}</div>}
    {data.allDay.length > 0 && allDayOpen && <div className="timeline-top-items timeline-all-day-items">{cards(data.allDay)}</div>}
    {data.undated.length > 0 && <PersistedDetails uiKey="calendar:no-date" defaultOpen={false} className="timeline-top-items"><summary>{ru ? 'Без даты' : 'No date'} · {data.undated.length}</summary>{cards(data.undated)}</PersistedDetails>}
    <div className="timeline-axis" style={{ height: height + 12 }}>
      <WeatherTimeline dateKey={dateKey} zone={zone} ru={ru} segments={segments} />
      {ticks.map(at => <div key={at} className="timeline-tick" style={{ top: positionAt(at, segments) }}><span>{timeLabel(at, zone)}</span></div>)}
      {segments.filter(v => v.hidden).map(v => <button type="button" key={v.start} className="timeline-break" style={{ top: v.top, height: v.height }} aria-expanded={false} onClick={() => onPreferences({ ...settings, hideSleep: false })}>{ru ? 'Скрыто' : 'Hidden'} {timeLabel(v.start, zone)}–{timeLabel(v.end, zone)}</button>)}
      {!settings.hideSleep && data.sleepGaps.length > 0 && <button type="button" className="timeline-night-collapse" style={{ top: positionAt(data.sleepGaps[0]!.start, segments) }} aria-expanded={true} onClick={() => onPreferences({ ...settings, hideSleep: true })}>{ru ? 'Свернуть ночь' : 'Collapse night'} {timeLabel(data.sleepGaps[0]!.start, zone)}–{timeLabel(data.sleepGaps.at(-1)!.end, zone)}</button>}
      <div className="timeline-events">
        {layout.events.map(event => {
          const organization = event.item.extensions?.['utm:calendarOrganization'] as { color?: string; tag?: string } | undefined;
          const calendar = workspace.calendarPreferences.googleCalendar?.calendars.find(value => value.id === event.item.external?.calendarId);
          const color = calendar?.color ?? organization?.color;
          const safeColor = color && /^#[0-9a-f]{6}$/i.test(color) ? color : undefined;
          const extra = !event.travel && event.height >= 72 ? workspace.calendarPreferences.dayView.fields.filter(field => field !== 'title' && field !== 'external.provider').map(field => {
            const value = field === 'schedule.estimatedDuration' && !event.point ? `PT${Math.round((event.end - event.start) / 1000)}S` : readItemField(event.item, field, workspace, now);
            return { field, text: displayViewValue(value, field, workspace.calendarPreferences.language) };
          }).filter(entry => entry.text) : [];
          const interval = `${timeLabel(event.start, zone)}${event.point ? '' : `–${timeLabel(event.end, zone)}`}`;
          const travelLabel = event.travel ? `${event.travelBack ? (ru ? 'Обратно' : 'Travel back') : (ru ? 'В пути' : 'Travel')} · ${displayViewValue(`PT${Math.round((event.end - event.start) / 1000)}S`, 'schedule.travelDuration', workspace.calendarPreferences.language)}` : '';
          const tentativeLabel = event.tentative ? (ru ? 'Предварительно · ' : 'Tentative · ') : '';
          const overdue = event.item.state === 'open' && event.item.schedule?.plannedDate && event.item.schedule.plannedDate < calendarDateKey(now, zone);
          const label = `${tentativeLabel}${travelLabel ? `${travelLabel} · ` : ''}${event.item.title} · ${interval}`;
          return <button type="button" data-utm-due-item-id={event.item.external?.readOnly ? undefined : event.item.id} data-utm-due-series-id={event.item.occurrence?.seriesId} data-utm-due-recurrence-id={event.item.occurrence?.recurrenceId} key={`${event.item.id}:${event.travelBack ? 'travel-back' : event.travel ? 'travel' : 'event'}`} className={`timeline-event${event.travel ? ' timeline-travel' : ''}${event.tentative ? ' timeline-tentative' : ''}${event.tentativeOverdue ? ' timeline-tentative-overdue' : ''}`} style={{ ...columnStyle(event), ...(safeColor && !event.tentativeOverdue ? { borderColor: safeColor } : {}) }} onClick={() => open(event.item)} title={label} aria-label={label} data-testid={event.travelBack ? 'timeline-travel-back' : event.travel ? 'timeline-travel' : event.tentative ? 'timeline-tentative' : 'timeline-event'}>
            <strong>{(event.invalid || overdue) && '⚠ '}{event.continuedBefore && '← '}{travelLabel ? `${travelLabel} · ` : ''}{event.item.title || (ru ? 'Без названия' : 'Untitled')}{event.continuedAfter && ' →'}</strong>
            {overdue && event.height >= 72 && <small>{ru ? 'Не выполнено в плановый день' : 'Planned day missed'}: {event.item.schedule?.plannedDate}</small>}
            {event.height >= 54 && <small>{tentativeLabel}{interval}</small>}{extra.map(({ field, text }, i) => <small key={i} style={safeColor && (field === 'tags' || field === 'external.calendarId') ? { color: safeColor } : undefined}>{text}</small>)}
            {!event.travel && event.height >= 72 && event.item.external && <small className="timeline-calendar-source" style={safeColor ? { color: safeColor } : undefined}><span aria-label="Google Calendar" title="Google Calendar"><LineIcon name="calendarSync" /></span>{calendar?.name ?? organization?.tag}</small>}
          </button>;
        })}
        {layout.more.map((block, i) => <button type="button" key={i} className="timeline-event timeline-more" style={columnStyle(block)} onClick={() => setMore(block.items)}>More · {block.items.length}</button>)}
      </div>
      <TimelineNow workspace={workspace} segments={segments} suppliedNow={suppliedNow} />
    </div>
    <ResponsiveDialog open={more.length > 0} onOpenChange={value => { if (!value) setMore([]); }} title={ru ? 'Пересекающиеся события' : 'Overlapping items'} ariaLabel="Timeline overlapping items">
      <div className="timeline-more-list">{more.map(item => <Button key={item.id} onClick={() => open(item)}>{item.title}</Button>)}</div>
    </ResponsiveDialog>
  </section>;
});
