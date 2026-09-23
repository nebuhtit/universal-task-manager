import { useEffect, useRef, useState } from 'react';
import { zonedDateTime, type UniversalItem, type WorkspaceDocument } from '@utm/core';
import { ResponsiveDialog } from '../../components/ui/ResponsiveDialog';
import { Button, Checkbox, Field, Input, Select, Textarea } from '../../components/ui/primitives';
import { requestGoogleCalendarToken, hasGoogleWriteAuthorization } from '../../services/googleCalendar';
import { canEditGoogleEvent, GOOGLE_EDIT_EXTENSION, GoogleEditConflict, googleEventChanges, googleEventDraft, rebaseGoogleEdit, loadEditableGoogleEvent, type GoogleEditOperation } from '../../services/googleCalendarEdit';
import type { GoogleEventDraft } from '../../services/googleCalendarCreate';
import './google-create.css';

export interface GoogleEditingCallbacks {
  onGoogleEditDraft: (operation: GoogleEditOperation | null) => Promise<void>;
  onGoogleSave: (operation: GoogleEditOperation) => Promise<void>;
}
function wallTime(iso: string, timeZone: string): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return '';
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  } catch { return ''; }
}
export function EditGoogleEventDialog({ item, workspace, onClose, onGoogleEditDraft, onGoogleSave }: GoogleEditingCallbacks & { item: UniversalItem; workspace: WorkspaceDocument; onClose: () => void }) {
  const ru = workspace.calendarPreferences.language === 'ru';
  const t = (en: string, russian: string) => ru ? russian : en;
  const [operation, setOperation] = useState<GoogleEditOperation | undefined>(() => item.extensions?.[GOOGLE_EDIT_EXTENSION] as unknown as GoogleEditOperation | undefined);
  const [scope, setScope] = useState<'occurrence' | 'series'>(operation?.scope ?? 'occurrence');
  const [recurringEventId, setRecurringEventId] = useState<string | undefined>(operation?.baseline.recurringEventId ?? (operation?.scope === 'series' ? operation.eventId : undefined));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [calendars, setCalendars] = useState<Array<{ id?: string; summary?: string }>>([]);
  const inFlight = useRef(false);
  const draft = operation?.draft;
  const execute = async (action: () => Promise<void>) => { if (inFlight.current) return; inFlight.current = true; setBusy(true); setError(''); try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setConflict(reason instanceof GoogleEditConflict); } finally { inFlight.current = false; setBusy(false); } };
  const load = (nextScope: 'occurrence' | 'series' = scope) => execute(async () => {
    const token = await requestGoogleCalendarToken(undefined, 'create');
    const accountEmail = workspace.calendarPreferences.googleCalendar?.accountEmail ?? '';
    const occurrence = await loadEditableGoogleEvent(token.accessToken, item.external!.calendarId, item.external!.eventId, accountEmail);
    const seriesId = occurrence.event.recurringEventId;
    setRecurringEventId(seriesId);
    const { event, timeZone, calendars: writable } = nextScope === 'series' && seriesId
      ? await loadEditableGoogleEvent(token.accessToken, item.external!.calendarId, seriesId, accountEmail)
      : occurrence;
    setCalendars(writable);
    if (nextScope === 'occurrence' && !canEditGoogleEvent(event, timeZone, Date.now(), workspace.calendarPreferences.googleCalendar?.allowPastEventEditing)) throw new Error(t('Editing is available until 3 hours after the event ends.', 'Редактировать можно не позднее трёх часов после окончания события.'));
    const sameTarget = operation?.eventId === event.id;
    const next: GoogleEditOperation = { calendarId: item.external!.calendarId, destinationCalendarId: nextScope === 'series' ? item.external!.calendarId : operation?.destinationCalendarId ?? item.external!.calendarId, eventId: event.id, accountEmail, baseline: event, draft: sameTarget && operation ? rebaseGoogleEdit(operation, event, timeZone) : googleEventDraft(event, timeZone), scope: nextScope };
    setScope(nextScope);
    setOperation(next); setConflict(false); await onGoogleEditDraft(next);
  });
  const patch = (value: Partial<GoogleEventDraft>) => { if (operation) setOperation({ ...operation, draft: { ...operation.draft, ...value }, attempted: false }); };
  const save = () => execute(async () => {
    if (!operation) return;
    googleEventChanges(operation);
    setOperation({ ...operation, attempted: true });
    await onGoogleSave(operation);
    onClose();
  });
  const close = () => execute(async () => { if (operation) await onGoogleEditDraft(operation); onClose(); });
  const toggleDay = (allDay: boolean) => {
    if (!draft) return;
    const startDay = draft.allDay ? draft.start : wallTime(draft.start, draft.timeZone).slice(0, 10);
    const endDay = draft.allDay ? draft.end : wallTime(draft.end, draft.timeZone).slice(0, 10);
    const nextDay = new Date(Date.parse(`${startDay}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    patch({ allDay, start: allDay ? startDay : zonedDateTime(startDay, 12, 0, draft.timeZone).toISOString(), end: allDay ? endDay > startDay ? endDay : nextDay : zonedDateTime(endDay, 13, 0, draft.timeZone).toISOString() });
  };
  const initialLoad = useRef(false);
  // A sent draft must retain its original baseline for read-back recovery.
  useEffect(() => { if (!initialLoad.current && !operation?.attempted && hasGoogleWriteAuthorization()) { initialLoad.current = true; void load(); } }, []);
  return <ResponsiveDialog open className="google-create-dialog" title={t('Edit Google event', 'Изменить событие Google')} onOpenChange={(open) => { if (!open && !busy) void close(); }} footer={<><Button disabled={busy} onClick={() => void close()}>{t('Close', 'Закрыть')}</Button>{operation && !conflict && <Button variant="primary" disabled={busy} onClick={() => void save()}>{operation.attempted ? t('Check / retry save', 'Проверить / повторить сохранение') : t('Save in Google', 'Сохранить в Google')}</Button>}</>}>
    {recurringEventId && <Field label={t('Apply changes to', 'Применить изменения')}><Select value={scope} disabled={busy || Boolean(operation?.attempted)} onChange={(event) => void load(event.target.value as 'occurrence' | 'series')}><option value="occurrence">{t('This occurrence', 'Только это повторение')}</option><option value="series">{t('Entire series', 'Всю серию')}</option></Select></Field>}
    <p>{scope === 'series' ? t('Editing the recurring source changes the schedule for the whole series. Google keeps its recurrence rules and exceptions.', 'Изменение исходного события сдвигает расписание всей серии. Правила и исключения повторений остаются в Google.') : t('Changes apply only to this occurrence. Google notifies attendees when appropriate.', 'Изменения применяются только к этому повторению. Google при необходимости уведомит участников.')}</p>
    {(!operation || conflict) && <Button disabled={busy} onClick={() => void load()}>{conflict ? t('Load current event; keep my draft', 'Загрузить актуальное, сохранив мой текст') : t('Load event for editing', 'Загрузить событие для редактирования')}</Button>}
    {error && <p role="alert">{error}</p>}
    {operation && draft && <fieldset className="google-create-fields" disabled={busy || conflict || Boolean(operation.attempted)}>
      <Field label={t('Calendar', 'Календарь')}><Select value={operation.destinationCalendarId ?? operation.calendarId} disabled={scope === 'series'} onChange={(event) => setOperation({ ...operation, destinationCalendarId: event.target.value, attempted: false })}>{calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.summary || calendar.id}</option>)}</Select></Field>
      <Field label={t('Title', 'Название')}><Input value={draft.title} onChange={(event) => patch({ title: event.target.value })} /></Field>
      <Field label={t('Description', 'Описание')}><Textarea value={draft.description} onChange={(event) => patch({ description: event.target.value })} /></Field>
      <Field label={t('Location', 'Место')}><Input value={draft.location} onChange={(event) => patch({ location: event.target.value })} /></Field>
      <Field label={t('Timezone', 'Часовой пояс')}><Input value={draft.timeZone} onChange={(event) => patch({ timeZone: event.target.value })} /></Field>
      <Checkbox label={t('All day', 'Весь день')} checked={draft.allDay} onChange={(event) => { try { toggleDay(event.target.checked); } catch { setError(t('Enter a valid timezone and dates.', 'Укажите корректный часовой пояс и даты.')); } }} />
      {(['start', 'end'] as const).map((key) => <Field key={key} label={key === 'start' ? t('Event opens', 'Начало') : draft.allDay ? t('First day after the event', 'Первый день после события') : t('Event ends', 'Окончание')}><Input type={draft.allDay ? 'date' : 'datetime-local'} value={draft.allDay ? draft[key] : wallTime(draft[key], draft.timeZone)} onChange={(event) => { try { const value = event.target.value; if (draft.allDay) patch({ [key]: value }); else if (value) { const [day, time] = value.split('T'); const [hour, minute] = time!.split(':').map(Number); patch({ [key]: zonedDateTime(day!, hour!, minute!, draft.timeZone).toISOString() }); } } catch { setError(t('Invalid date or timezone.', 'Некорректная дата или часовой пояс.')); } }} /></Field>)}
      <Checkbox label={t('Busy', 'Занят')} checked={draft.busy} onChange={(event) => patch({ busy: event.target.checked })} />
    </fieldset>}
  </ResponsiveDialog>;
}
