import { useRef, useState } from 'react';
import type { GoogleCalendarEvent, UniversalItem, WorkspaceDocument } from '@utm/core';
import { ResponsiveDialog } from '../../components/ui/ResponsiveDialog';
import { Button, Checkbox, Field, Input, Select, Textarea } from '../../components/ui/primitives';
import { dateInput, fromDateInput } from '../../utils/dates';
import { calendarDurationMs, effectiveScheduleDuration } from '../../utils/durations';
import { requestGoogleCalendarToken } from '../../services/googleCalendar';
import { createSingleGoogleEvent, googleCreationId, googleEventBody, writableGoogleCalendars, GOOGLE_CREATE_EXTENSION, type GoogleCreateOperation, type GoogleEventDraft } from '../../services/googleCalendarCreate';
import './google-create.css';

export interface GoogleCreationCallbacks {
  onPrepareGoogleCreate: (operation: GoogleCreateOperation) => Promise<void>;
  onGoogleCreated: (operation: GoogleCreateOperation, event: GoogleCalendarEvent) => Promise<void>;
}

export function CreateGoogleEventDialog({ item, workspace, onClose, onPrepareGoogleCreate, onGoogleCreated }: GoogleCreationCallbacks & {
  item: UniversalItem; workspace: WorkspaceDocument; onClose: () => void;
}) {
  const ru = workspace.calendarPreferences.language === 'ru';
  const t = (en: string, translated: string) => ru ? translated : en;
  const previous = item.extensions?.[GOOGLE_CREATE_EXTENSION] as unknown as GoogleCreateOperation | undefined;
  const [operation, setOperation] = useState(previous);
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [draft, setDraft] = useState<GoogleEventDraft>(() => {
    if (previous?.draft) return previous.draft;
    const start = item.schedule?.startAt ?? item.schedule?.dueAt ?? new Date().toISOString();
    const allDay = Boolean(item.schedule?.allDay);
    const estimate = effectiveScheduleDuration(item.schedule);
    const end = item.schedule?.endAt ?? new Date(Date.parse(start) + (allDay ? 86_400_000 : estimate ? calendarDurationMs(estimate.amount, estimate.unit) : 3_600_000)).toISOString();
    const day = (value: string) => {
      const parts = new Intl.DateTimeFormat('en', { timeZone: item.schedule?.timezone ?? deviceZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
      const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      return `${fields.year}-${fields.month}-${fields.day}`;
    };
    return { title: item.title, description: item.bodyMarkdown, location: item.location ?? '', start: allDay ? day(start) : start, end: allDay ? day(end) : end, allDay, busy: true, timeZone: deviceZone };
  });
  const [calendars, setCalendars] = useState<Array<{ id?: string; summary?: string }>>([]);
  const [calendarId, setCalendarId] = useState(previous?.calendarId ?? '');
  const [connected, setConnected] = useState(false);
  const [preview, setPreview] = useState(Boolean(previous));
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(Boolean(previous && Object.values(workspace.items).some((entry) => entry.external?.calendarId === previous.calendarId && entry.external?.eventId === previous.eventId)));
  const accountEmail = workspace.calendarPreferences.googleCalendar?.accountEmail ?? '';
  const patch = (value: Partial<GoogleEventDraft>) => setDraft((current) => ({ ...current, ...value }));
  const toggleAllDay = (allDay: boolean) => {
    const today = dateInput(new Date().toISOString()).slice(0, 10);
    const startDay = (draft.allDay ? draft.start : dateInput(draft.start).slice(0, 10)) || today;
    const endDay = (draft.allDay ? draft.end : dateInput(draft.end).slice(0, 10)) || startDay;
    const tomorrow = new Date(Date.parse(`${startDay}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    patch({ allDay, start: allDay ? startDay : fromDateInput(`${startDay}T12:00`), end: allDay ? (endDay > startDay ? endDay : tomorrow) : fromDateInput(`${endDay}T13:00`) });
  };
  const connect = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const token = await requestGoogleCalendarToken(undefined, 'create');
      const available = await writableGoogleCalendars(token.accessToken, accountEmail);
      setCalendars(available); setCalendarId((current) => current || available[0]?.id || ''); setConnected(true);
      if (!available.length) throw new Error(t('No writable calendars.', 'Нет календарей с правом записи.'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const makeOperation = (): GoogleCreateOperation => operation ?? { eventId: 'utm00000', calendarId, accountEmail, draft };
  const showDate = (value: string) => draft.allDay ? value : new Intl.DateTimeFormat(ru ? 'ru-RU' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: deviceZone }).format(new Date(value));
  const review = () => {
    try { googleEventBody(makeOperation()); setError(''); setPreview(true); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const create = async () => {
    if (inFlight.current || done) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const next = operation ?? { ...makeOperation(), eventId: await googleCreationId(workspace.workspaceId, item.id) }; googleEventBody(next);
      setOperation(next);
      await onPrepareGoogleCreate(next);
      const token = await requestGoogleCalendarToken(undefined, 'create');
      const event = await createSingleGoogleEvent(token.accessToken, next);
      await onGoogleCreated(next, event);
      setDone(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <ResponsiveDialog open className="google-create-dialog" title={t('Create Google Calendar copy', 'Создать копию в Google Календаре')} onOpenChange={(open) => { if (!open && !busy) onClose(); }}
    footer={<><Button disabled={busy} onClick={onClose}>{t('Close', 'Закрыть')}</Button>{connected && !done && (preview
      ? <><Button disabled={busy || Boolean(operation)} onClick={() => setPreview(false)}>{t('Edit', 'Изменить')}</Button><Button variant="primary" disabled={busy || !calendarId} onClick={() => void create()}>{busy ? t('Working…', 'Выполняется…') : operation ? t('Check / retry creation', 'Проверить / повторить создание') : t('Create in Google Calendar', 'Создать в Google Календаре')}</Button></>
      : <Button variant="primary" disabled={busy || !calendarId} onClick={review}>{t('Preview', 'Предпросмотр')}</Button>)}</>}>
    <p>{t('Creates one independent event. The UTM item stays here; the Google copy also appears after sync and can reserve time separately.', 'Создаёт одно самостоятельное событие. Элемент UTM остаётся; копия Google тоже появится после синхронизации и может отдельно учитываться во времени.')}</p>
    <p>{t('Single event, without recurrence or guests. Google calendar default reminders apply.', 'Одно событие без повторения и гостей. Напоминания — по умолчанию выбранного Google-календаря.')}</p>
    {!connected && !done && <Button disabled={busy} onClick={() => void connect()}>{t('Authorize event creation', 'Разрешить создание событий')}</Button>}
    {error && <p role="alert">{error}</p>}
    {done ? <p role="status">{t('Event created and added to UTM.', 'Событие создано и добавлено в UTM.')}</p> : <>
      {operation && <p>{t('An operation is saved. Retrying uses the same calendar and event identifier.', 'Операция сохранена. Повторная попытка использует тот же календарь и идентификатор события.')}</p>}
      {preview ? <dl className="google-create-preview">
        <dt>{t('Calendar', 'Календарь')}</dt><dd>{calendars.find((calendar) => calendar.id === calendarId)?.summary || calendarId}</dd>
        <dt>{t('Title', 'Название')}</dt><dd>{draft.title}</dd>
        <dt>{t('Description', 'Описание')}</dt><dd>{draft.description || '—'}</dd>
        <dt>{t('Location', 'Место')}</dt><dd>{draft.location || '—'}</dd>
        <dt>{t('Event opens', 'Начало события')}</dt><dd>{showDate(draft.start)}</dd>
        <dt>{draft.allDay ? t('First day after the event', 'Первый день после события') : t('Event ends', 'Конец события')}</dt><dd>{showDate(draft.end)}</dd>
        <dt>{t('Timezone', 'Часовой пояс')}</dt><dd>{deviceZone}</dd>
        <dt>{t('All day', 'Весь день')}</dt><dd>{draft.allDay ? t('Yes', 'Да') : t('No', 'Нет')}</dd>
        <dt>{t('Availability', 'Занятость')}</dt><dd>{draft.busy ? t('Busy', 'Занят') : t('Free', 'Свободен')}</dd>
      </dl> : <fieldset className="google-create-fields" disabled={busy || Boolean(operation)}>
        <Field label={t('Calendar', 'Календарь')}><Select value={calendarId} onChange={(event) => setCalendarId(event.target.value)}><option value="">{t('Choose calendar', 'Выберите календарь')}</option>{calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.summary || calendar.id}</option>)}{operation && !calendars.some((calendar) => calendar.id === calendarId) && <option value={calendarId}>{calendarId}</option>}</Select></Field>
        <Field label={t('Title', 'Название')}><Input value={draft.title} onChange={(event) => patch({ title: event.target.value })}/></Field>
        <Field label={t('Description', 'Описание')}><Textarea value={draft.description} onChange={(event) => patch({ description: event.target.value })}/></Field>
        <Field label={t('Location', 'Место')}><Input value={draft.location} onChange={(event) => patch({ location: event.target.value })}/></Field>
        <Checkbox label={t('All day', 'Весь день')} checked={draft.allDay} onChange={(event) => toggleAllDay(event.target.checked)}/>
        <Field label={t('Event opens', 'Начало события')}><Input type={draft.allDay ? 'date' : 'datetime-local'} value={draft.allDay ? draft.start : dateInput(draft.start)} onChange={(event) => patch({ start: draft.allDay ? event.target.value : fromDateInput(event.target.value) || '' })}/></Field>
        <Field label={draft.allDay ? t('First day after the event', 'Первый день после события') : t('Event ends', 'Конец события')}><Input type={draft.allDay ? 'date' : 'datetime-local'} value={draft.allDay ? draft.end : dateInput(draft.end)} onChange={(event) => patch({ end: draft.allDay ? event.target.value : fromDateInput(event.target.value) || '' })}/></Field>
        <p>{t('Times are shown in device timezone:', 'Время показано в часовом поясе устройства:')} {deviceZone}</p>
        <Checkbox label={t('Busy', 'Занят')} checked={draft.busy} onChange={(event) => patch({ busy: event.target.checked })}/>
      </fieldset>}
    </>}
  </ResponsiveDialog>;
}
