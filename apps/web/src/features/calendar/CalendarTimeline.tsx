import { WeatherTimeline } from '../weather/WeatherTimeline';
import { calendarTimelineFields } from './calendarCardFields';
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type TouchEvent } from 'react';
import { activeRangeDailyDuration, calendarDateKey, effectiveWorkspaceNow, occupiedIntervals, viewPeriodBoundsForDates, zonedDateTime, type UniversalItem, type WorkspaceDocument } from '@utm/core';
import { LineIcon } from '../../components/ui/icons';
import { PersistedDetails, persistUiBoolean, readUiBoolean } from '../../components/ui/PersistedDetails';
import { ResponsiveDialog } from '../../components/ui/ResponsiveDialog';
import { Button } from '../../components/ui/primitives';
import { ItemCard } from '../items/ItemCard';
import { clockService } from '../../services/clockService';
import { displayViewValue, readItemField, viewFieldLabel } from '../items/fieldDisplay';
import { FieldIcon } from '../items/FieldIcon';
import { prepareTimelineData, applyTimelinePlanning } from './timelineData';
import type { CalendarProjectionCache } from './calendarProjectionCache';
import { calendarUndatedItems } from './calendarVisibility';
import { buildSegments, layoutEvents, placeActiveRangeCues, positionAt, type Segment } from './timelineLayout';
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

