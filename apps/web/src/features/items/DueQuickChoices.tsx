import { useState } from 'react';
import { calendarDateKey, shiftCalendarDateKey, type UniversalItem, type WorkspaceLanguage } from '@utm/core';
import { Button, Input } from '../../components/ui/primitives';
import { dueDateOnlyToIso, dueQuickOptions, dueWallInput, dueWallInputToIso, itemTimeZone } from './dueQuickActions';
import './due-quick.css';

export function DueQuickChoices({ item, now, language, onChoose, error }: {
  item: UniversalItem; now: Date; language: WorkspaceLanguage; onChoose: (at: string) => void; error?: string | undefined;
}) {
  const ru = language === 'ru';
  const zone = itemTimeZone(item);
  const dateOnly = Boolean(item.schedule?.plannedDate && !item.schedule.startAt && !item.schedule.dueAt);
  const [custom, setCustom] = useState(false);
  const [withoutTime, setWithoutTime] = useState(Boolean(item.schedule?.dueDateOnly));
  const [draft, setDraft] = useState(() => dateOnly ? item.schedule!.plannedDate! : dueWallInput(item.schedule?.dueAt ?? new Date(now.getTime() + 3_600_000).toISOString(), zone));
  const [draftDay, setDraftDay] = useState(() => calendarDateKey(item.schedule?.dueAt ? new Date(item.schedule.dueAt) : now, zone));
  const [localError, setLocalError] = useState('');
  const labels = {
    'today-13': ru ? 'Сегодня днём' : 'Today afternoon',
    'today-19': ru ? 'Сегодня вечером' : 'Today evening',
    'today-23': ru ? 'Сегодня ночью' : 'Tonight',
    tomorrow: ru ? 'Завтра' : 'Tomorrow',
    'next-week': ru ? 'Этот день на следующей неделе' : 'Same day next week',
    'next-monday': ru ? 'Пн следующей недели' : 'Next Monday',
  } as const;
  const formatter = new Intl.DateTimeFormat(ru ? 'ru-RU' : 'en-US', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const chooseCustom = () => {
    if (dateOnly) { if (/^\d{4}-\d{2}-\d{2}$/.test(draft)) onChoose(draft); return; }
    if (withoutTime) {
      const end = dueDateOnlyToIso(draftDay, zone);
      if (!end || Date.parse(end) <= now.getTime() || (item.schedule?.startAt && Date.parse(end) < Date.parse(item.schedule.startAt))) { setLocalError(ru ? 'Выберите подходящий будущий день.' : 'Choose a valid future day.'); return; }
      setLocalError(''); onChoose(draftDay); return;
    }
    const at = dueWallInputToIso(draft, zone);
    if (!at) { setLocalError(ru ? 'Такого времени нет в часовом поясе элемента.' : 'This time does not exist in the item time zone.'); return; }
    if (Date.parse(at) <= now.getTime()) { setLocalError(ru ? 'Выберите будущее время.' : 'Choose a future time.'); return; }
    if (item.schedule?.startAt && Date.parse(at) < Date.parse(item.schedule.startAt)) { setLocalError(ru ? 'Срок не может быть раньше начала события.' : 'Due cannot be before Event opens.'); return; }
    setLocalError(''); onChoose(at);
  };
  if (dateOnly) return <div className="due-quick-choices">
    {[0, 1, 2, 7].map(offset => { const day = shiftCalendarDateKey(calendarDateKey(now, zone), offset); return <Button key={day} size="compact" variant="ghost" onClick={() => onChoose(day)}>{day}</Button>; })}
    <Input type="date" aria-label={ru ? 'Плановая дата' : 'Planned date'} value={draft} onChange={event => setDraft(event.target.value)} />
    <Button size="compact" onClick={chooseCustom}>{ru ? 'Перепланировать' : 'Reschedule'}</Button>
    {error && <small role="alert">{error}</small>}
  </div>;
  return <div className="due-quick-choices">
    {dueQuickOptions(item, now).map(({ id, at, disabled }) => <Button key={id} size="compact" variant="ghost" disabled={disabled} title={disabled ? (ru ? 'Раньше начала события' : 'Before Event opens') : undefined} onClick={() => onChoose(at)}><span>{labels[id]}</span><time dateTime={at}>{formatter.format(new Date(at))}</time></Button>)}
    <Button size="compact" variant="ghost" aria-expanded={custom} onClick={() => setCustom((open) => !open)}>{ru ? 'Выбрать дату и время…' : 'Custom date and time…'}</Button>
    {custom && <div className="due-custom"><label><input type="checkbox" checked={withoutTime} onChange={event => { setWithoutTime(event.target.checked); setLocalError(''); }} />{ru ? 'Без времени' : 'Without time'}</label>{withoutTime ? <Input type="date" aria-label={ru ? 'Дата срока без времени' : 'Due date without time'} value={draftDay} onChange={event => { setDraftDay(event.target.value); setLocalError(''); }} /> : <Input type="datetime-local" aria-label={ru ? 'Новый срок' : 'New Due'} value={draft} onChange={(event) => { setDraft(event.target.value); setLocalError(''); }} />}<Button size="compact" onClick={chooseCustom}>{ru ? 'Применить' : 'Apply'}</Button></div>}
    {(localError || error) && <small role="alert" className="ui-field-error">{localError || error}</small>}
  </div>;
}
