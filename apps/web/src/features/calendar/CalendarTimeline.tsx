import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { effectiveWorkspaceNow, type UniversalItem, type WorkspaceDocument } from '@utm/core';
import { ResponsiveDialog } from '../../components/ui/ResponsiveDialog';
import { Button, Input } from '../../components/ui/primitives';
import { clockService } from '../../services/clockService';
import { displayViewValue, readItemField } from '../items/fieldDisplay';
import { timelineData } from './timelineData';
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

export const CalendarTimeline = memo(function CalendarTimeline({ workspace, dateKey, now, suppliedNow, onEdit, onPreferences }: {
  workspace: WorkspaceDocument; dateKey: string; now: Date; suppliedNow?: Date | undefined;
  onEdit: (item: UniversalItem) => void;
  onPreferences: (settings: NonNullable<WorkspaceDocument['calendarPreferences']['timeline']>) => void;
}) {
  const ru = workspace.calendarPreferences.language === 'ru';
  const zone = workspace.calendarPreferences.timezone;
  const settings = workspace.calendarPreferences.timeline ?? { mode: 'timeline' as const, hideSleep: false };
  const [search, setSearch] = useState('');
  const [more, setMore] = useState<UniversalItem[]>([]);
  const [columns, setColumns] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 620px)').matches ? 2 : 4);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 620px)');
    const change = () => setColumns(media.matches ? 2 : 4);
    change(); media.addEventListener('change', change); return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => { setMore([]); }, [dateKey]);
  const data = useMemo(() => timelineData(workspace, dateKey, now), [workspace, dateKey, now.getTime()]);
  const segments = useMemo(() => buildSegments(data.day, data.hidden), [data]);
  const layout = useMemo(() => layoutEvents(data.events, data.day, segments, columns), [data, segments, columns]);
  const height = Math.max((segments.at(-1)?.top ?? 0) + (segments.at(-1)?.height ?? 0), ...layout.events.map(v => v.top + v.height), ...layout.more.map(v => v.top + v.height));
  const sleepCandidates = Object.values(workspace.items).filter(item => !item.deletedAt && item.role !== 'occurrence' && item.schedule && !item.schedule.allDay && item.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const selectedSleep = settings.sleepItemId ? workspace.items[settings.sleepItemId] : undefined;
  const ticks: number[] = [];
  for (let at = data.day.start; at < data.day.end; at += 60_000) if (timeLabel(at, zone).endsWith(':00') && !data.hidden.some(v => at >= v.start && at < v.end)) ticks.push(at);
  const columnStyle = (v: { top: number; height: number; column: number; columns: number }) => ({ top: v.top, height: v.height, left: `${v.column / v.columns * 100}%`, width: `${100 / v.columns}%` });
  const open = (item: UniversalItem) => { setMore([]); onEdit(item); };
  return <section className="calendar-timeline" aria-label="Timeline">
    <div className="timeline-toolbar">
      <Button size="compact" aria-pressed={settings.hideSleep} onClick={() => onPreferences({ ...settings, hideSleep: !settings.hideSleep })}>{settings.hideSleep ? (ru ? 'Показать полные сутки' : 'Show full day') : (ru ? 'Скрывать сон' : 'Hide sleep')}</Button>
      <details><summary>{ru ? 'Настройки Timeline' : 'Timeline settings'}</summary><div className="timeline-sleep-settings">
        <p>{ru ? 'Сжимать свободное время выбранного item. Другие события остаются видимыми.' : 'Collapse unoccupied time of one item. Other events remain visible.'}</p>
        <p>{ru ? 'Выбрано: ' : 'Selected: '}{selectedSleep?.title ?? (ru ? 'ничего' : 'none')}</p>
        <Input aria-label={ru ? 'Найти item сна' : 'Find sleep item'} placeholder={ru ? 'Поиск' : 'Search'} value={search} onChange={event => setSearch(event.target.value)} />
        <div className="timeline-sleep-options"><Button size="compact" onClick={() => { const { sleepItemId: _id, ...rest } = settings; onPreferences({ ...rest, hideSleep: false }); }}>{ru ? 'Без исключения' : 'None'}</Button>{sleepCandidates.map(item => <Button size="compact" key={item.id} aria-pressed={item.id === settings.sleepItemId} onClick={() => onPreferences({ ...settings, sleepItemId: item.id, hideSleep: true })}>{item.title}</Button>)}</div>
      </div></details>
    </div>
    {data.sleepMissing && <p className="hint">{ru ? 'Нет интервала сна на этот день. Показаны полные сутки.' : 'No sleep interval for this day. Showing the full day.'}</p>}
    {data.projectionLimited && <p role="status">{ru ? 'Для повторений с длительностью более года показана ограниченная проекция.' : 'Recurrences longer than one year use a limited projection.'}</p>}
    {data.allDay.length > 0 && <div className="timeline-top-items"><h2>{ru ? 'Весь день' : 'All day'}</h2>{data.allDay.map(item => <Button key={item.id} onClick={() => open(item)}>{item.title}</Button>)}</div>}
    {data.undated.length > 0 && <details className="timeline-top-items"><summary>{ru ? 'Без даты' : 'No date'} · {data.undated.length}</summary>{data.undated.map(item => <Button key={item.id} onClick={() => open(item)}>{item.title}</Button>)}</details>}
    <div className="timeline-axis" style={{ height: height + 12 }}>
      {ticks.map(at => <div key={at} className="timeline-tick" style={{ top: positionAt(at, segments) }}><span>{timeLabel(at, zone)}</span></div>)}
      {segments.filter(v => v.hidden).map(v => <div key={v.start} className="timeline-break" style={{ top: v.top, height: v.height }}><span>{ru ? 'Скрыто' : 'Hidden'} {timeLabel(v.start, zone)}–{timeLabel(v.end, zone)}</span></div>)}
      <div className="timeline-events">
        {layout.events.map(event => {
          const extra = event.height >= 72 ? workspace.calendarPreferences.dayView.fields.filter(field => field !== 'title').map(field => displayViewValue(readItemField(event.item, field, workspace, now), field, workspace.calendarPreferences.language)).filter(Boolean) : [];
          const interval = `${timeLabel(event.start, zone)}${event.point ? '' : `–${timeLabel(event.end, zone)}`}`;
          return <button type="button" key={event.item.id} className="timeline-event" style={columnStyle(event)} onClick={() => open(event.item)} title={`${event.item.title} · ${interval}`} aria-label={`${event.item.title} · ${interval}`} data-testid="timeline-event">
            <strong>{event.invalid && '⚠ '}{event.continuedBefore && '← '}{event.item.title || (ru ? 'Без названия' : 'Untitled')}{event.continuedAfter && ' →'}</strong>
            {event.height >= 54 && <small>{interval}</small>}{extra.map((text, i) => <small key={i}>{text}</small>)}
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
