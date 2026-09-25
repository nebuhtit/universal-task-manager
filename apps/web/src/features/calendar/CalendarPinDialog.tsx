import { useState } from 'react';
import './calendar-pin-dialog.css';
import { calendarDateKey, type CalendarSourceReference, type WorkspaceDocument } from '@utm/core';
import { ResponsiveDialog } from '../../components/ui/ResponsiveDialog';
import { Button } from '../../components/ui/primitives';
import { useWorkspaceNow } from '../../hooks/useClock';
import { evaluateCalendarRange } from './calendarEvaluation';
import { prepareTimelineData } from './timelineData';
import { buildCalendarPlan, naturallyOnDay, planningReason, referenceKey, removeCalendarPin, resolveCalendarSource, setCalendarPin } from './calendarPlanning';

export function CalendarPinDialog({ workspace, target, onClose, commit, onFlush }: {
  workspace: WorkspaceDocument; target: CalendarSourceReference; onClose: () => void;
  commit: (message: string, mutation: (draft: WorkspaceDocument) => void) => boolean | void; onFlush: () => Promise<void>;
}) {
  const now = useWorkspaceNow(workspace), zone = workspace.calendarPreferences.timezone, ru = workspace.calendarPreferences.language === 'ru';
  const today = calendarDateKey(now, zone);
  const nextDay = (key: string) => new Date(Date.parse(`${key}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const [day, setDay] = useState<string | null>(null), [message, setMessage] = useState(''), [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const item = resolveCalendarSource(workspace, target);
  const pin = workspace.calendarPreferences.planning?.pins?.[referenceKey(target)];
  const tomorrow = nextDay(today);
  const presentOn = (key: string) => Boolean(item && (pin?.day === key || naturallyOnDay(item, prepareTimelineData(workspace, key, now), key)));
  const onToday = presentOn(today), onTomorrow = presentOn(tomorrow);
  const save = async (action: (draft: WorkspaceDocument) => void) => {
    setSaving(true); setMessage('');
    try { if (commit('Calendar reference', action) === false) throw new Error(ru ? 'Не удалось сохранить закрепление.' : 'Could not save the reference.'); await onFlush(); onClose(); }
    catch (error) { setMessage(String(error)); } finally { setSaving(false); }
  };
  const choose = (key: string, mode?: 'same_time' | 'queue' | 'parallel') => {
    setMessage(''); setDay(key); setConflict(false);
    if (!item || item.state !== 'open') { setMessage(ru ? 'Исходный элемент удалён или завершён.' : 'The source was deleted or completed.'); return; }
    if (item.role === 'series_template') { setMessage(ru ? 'Откройте конкретное повторение в календаре, чтобы закрепить его, а не всю серию.' : 'Open a specific calendar occurrence to pin it, not the series.'); return; }
    const prepared = prepareTimelineData(workspace, key, now);
    if (naturallyOnDay(item, prepared, key)) { setMessage(ru ? 'Элемент уже присутствует на этом дне. Вторая карточка не добавлена.' : 'This item is already on this day. No second card added.'); return; }
    if (item.schedule?.startAt && !mode) return;
    const value = { ...target, day: key, mode: mode ?? 'queue' as const };
    // Validate a hypothetical preferences-only change before committing anything.
    const candidate = { ...workspace, calendarPreferences: { ...workspace.calendarPreferences, planning: { ...workspace.calendarPreferences.planning, pins: { ...workspace.calendarPreferences.planning?.pins, [referenceKey(target)]: value } } } };
    const evaluation = evaluateCalendarRange(workspace, key, nextDay(key), workspace.calendarPreferences.dayView, now);
    const result = buildCalendarPlan(candidate, key, prepared, now, evaluation.days[key]?.reservedItems ?? []);
    const issue = result.warnings.find(warning => warning.item.id === item.id);
    if (mode !== 'queue' && issue) { setConflict(issue.reason === 'conflict'); setMessage(planningReason(issue.reason, ru)); return; }
    void save(draft => setCalendarPin(draft, value));
  };
return <ResponsiveDialog open onOpenChange={open => { if (!open && !saving) onClose(); }} title={ru ? 'Временно в календарь' : 'Temporary calendar reference'} ariaLabel="Calendar pin" className="calendar-pin-dialog" backdropClassName="is-glass" footer={<Button className="calendar-pin-glass-button" disabled={saving} onClick={onClose}>{ru ? 'Закрыть' : 'Close'}</Button>}>
    <p className="calendar-pin-item" translate="no" data-utm-user-data>{item?.title}</p><p className="hint">{ru ? 'Только ярлык-ссылка до конца выбранного дня. Исходные даты и Google-событие не меняются.' : 'A reference until the selected day ends. Original dates and the Google event stay unchanged.'}</p>
    <div className="calendar-pin-actions">{!onToday && <Button className="calendar-pin-glass-button" disabled={saving || !item} onClick={() => choose(today)}>{ru ? 'На сегодня' : 'Today'}</Button>}{!onTomorrow && <Button className="calendar-pin-glass-button" disabled={saving || !item} onClick={() => choose(tomorrow)}>{ru ? 'На завтра' : 'Tomorrow'}</Button>}
      <Button className="calendar-pin-glass-button" disabled={saving || !pin} onClick={() => void save(draft => removeCalendarPin(draft, target))}>{ru ? 'Снять закрепление' : 'Unpin'}</Button></div>
    {onToday && onTomorrow && <p className="hint">{ru ? 'Элемент уже присутствует сегодня и завтра.' : 'This item is already present today and tomorrow.'}</p>}
    {day && item?.schedule?.startAt && <div className="calendar-pin-actions"><span>{day}</span><Button className="calendar-pin-glass-button" disabled={saving} onClick={() => choose(day, 'same_time')}>{ru ? 'На то же время' : 'Same time'}</Button><Button className="calendar-pin-glass-button" disabled={saving} onClick={() => choose(day, 'queue')}>{ru ? 'В очередь' : 'Queue'}</Button></div>}
    {message && <p role="status">{message}</p>}
    {conflict && day && <Button className="calendar-pin-glass-button" disabled={saving} onClick={() => choose(day, 'parallel')}>{ru ? 'Параллельно' : 'Parallel'}</Button>}
  </ResponsiveDialog>;
}
