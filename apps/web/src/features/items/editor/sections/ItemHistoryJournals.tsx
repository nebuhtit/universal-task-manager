import { useState } from 'react';
import { createId, durationGoalResult, initializeItemHistory, syncActualDuration, syncCompletionCounter, type ActualTimeEntry, type CompletionEntry, type UniversalItem, type WorkspaceDocument } from '@utm/core';
import { Button, Field, Input, Select, Textarea } from '../../../../components/ui/primitives';
import { dateInput, fromDateInput, formatViewDate } from '../../../../utils/dates';
import './item-history.css';

const copy = (item: UniversalItem) => { const next = JSON.parse(JSON.stringify(item)) as UniversalItem; initializeItemHistory(next); return next; };
const elapsed = (seconds: number) => `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

type CompletionDraft = { ownerId: string; completion: CompletionEntry; time?: ActualTimeEntry };

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
  const [editing, setEditing] = useState<CompletionDraft>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = async (next: UniversalItem) => {
    setBusy(true); setError('');
    try { syncActualDuration(next); syncCompletionCounter(next); if (next.id === item.id) await onChange(next); else await onOwnerChange?.(next); return true; }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return false; }
    finally { setBusy(false); }
  };

  const records = owners.flatMap((entry) => { const normalized = copy(entry); return (normalized.actualTimeEntries ?? []).map((record) => ({ owner: normalized, record })); }).sort((a, b) => (b.record.at ?? '').localeCompare(a.record.at ?? ''));
  const completions = owners.flatMap((entry) => { const normalized = copy(entry); return (normalized.completionEntries ?? []).map((record) => ({ owner: normalized, record })); }).sort((a, b) => b.record.at.localeCompare(a.record.at));
  const cycle = (value?: string) => value ? <small>{t('Cycle', 'Повторение')}: {formatViewDate(value, true, workspace.calendarPreferences.language)}</small> : null;
  const sourceName = (source?: ActualTimeEntry['source']) => source ? ({ manual: '', timer: t('Timer', 'Таймер'), stopwatch: t('Stopwatch', 'Секундомер'), imported: t('Imported', 'Импортировано') })[source] : '';
  const linkedRecords = (recordOwner: UniversalItem, completionId: string) => records.filter((entry) => entry.owner.id === recordOwner.id && entry.record.completionId === completionId);

  const startNew = () => setEditing({ ownerId: owner.id, completion: { id: createId(), at: new Date().toISOString(), kind: 'manual', comment: '', ...(recurrenceId ? { recurrenceId } : {}) } });
  const startEdit = (recordOwner: UniversalItem, completion: CompletionEntry) => {
    const linked = linkedRecords(recordOwner, completion.id).map((entry) => entry.record);
    const first = linked[0];
    setEditing({ ownerId: recordOwner.id, completion: { ...completion, comment: completion.comment || first?.comment || '' }, ...(first ? { time: { ...first, durationSeconds: linked.reduce((sum, entry) => sum + entry.durationSeconds, 0) } } : {}) });
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.completion.at || !Number.isFinite(Date.parse(editing.completion.at)) || editing.time && (!Number.isFinite(editing.time.durationSeconds) || editing.time.durationSeconds < 0)) {
      setError(t('Enter a valid date and duration.', 'Укажите корректную дату и длительность.')); return;
    }
    const next = copy(owners.find((entry) => entry.id === editing.ownerId) ?? item);
    next.completionEntries = [...(next.completionEntries ?? []).filter((entry) => entry.id !== editing.completion.id), editing.completion];
    next.actualTimeEntries = (next.actualTimeEntries ?? []).filter((entry) => entry.completionId !== editing.completion.id);
    const originals = linkedRecords(next, editing.completion.id).map((entry) => entry.record);
    if (originals.length) {
      const total = originals.reduce((sum, entry) => sum + entry.durationSeconds, 0);
      let remaining = editing.time?.durationSeconds ?? 0;
      originals.forEach((entry, index) => {
        const durationSeconds = index === originals.length - 1 ? remaining : Math.min(remaining, Math.floor((editing.time?.durationSeconds ?? 0) * (total ? entry.durationSeconds / total : 1 / originals.length)));
        remaining -= durationSeconds;
        next.actualTimeEntries!.push({ ...entry, durationSeconds });
      });
    } else if (editing.time?.durationSeconds) next.actualTimeEntries.push({ ...editing.time, at: editing.completion.at, completionId: editing.completion.id, ...(editing.completion.recurrenceId ? { recurrenceId: editing.completion.recurrenceId } : {}) });
    if (await apply(next)) { setEditing(undefined); setError(''); }
  };

  const removeCompletion = async (recordOwner: UniversalItem, completionId: string) => {
    const next = copy(recordOwner);
    next.completionEntries = (next.completionEntries ?? []).filter((entry) => entry.id !== completionId);
    next.actualTimeEntries = (next.actualTimeEntries ?? []).filter((entry) => entry.completionId !== completionId);
    await apply(next);
  };

  const setDurationPart = (unit: number, index: number, value: number) => {
    if (!editing || value < 0 || !Number.isInteger(value) || index > 0 && value > 59) return;
    const current = editing.time?.durationSeconds ?? 0;
    const old = index === 0 ? Math.floor(current / unit) : Math.floor(current / unit) % 60;
    const durationSeconds = current + (value - old) * unit;
    const time = editing.time ?? { id: createId(), at: editing.completion.at, durationSeconds: 0, comment: '', source: 'manual' as const, completionId: editing.completion.id, ...(editing.completion.recurrenceId ? { recurrenceId: editing.completion.recurrenceId } : {}) };
    setEditing({ ...editing, time: { ...time, durationSeconds } });
  };

  const editor = editing && <div className="item-journal-form">
    <Field label={t('Date and time', 'Дата и время')}><Input aria-label={t('Entry date', 'Дата записи')} type="datetime-local" value={dateInput(editing.completion.at)} onChange={(event) => setEditing({ ...editing, completion: { ...editing.completion, at: fromDateInput(event.target.value) } })} /></Field>
    <div className="item-journal-duration">{[3600, 60, 1].map((unit, index) => { const seconds = editing.time?.durationSeconds ?? 0; return <Field key={unit} label={[t('Hours', 'Часы'), t('Minutes', 'Минуты'), t('Seconds', 'Секунды')][index]}><Input type="number" min={0} step={1} max={index ? 59 : undefined} value={index === 0 ? Math.floor(seconds / unit) : Math.floor(seconds / unit) % 60} onChange={(event) => setDurationPart(unit, index, Number(event.target.value))} /></Field>; })}</div>
    <Field label={t('Comment', 'Комментарий')}><Textarea value={editing.completion.comment} onChange={(event) => setEditing({ ...editing, completion: { ...editing.completion, comment: event.target.value } })} /></Field>
    {editing.time && sourceName(editing.time.source) && <small>{t('Source', 'Источник')}: {sourceName(editing.time.source)}</small>}
    {error && <p role="alert">{error}</p>}<div className="item-journal-actions"><Button onClick={() => setEditing(undefined)}>{t('Cancel', 'Отмена')}</Button><Button onClick={save}>{t('Apply', 'Применить')}</Button></div>
  </div>;

  const orphanRecords = records.filter(({ owner: recordOwner, record }) => !record.completionId || !recordOwner.completionEntries?.some((entry) => entry.id === record.completionId));

  return <fieldset className="item-journals" disabled={busy}>
    {error && !editing && <p role="alert">{error}</p>}
    {owners.length > 1 && <Field label={t('Record for', 'Записать для')}><Select value={owner.id} onChange={(event) => { setOwnerId(event.target.value); setSelectedCycle(undefined); }}>{owners.map((entry) => <option key={entry.id} value={entry.id}>{entry.role === 'series_template' ? t('Series', 'Серия') : entry.occurrence?.recurrenceId ? formatViewDate(entry.occurrence.recurrenceId, true, workspace.calendarPreferences.language) : entry.title}</option>)}</Select></Field>}
    {cycles.length > 0 && <Field label={t('Cycle for new entries', 'Повторение для новых записей')}><Select value={recurrenceId ?? ''} onChange={(event) => setSelectedCycle(event.target.value)}><option value="">{t('No cycle', 'Без повторения')}</option>{cycles.map((value) => <option key={value} value={value}>{formatViewDate(value, true, workspace.calendarPreferences.language)}</option>)}</Select></Field>}
    <div><strong>{t('Completions', 'Выполнения')} · {completions.filter(({ record }) => !record.revokedAt).length}{records.length ? ` · ${elapsed(records.reduce((sum, entry) => sum + entry.record.durationSeconds, 0))}` : ''}</strong><div className="item-journal-body">
      {!item.isNote && <div className="item-journal-actions"><Button onClick={startNew}>{t('Add completion', 'Добавить выполнение')}</Button></div>}
      {editing && !completions.some(({ owner: recordOwner, record }) => recordOwner.id === editing.ownerId && record.id === editing.completion.id) && editor}
      {completions.map(({ owner: recordOwner, record }) => {
        if (editing?.ownerId === recordOwner.id && editing.completion.id === record.id) return <div key={`${recordOwner.id}:${record.id}`}>{editor}</div>;
        const linked = linkedRecords(recordOwner, record.id);
        const total = linked.reduce((sum, entry) => sum + entry.record.durationSeconds, 0);
        const sources = [...new Set(linked.map((entry) => sourceName(entry.record.source)).filter(Boolean))];
        const goal = durationGoalResult(total || undefined, recordOwner.progress?.durationGoal ?? item.progress?.durationGoal);
        const difference = goal ? `${goal.differenceSeconds > 0 ? '+' : '−'}${elapsed(Math.abs(goal.differenceSeconds))}` : '';
        return <article className="item-journal-entry" key={`${recordOwner.id}:${record.id}`}><strong>{record.kind === 'automatic' ? t('Automatic completion', 'Автоматическое выполнение') : t('Completion', 'Выполнение')}{sources.length ? ` · ${sources.join(', ')}` : ''}{record.revokedAt ? ` · ${t('Reopened', 'Отменено')}` : ''}</strong><span>{formatViewDate(record.at, true, workspace.calendarPreferences.language)}{total ? ` · ${elapsed(total)}` : ''}</span>{goal && <small>{goal.met ? t('Duration goal met', 'Цель по времени достигнута') : t('Outside duration goal', 'Вне цели по времени')} · {difference}</small>}{cycle(record.recurrenceId)}{[...new Set([record.comment, ...linked.map((entry) => entry.record.comment)].filter(Boolean))].map((comment) => <p key={comment} data-utm-user-data>{comment}</p>)}<div className="item-journal-actions"><Button size="compact" onClick={() => startEdit(recordOwner, record)}>{t('Edit', 'Изменить')}</Button><Button size="compact" onClick={() => void removeCompletion(recordOwner, record.id)}>{t('Delete', 'Удалить')}</Button></div></article>;
      })}
      {orphanRecords.map(({ owner: recordOwner, record }) => <article className="item-journal-entry" key={`${recordOwner.id}:${record.id}`}><strong>{t('Completion', 'Выполнение')}{sourceName(record.source) ? ` · ${sourceName(record.source)}` : ''}</strong><span>{record.at ? formatViewDate(record.at, true, workspace.calendarPreferences.language) : t('Unknown date', 'Дата неизвестна')} · {elapsed(record.durationSeconds)}</span>{cycle(record.recurrenceId)}{record.comment && <p data-utm-user-data>{record.comment}</p>}</article>)}
      {!completions.length && !orphanRecords.length && <p className="hint">{t('No completions yet.', 'Выполнений пока нет.')}</p>}
    </div></div>
  </fieldset>;
}
