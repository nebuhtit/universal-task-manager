import { useState } from 'react';
import { activeRangeBounds, zonedDateTime, type UniversalItem } from '@utm/core';
import { ResponsiveDialog } from '../../components/ui/ResponsiveDialog';
import { Button, Input } from '../../components/ui/primitives';
import { parallelPlacementIssue, planningReason } from './calendarPlanning';

export function CalendarPlacementDialog({ item, day, duration, zone, now, ru, pinned, onClose, onSave }: {
  item: UniversalItem; day: string; duration: number; zone: string; now: Date; ru: boolean; pinned: boolean;
  onClose: () => void; onSave: (start: string | null) => boolean | void;
}) {
  const earliest = Math.max(+zonedDateTime(day, 0, 0, zone), Math.ceil(+now / 60_000) * 60_000,
    pinned ? 0 : Date.parse(item.schedule?.availableFrom ?? '') || 0, pinned ? 0 : activeRangeBounds(item)?.start ?? 0);
  const [time, setTime] = useState(() => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(earliest));
  const [error, setError] = useState('');
  const save = (parallel: boolean) => {
    const [hour, minute] = time.split(':').map(Number);
    const start = /^\d{2}:\d{2}$/.test(time) ? +zonedDateTime(day, hour!, minute!, zone) : NaN;
    const issue = parallel ? parallelPlacementIssue(item, day, start, duration, now, zone, pinned) : null;
    if (issue) { setError(planningReason(issue, ru)); return; }
    if (onSave(parallel ? new Date(start).toISOString() : null) !== false) onClose();
    else setError(ru ? 'Не удалось сохранить размещение.' : 'Could not save placement.');
  };
  return <ResponsiveDialog open onOpenChange={open => { if (!open) onClose(); }} title={ru ? 'Размещение в календаре' : 'Calendar placement'} ariaLabel="Calendar placement">
    <p><span translate="no" data-utm-user-data>{item.title}</span> · {day} · {Math.round(duration / 60_000 * 100) / 100} {ru ? 'мин' : 'min'}</p>
    <p>{ru ? 'Это ярлык-ссылка: исходные даты, длительность и Google-событие не меняются. Параллельное размещение допускает пересечения с событиями, работой, сном и скрытыми резервами, но задача должна завершиться до будущего срока.' : 'This is a reference: original dates, duration and Google event stay unchanged. Parallel placement may overlap events, Work, sleep and hidden reserves, but not a future Due.'}</p>
    <label>{ru ? 'Начало' : 'Start time'}<Input type="time" aria-label="Parallel start time" value={time} onChange={event => { setTime(event.target.value); setError(''); }} /></label>
    {error && <p role="alert">{error}</p>}
    <div className="calendar-pin-actions"><Button onClick={() => save(true)}>{ru ? 'Параллельно' : 'Parallel'}</Button><Button onClick={() => save(false)}>{ru ? 'В очередь' : 'Queue'}</Button><Button variant="ghost" onClick={onClose}>{ru ? 'Отмена' : 'Cancel'}</Button></div>
  </ResponsiveDialog>;
}