export const CalendarTimeline = memo(function CalendarTimeline({ workspace, dateKey, now, planningNow = now, suppliedNow, projectionCache, capacityLabel, reservedItems = [], allDayOpen, onAllDayChange, onEdit, onState, onPreferences, onSwipeDay, onCreateAt }: {
  workspace: WorkspaceDocument; dateKey: string; now: Date; suppliedNow?: Date | undefined;
  capacityLabel?: string; allDayOpen?: boolean; onAllDayChange?: (open: boolean) => void;
  reservedItems?: UniversalItem[];
  projectionCache?: CalendarProjectionCache;
  planningNow?: Date;
  onEdit: (item: UniversalItem) => void;
  onState?: ((item: UniversalItem, state: UniversalItem['state']) => void) | undefined;
  onPreferences: (settings: NonNullable<WorkspaceDocument['calendarPreferences']['timeline']>) => void;
  onSwipeDay?: (direction: -1 | 1) => void;
  onCreateAt?: (at: number) => void;
}) {
  const ru = workspace.calendarPreferences.language === 'ru';
  const zone = workspace.calendarPreferences.timezone;
  const settings = workspace.calendarPreferences.timeline ?? { mode: 'timeline' as const, hideSleep: false };
  const cardFields = calendarTimelineFields(workspace.calendarPreferences.dayView);
  allDayOpen ??= readUiBoolean('calendar:all-day', true);
  const [more, setMore] = useState<UniversalItem[]>([]);
  const swipeStart = useRef<{ x: number; y: number; at: number } | null>(null);
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const cancelHold = () => { if (hold.current) clearTimeout(hold.current.timer); hold.current = null; };
  useEffect(() => cancelHold, [dateKey]);
  const beginBackgroundSwipe = (event: TouchEvent<HTMLDivElement>) => {
    swipeStart.current = null;
    if (!onSwipeDay || event.touches.length !== 1 || !(event.target instanceof Element)) return;
    if (event.target.closest('button, a, input, select, textarea, [data-utm-due-item-id], [role="button"]')) return;
    swipeStart.current = { x: event.touches[0]!.clientX, y: event.touches[0]!.clientY, at: Date.now() };
  };
  const endBackgroundSwipe = (event: TouchEvent<HTMLDivElement>) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start || !onSwipeDay || event.changedTouches.length !== 1) return;
    const dx = event.changedTouches[0]!.clientX - start.x;
    const dy = event.changedTouches[0]!.clientY - start.y;
    if (Math.abs(dx) >= 65 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - start.at < 900) onSwipeDay(dx < 0 ? 1 : -1);
  };
  const [columns, setColumns] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 620px)').matches ? 2 : 4);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 620px)');
    const change = () => setColumns(media.matches ? 2 : 4);
    change(); media.addEventListener('change', change); return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => { setMore([]); }, [dateKey]);
  const prepared = useMemo(() => prepareTimelineData(workspace, dateKey, now, projectionCache), [workspace, dateKey, now.getTime(), projectionCache]);
  const data = useMemo(() => applyTimelinePlanning(prepared, planningNow), [prepared, planningNow.getTime()]);
  const undatedCount = useMemo(() => calendarUndatedItems(workspace, now).length, [workspace, now.getTime()]);
  const segments = useMemo(() => buildSegments(data.day, data.hidden), [data]);
  const layout = useMemo(() => layoutEvents(data.events, data.day, segments, columns), [data, segments, columns]);
  const hiddenReserve = useMemo(() => {
    const period = viewPeriodBoundsForDates(dateKey, dateKey, zone);
    return reservedItems.flatMap(item => activeRangeDailyDuration(item, period) !== null ? [] : occupiedIntervals(item, period).flatMap(interval => segments.filter(segment => !segment.hidden && segment.start < interval.end && segment.end > interval.start).map(segment => {
      const start = Math.max(interval.start, segment.start), end = Math.min(interval.end, segment.end);
      return { id: `${item.id}:${start}`, title: item.title, top: positionAt(start, segments), height: Math.max(2, positionAt(end, segments) - positionAt(start, segments)) };
    })));
  }, [reservedItems, dateKey, zone, segments]);
  const rangeCues = useMemo(() => {
    const morning = zonedDateTime(dateKey, 9, 0, zone).getTime();
    const preferred = dateKey === calendarDateKey(planningNow, zone) ? Math.max(morning, Math.floor(planningNow.getTime() / 3_600_000) * 3_600_000) : morning;
    return placeActiveRangeCues(data.activeRange, segments, [...layout.events, ...layout.more, ...hiddenReserve], positionAt(preferred, segments));
  }, [data.activeRange, segments, layout, hiddenReserve, dateKey, zone, planningNow]);
  const rangeFallback = data.activeRange.filter(item => !rangeCues.some(cue => cue.item.id === item.id));
  const height = Math.max((segments.at(-1)?.top ?? 0) + (segments.at(-1)?.height ?? 0), ...layout.events.map(v => v.top + v.height), ...layout.more.map(v => v.top + v.height));
  const ticks: number[] = [];
  for (let at = data.day.start; at < data.day.end; at += 60_000) if (timeLabel(at, zone).endsWith(':00') && !data.hidden.some(v => at >= v.start && at < v.end)) ticks.push(at);
  const columnStyle = (v: { top: number; height: number; column: number; columns: number }) => ({ top: v.top, height: v.height, left: `${v.column / v.columns * 100}%`, width: `${100 / v.columns}%` });
  const open = (item: UniversalItem) => { setMore([]); onEdit(item); };
  const durationLabel = (ms: number) => displayViewValue(`PT${Math.round(Math.abs(ms) / 1000)}S`, 'schedule.estimatedDuration', workspace.calendarPreferences.language);
  const cards = (items: UniversalItem[]) => <div className="item-list">{items.map(item => <ItemCard key={item.id} item={item} workspace={workspace} now={now} fields={cardFields} calendarTimeOnly onEdit={() => open(item)} onState={state => onState?.(item, state)} />)}</div>;
  return <section className="calendar-timeline" aria-label="Timeline">
    <div className="timeline-toolbar">
      {data.overdue.length > 0 && <Button size="compact" aria-pressed={settings.showOverdue !== false} onClick={() => onPreferences({ ...settings, showOverdue: settings.showOverdue === false })}>{ru ? 'Просрочено' : 'Overdue'} · {data.overdue.length}</Button>}
      <Button size="compact" aria-pressed={settings.showUndated === true} onClick={() => onPreferences({ ...settings, showUndated: settings.showUndated !== true })}>{ru ? 'Без даты' : 'No date'}{undatedCount ? ` · ${undatedCount}` : ''}</Button>
      {data.allDay.length > 0 && <Button size="compact" aria-pressed={allDayOpen} onClick={() => { persistUiBoolean('calendar:all-day', !allDayOpen); onAllDayChange?.(!allDayOpen); }}>{ru ? 'Весь день' : 'All day'} · {data.allDay.length}</Button>}
    </div>
    {data.sleepMissing && <p className="hint">{ru ? 'Нет интервала сна на этот день. Показаны полные сутки.' : 'No sleep interval for this day. Showing the full day.'}</p>}
    {data.projectionLimited && <p role="status">{ru ? 'Для повторений с длительностью более года показана ограниченная проекция.' : 'Recurrences longer than one year use a limited projection.'}</p>}
    {workspace.calendarPreferences.dayView.statistics?.showTime !== false && <div className="timeline-planning-summary" data-testid="timeline-planning-summary">
      <strong>{capacityLabel ?? (ru ? 'Свободно' : 'Free')}</strong>
      {workspace.calendarPreferences.showExplanations && <small>{ru ? 'За выбранные сутки. Точечные блоки — предложение, даты задач не меняются.' : 'For the selected day. Dotted blocks are proposals; task dates stay unchanged.'}</small>}
      {workspace.calendarPreferences.showExplanations && data.planning.warnings.map(({ item, reason }) => <small key={item.id}>{item.title}: {reason === 'deadline' ? (ru ? 'Не помещается до Due' : 'Does not fit before Due') : reason === 'fragmented' ? (ru ? 'Времени суммарно хватает, но нет непрерывного окна' : 'Enough total time, but no continuous slot') : (ru ? 'Недостаточно свободного времени' : 'Not enough available time')}</small>)}
    </div>}
    {rangeFallback.length > 0 && <div className="timeline-top-items"><h2>{ru ? 'Активный диапазон' : 'Active range'}</h2>{cards(rangeFallback)}</div>}
    {data.plannedTasks.length > 0 && <div className="timeline-top-items"><h2>{ru ? 'Задачи на день' : 'Day tasks'}</h2>{cards(data.plannedTasks)}</div>}
    {data.allDay.length > 0 && allDayOpen && <div className="timeline-top-items timeline-all-day-items">{cards(data.allDay)}</div>}
    {data.undated.length > 0 && <PersistedDetails uiKey="calendar:no-date" defaultOpen={false} className="timeline-top-items"><summary>{ru ? 'Без даты' : 'No date'} · {data.undated.length}</summary>{cards(data.undated)}</PersistedDetails>}
    <div className="timeline-axis" style={{ height: height + 12 }} onTouchStart={beginBackgroundSwipe} onTouchEnd={endBackgroundSwipe} onTouchCancel={() => { swipeStart.current = null; cancelHold(); }}
      onPointerDown={event => {
        cancelHold();
        if (!onCreateAt || !event.isPrimary || event.button !== 0 || !(event.target instanceof Element) || event.target.closest('button, input, textarea, a, [role="button"]')) return;
        const y = event.clientY - event.currentTarget.getBoundingClientRect().top;
        const tick = event.target.closest<HTMLElement>('[data-timeline-hour]');
        const segment = segments.find(part => y >= part.top && y < part.top + part.height);
        if (!tick && (!segment || segment.hidden)) return;
        const at = segment ? segment.start + (y - segment.top) / segment.height * (segment.end - segment.start) : 0;
        const hour = tick ? Number(tick.dataset.timelineHour) : [...ticks].reverse().find(value => value <= at);
        if (hour === undefined) return;
        hold.current = { x: event.clientX, y: event.clientY, timer: setTimeout(() => {
          hold.current = null; swipeStart.current = null;
          try { navigator.vibrate?.(20); } catch { /* Haptics are optional. */ }
          onCreateAt(hour);
        }, 550) };
      }}
      onPointerMove={event => { if (hold.current && Math.hypot(event.clientX - hold.current.x, event.clientY - hold.current.y) > 10) cancelHold(); }}
      onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerLeave={cancelHold}>
      <WeatherTimeline dateKey={dateKey} zone={zone} ru={ru} segments={segments} />
      <div className="timeline-hidden-reserves" aria-label={ru ? 'Скрытые закреплённые items' : 'Hidden reserved items'}>{hiddenReserve.map(reserve => <div className="timeline-hidden-reserve" data-testid="timeline-hidden-reserve" key={reserve.id} style={{ top: reserve.top, height: reserve.height }} title={reserve.title}><span>{reserve.title}</span></div>)}</div>
      <div className="timeline-active-ranges">{rangeCues.map(({ item, top, height }) => {
        const share = activeRangeDailyDuration(item, viewPeriodBoundsForDates(dateKey, dateKey, zone)) ?? 0;
        const label = `${ru ? 'Активный диапазон' : 'Active range'} · ${item.title}${share ? ` · ${durationLabel(share)}${ru ? ' на день' : ' per day'}` : ''}`;
        return <button type="button" className="timeline-active-range" key={item.id} data-testid="timeline-active-range" style={{ top, height }} title={label} aria-label={label} onClick={() => open(item)}><span>{item.title}</span>{share > 0 && <small>{durationLabel(share)}{ru ? ' / день' : ' / day'}</small>}</button>;
      })}</div>
      {ticks.map(at => <div key={at} data-timeline-hour={at} className="timeline-tick" style={{ top: positionAt(at, segments) }}><span>{timeLabel(at, zone)}</span></div>)}
      {segments.filter(v => v.hidden).map(v => <button type="button" key={v.start} className="timeline-break" style={{ top: v.top, height: v.height }} aria-expanded={false} onClick={() => onPreferences({ ...settings, hideSleep: false })}>{ru ? 'Скрыто' : 'Hidden'} {timeLabel(v.start, zone)}–{timeLabel(v.end, zone)}</button>)}
      {!settings.hideSleep && data.sleepGaps.length > 0 && <button type="button" className="timeline-night-collapse" style={{ top: positionAt(data.sleepGaps[0]!.start, segments) }} aria-expanded={true} onClick={() => onPreferences({ ...settings, hideSleep: true })}>{ru ? 'Свернуть ночь' : 'Collapse night'} {timeLabel(data.sleepGaps[0]!.start, zone)}–{timeLabel(data.sleepGaps.at(-1)!.end, zone)}</button>}
      <div className="timeline-events">
        {layout.events.map(event => {
          const organization = event.item.extensions?.['utm:calendarOrganization'] as { color?: string; tag?: string } | undefined;
          const calendar = workspace.calendarPreferences.googleCalendar?.calendars.find(value => value.id === event.item.external?.calendarId);
          const color = calendar?.color ?? organization?.color;
          const safeColor = color && /^#[0-9a-f]{6}$/i.test(color) ? color : undefined;
          const extra = !event.travel && event.height >= 72 ? cardFields.filter(field => field !== 'title' && field !== 'external.provider').map(field => {
            const value = field === 'schedule.estimatedDuration' && !event.point ? `PT${Math.round((event.end - event.start) / 1000)}S` : readItemField(event.item, field, workspace, now);
            return { field, text: displayViewValue(value, field, workspace.calendarPreferences.language) };
          }).filter(entry => entry.text) : [];
          const interval = `${timeLabel(event.start, zone)}${event.point ? '' : `–${timeLabel(event.end, zone)}`}`;
          const travelLabel = event.travel ? `${event.travelBack ? (ru ? 'Обратно' : 'Travel back') : (ru ? 'В пути' : 'Travel')} · ${displayViewValue(`PT${Math.round((event.end - event.start) / 1000)}S`, 'schedule.travelDuration', workspace.calendarPreferences.language)}` : '';
          const tentativeLabel = event.tentative ? (ru ? 'Предварительно · ' : 'Tentative · ') : '';
          const overdue = event.item.state === 'open' && event.item.schedule?.plannedDate && event.item.schedule.plannedDate < calendarDateKey(now, zone);
          const label = `${tentativeLabel}${travelLabel ? `${travelLabel} · ` : ''}${event.item.title} · ${interval}`;
          return <button type="button" data-utm-due-item-id={event.item.external?.readOnly ? undefined : event.item.id} data-utm-due-series-id={event.item.occurrence?.seriesId} data-utm-due-recurrence-id={event.item.occurrence?.recurrenceId} key={`${event.item.id}:${event.travelBack ? 'travel-back' : event.travel ? 'travel' : 'event'}`} className={`timeline-event${safeColor && !event.tentative ? ' timeline-calendar-tinted' : ''}${event.travel ? ' timeline-travel' : ''}${event.tentative ? ' timeline-tentative' : ''}${event.tentativeOverdue ? ' timeline-tentative-overdue' : ''}`} style={{ ...columnStyle(event), ...(safeColor && !event.tentativeOverdue ? { borderColor: safeColor, '--timeline-calendar-color': safeColor } : {}) } as CSSProperties} onClick={() => open(event.item)} title={label} aria-label={label} data-testid={event.travelBack ? 'timeline-travel-back' : event.travel ? 'timeline-travel' : event.tentative ? 'timeline-tentative' : 'timeline-event'}>
            <strong>{(event.invalid || overdue) && '⚠ '}{event.continuedBefore && '← '}{travelLabel ? `${travelLabel} · ` : ''}{event.item.title || (ru ? 'Без названия' : 'Untitled')}{event.continuedAfter && ' →'}</strong>
            {overdue && event.height >= 72 && <small>{ru ? 'Не выполнено в плановый день' : 'Planned day missed'}: {event.item.schedule?.plannedDate}</small>}
            {event.tentative && event.height >= 54 && <small>{tentativeLabel.trim()}</small>}{extra.map(({ field, text }, i) => <small className="timeline-property" key={i} style={safeColor && (field === 'tags' || field === 'external.calendarId') ? { color: safeColor } : undefined}><FieldIcon path={field} label={viewFieldLabel(workspace, field)} />{text}</small>)}
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
