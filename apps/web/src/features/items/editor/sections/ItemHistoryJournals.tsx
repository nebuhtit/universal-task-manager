import { useState } from 'react';
import { addTimerActualTime, createId, initializeItemHistory, syncActualDuration, type ActualTimeEntry, type CompletionEntry, type UniversalItem, type WorkspaceDocument } from '@utm/core';
import { Button, Field, Input, Select, Textarea } from '../../../../components/ui/primitives';
import { dateInput, fromDateInput, formatViewDate } from '../../../../utils/dates';
import './item-history.css';

const copy = (item: UniversalItem) => { const next = JSON.parse(JSON.stringify(item)) as UniversalItem; initializeItemHistory(next); return next; };
const elapsed = (seconds: number) => `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export function ItemHistoryJournals({ item, workspace, onChange, onOwnerChange }: { item: UniversalItem; workspace: WorkspaceDocument; onChange: (item: UniversalItem) => void | Promise<void>; onOwnerChange?: (item: UniversalItem) => void | Promise<void> }) {
  const ru = workspace.calendarPreferences.language === 'ru';
  const t = (en: string, russian: string) => ru ? russian : en;
  const seriesId = item.occurrence?.seriesId ?? (item.role === 'series_template' ? item.id : undefined);
  const owners = [item, ...Object.values(workspace.items).filter((entry) => !entry.deletedAt && entry.id !== item.id && seriesId && entry.occurrence?.seriesId === seriesId)];
  const [ownerId, setOwnerId] = useState(owners.find((entry) => entry.role === 'occurrence' && entry.state === 'open')?.id ?? item.id);
  const owner = copy(owners.find((entry) => entry.id === ownerId) ?? item);
  const [selectedCycle, setSelectedCycle] = useState<string>();
  const recurrenceId = selectedCycle ?? owner.occurrence?.recurrenceId;
  const cycles = [...new Set([owner.occurrence?.recurrenceId, ...(owner.cycleHistory ?? []).map((entry) => entry.recurrenceId), ...(owner.actualTimeEntries ?? []).map((entry) => entry.recurrenceId)].filter((value): value is string => Boolean(value)))].sort().reverse();
  const [editing, setEditing] = useState<{ ownerId: string; kind: 'time'; value: ActualTimeEntry } | { ownerId: string; kind: 'completion'; value: CompletionEntry }>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const apply = async (next: UniversalItem) => {
    setBusy(true); setError('');
    try { syncActualDuration(next); if (next.id === item.id) await onChange(next); else await onOwnerChange?.(next); return true; }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return false; }
    finally { setBusy(false); }
  };
  const records = owners.flatMap((entry) => { const normalized = copy(entry); return (normalized.actualTimeEntries ?? []).map((record) => ({ owner: normalized, record })); }).sort((a, b) => (b.record.at ?? '').localeCompare(a.record.at ?? ''));
  const completions = owners.flatMap((entry) => { const normalized = copy(entry); return (normalized.completionEntries ?? []).map((record) => ({ owner: normalized, record })); }).sort((a, b) => b.record.at.localeCompare(a.record.at));
  const cycle = (recurrenceId?: string) => recurrenceId ? <small>{t('Cycle', 'Повторение')}: {formatViewDate(recurrenceId, true, workspace.calendarPreferences.language)}</small> : null;
  const save = async () => {
    if (!editing) return;
    if (editing.value.at && !Number.isFinite(Date.parse(editing.value.at)) || editing.kind === 'completion' && !editing.value.at || editing.kind === 'time' && (!Number.isFinite(editing.value.durationSeconds) || editing.value.durationSeconds < 0)) { setError(t('Enter a valid date and duration.', 'Укажите корректную дату и длительность.')); return; }
    const next = copy(owners.find((entry) => entry.id === editing.ownerId) ?? item);
    if (editing.kind === 'time') { const value = { ...editing.value }; if (!value.at) delete value.at; next.actualTimeEntries = [...(next.actualTimeEntries ?? []).filter((entry) => entry.id !== value.id), value]; }
    else next.completionEntries = [...(next.completionEntries ?? []).filter((entry) => entry.id !== editing.value.id), editing.value];
    if (await apply(next)) { setEditing(undefined); setError(''); }
  };
  const timeRow = ({ owner: recordOwner, record }: typeof records[number]) => <article className="item-journal-entry" key={`${recordOwner.id}:${record.id}`}><strong>{elapsed(record.durationSeconds)}</strong><span>{record.at ? formatViewDate(record.at, true, workspace.calendarPreferences.language) : t('Unknown date · Imported', 'Дата неизвестна · Импортировано')}</span><small>{({ manual: t('Manual', 'Вручную'), timer: t('Timer', 'Таймер'), stopwatch: t('Stopwatch', 'Секундомер'), imported: t('Imported', 'Импортировано') })[record.source]}</small>{cycle(record.recurrenceId)}<p data-utm-user-data>{record.comment}</p><div className="item-journal-actions"><Button size="compact" onClick={() => setEditing({ ownerId: recordOwner.id, kind: 'time', value: { ...record } })}>{t('Edit', 'Изменить')}</Button><Button size="compact" onClick={() => { recordOwner.actualTimeEntries = recordOwner.actualTimeEntries!.filter((entry) => entry.id !== record.id); apply(recordOwner); }}>{t('Delete entry', 'Удалить запись')}</Button></div></article>;
  const editor = editing && <div className="item-journal-form">
    <Field label={t('Date and time', 'Дата и время')}><Input aria-label={t('Entry date', 'Дата записи')} type="datetime-local" value={editing.value.at ? dateInput(editing.value.at) : ''} onChange={(event) => { const at = fromDateInput(event.target.value); setEditing({ ...editing, value: { ...editing.value, at } } as typeof editing); }} /></Field>
    {editing.kind === 'time' && <Field label={t('Completion', 'Выполнение')}><Select value={editing.value.completionId ?? ''} onChange={(event) => { const next = { ...editing.value } as ActualTimeEntry; if (event.target.value) next.completionId = event.target.value; else delete next.completionId; setEditing({ ownerId: editing.ownerId, kind: 'time', value: next }); }}><option value="">{t('In progress / not linked', 'В процессе / без привязки')}</option>{completions.filter(({ owner, record }) => owner.id === editing.ownerId && record.recurrenceId === editing.value.recurrenceId).map(({ record }) => <option key={record.id} value={record.id}>{formatViewDate(record.at, true, workspace.calendarPreferences.language)}</option>)}</Select></Field>}
    {editing.kind === 'time' && <div className="item-journal-duration">{[3600, 60, 1].map((unit, index) => <Field key={unit} label={[t('Hours', 'Часы'), t('Minutes', 'Минуты'), t('Seconds', 'Секунды')][index]}><Input type="number" min={0} step={1} max={index ? 59 : undefined} value={index === 0 ? Math.floor(editing.value.durationSeconds / unit) : Math.floor(editing.value.durationSeconds / unit) % 60} onChange={(event) => { const old = index === 0 ? Math.floor(editing.value.durationSeconds / unit) : Math.floor(editing.value.durationSeconds / unit) % 60; const value = Number(event.target.value); if (value >= 0 && Number.isInteger(value) && (!index || value < 60)) setEditing({ ...editing, value: { ...editing.value, durationSeconds: editing.value.durationSeconds + (value - old) * unit } }); }} /></Field>)}</div>}
    <Field label={t('Comment', 'Комментарий')}><Textarea value={editing.value.comment} onChange={(event) => setEditing({ ...editing, value: { ...editing.value, comment: event.target.value } } as typeof editing)} /></Field>
    {error && <p role="alert">{error}</p>}<div className="item-journal-actions"><Button onClick={() => setEditing(undefined)}>{t('Cancel', 'Отмена')}</Button><Button onClick={save}>{t('Apply entry', 'Применить запись')}</Button></div>
  </div>;
  return <fieldset className="item-journals" disabled={busy}>
    {error && !editing && <p role="alert">{error}</p>}
    {owners.length > 1 && <Field label={t('Record for', 'Записать для')}><Select value={owner.id} onChange={(event) => { setOwnerId(event.target.value); setSelectedCycle(undefined); }}>{owners.map((entry) => <option key={entry.id} value={entry.id}>{entry.role === 'series_template' ? t('Series', 'Серия') : entry.occurrence?.recurrenceId ? formatViewDate(entry.occurrence.recurrenceId, true, workspace.calendarPreferences.language) : entry.title}</option>)}</Select></Field>}
    {cycles.length > 0 && <Field label={t('Cycle for new entries', 'Повторение для новых записей')}><Select value={recurrenceId ?? ''} onChange={(event) => setSelectedCycle(event.target.value)}><option value="">{t('No cycle', 'Без повторения')}</option>{cycles.map((value) => <option key={value} value={value}>{formatViewDate(value, true, workspace.calendarPreferences.language)}</option>)}</Select></Field>}
    <details><summary>{t('Completions and actual time', 'Выполнения и фактическое время')}</summary><div className="item-journal-body">
    <details open={editing?.kind === 'time' ? true : undefined}><summary>{t('Actual time', 'Фактическое время')} · {elapsed(records.reduce((sum, entry) => sum + entry.record.durationSeconds, 0))}</summary><div className="item-journal-body">
      <Button onClick={() => setEditing({ ownerId: owner.id, kind: 'time', value: { id: createId(), at: new Date().toISOString(), durationSeconds: 0, comment: '', source: 'manual', ...(recurrenceId ? { recurrenceId } : {}) } })}>{t('Add time entry', 'Добавить время')}</Button>
      {editing?.kind === 'time' && editor}
      {records.filter(({ owner, record }) => !record.completionId || !owner.completionEntries?.some((entry) => entry.id === record.completionId)).map(timeRow)}
      {(owner.timerHistory ?? []).map((session) => <div className="item-journal-entry" key={session.id}><span>{session.mode} · {elapsed(session.durationSeconds)}</span><Button size="compact" disabled={owner.actualTimeEntries?.some((entry) => entry.sourceSessionId === session.id) || session.mode === 'stopwatch' && session.durationSeconds <= 30} onClick={() => { addTimerActualTime(owner, session); apply(owner); }}>{t('Count as actual time', 'Учесть как фактическое время')}</Button></div>)}
    </div></details>
    {!item.external?.readOnly && !item.isNote && <details><summary>{t('Completions', 'Выполнения')} · {completions.filter(({ record }) => !record.revokedAt).length}</summary><div className="item-journal-body"><Button onClick={() => setEditing({ ownerId: owner.id, kind: 'completion', value: { id: createId(), at: new Date().toISOString(), kind: 'manual', comment: '', ...(recurrenceId ? { recurrenceId } : {}) } })}>{t('Add completion entry', 'Добавить выполнение')}</Button>{editing?.kind === 'completion' && editor}
      {completions.map(({ owner: recordOwner, record }) => <article className="item-journal-entry" key={`${recordOwner.id}:${record.id}`}><strong>{record.kind === 'automatic' ? t('Automatic', 'Автоматическое') : t('Manual', 'Ручное')}{record.revokedAt ? ` · ${t('Reopened', 'Выполнение отменено')}` : ''}</strong><span>{formatViewDate(record.at, true, workspace.calendarPreferences.language)}</span>{cycle(record.recurrenceId)}<p data-utm-user-data>{record.comment}</p>{records.filter((entry) => entry.owner.id === recordOwner.id && entry.record.completionId === record.id).map(timeRow)}<div className="item-journal-actions"><Button size="compact" onClick={() => setEditing({ ownerId: recordOwner.id, kind: 'completion', value: { ...record } })}>{t('Edit', 'Изменить')}</Button><Button size="compact" onClick={() => { recordOwner.completionEntries = recordOwner.completionEntries!.filter((entry) => entry.id !== record.id); apply(recordOwner); }}>{t('Delete entry', 'Удалить запись')}</Button></div></article>)}
    </div></details>}
    </div></details>
  </fieldset>;
}
