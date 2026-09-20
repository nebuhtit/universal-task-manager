import { useRef, useState } from 'react';
import type { GoogleCalendarEvent, UniversalItem, WorkspaceDocument } from '@utm/core';
import { ResponsiveDialog } from '../../components/ui/ResponsiveDialog';
import { Button, Checkbox, Field, Input, Select, Textarea } from '../../components/ui/primitives';
import { dateInput, fromDateInput } from '../../utils/dates';
import { calendarDurationMs, effectiveScheduleDuration } from '../../utils/durations';
import { requestGoogleCalendarToken } from '../../services/googleCalendar';
import { createSingleGoogleEvent, googleCreationId, googleEventBody, GOOGLE_CREATE_EXTENSION, type GoogleCreateOperation, type GoogleEventDraft } from '../../services/googleCalendarCreate';
import './google-create.css';

export interface GoogleCreationCallbacks {
  onPrepareGoogleCreate: (operation: GoogleCreateOperation) => Promise<void>;
  onGoogleCreated: (operation: GoogleCreateOperation, event: GoogleCalendarEvent) => Promise<UniversalItem | undefined>;
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
  const calendars = (workspace.calendarPreferences.googleCalendar?.calendars ?? []).map((calendar) => ({ id: calendar.id, summary: calendar.name }));
  const [calendarId, setCalendarId] = useState(previous?.calendarId || workspace.calendarPreferences.googleCalendar?.defaultCalendarId || calendars.find((calendar) => calendar.id === workspace.calendarPreferences.googleCalendar?.accountEmail)?.id || calendars[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  const accountEmail = workspace.calendarPreferences.googleCalendar?.accountEmail ?? '';
  const patch = (value: Partial<GoogleEventDraft>) => setDraft((current) => ({ ...current, ...value }));
  const toggleAllDay = (allDay: boolean) => {
    const today = dateInput(new Date().toISOString()).slice(0, 10);
    const startDay = (draft.allDay ? draft.start : dateInput(draft.start).slice(0, 10)) || today;
    const endDay = (draft.allDay ? draft.end : dateInput(draft.end).slice(0, 10)) || startDay;
    const tomorrow = new Date(Date.parse(`${startDay}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    patch({ allDay, start: allDay ? startDay : fromDateInput(`${startDay}T12:00`), end: allDay ? (endDay > startDay ? endDay : tomorrow) : fromDateInput(`${endDay}T13:00`) });
  };
  const makeOperation = (): GoogleCreateOperation => operation ?? { eventId: 'utm00000', calendarId, accountEmail, draft };
  const create = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const token = await requestGoogleCalendarToken(undefined, 'create');
      const next = operation ?? { ...makeOperation(), eventId: await googleCreationId(workspace.workspaceId, item.occurrence ? `${item.id}:${item.occurrence.recurrenceId}` : item.id) }; googleEventBody(next);
      setOperation(next);
      await onPrepareGoogleCreate(next);
      const event = await createSingleGoogleEvent(token.accessToken, next);
      await onGoogleCreated(next, event);
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <ResponsiveDialog open className="google-create-dialog" title={t('Create linked Google event', 'Создать связанное событие Google')} onOpenChange={(open) => { if (!open && !busy) onClose(); }}
    footer={<><Button disabled={busy} onClick={onClose}>{t('Close', 'Закрыть')}</Button><Button variant="primary" disabled={busy || !calendarId} onClick={() => void create()}>{operation ? t('Check / retry creation', 'Проверить / повторить создание') : t('Create in Google Calendar', 'Создать в Google Календаре')}</Button></>}>
    <p>{t('One linked UTM + Google item. The UTM estimate and history stay separate from calendar timing. No recurrence or guests are copied.', 'Один связанный элемент UTM + Google. Оценка и история UTM независимы от времени события. Повторения и гости не копируются.')}</p>
    {error && <p role="alert">{error}</p>}
    {operation && <p>{t('Retry checks the saved operation before sending again.', 'Повторная попытка сначала проверяет сохранённую операцию.')}</p>}
    <fieldset className="google-create-fields" disabled={busy || Boolean(operation)}>
        <Field label={t('Calendar', 'Календарь')}><Select value={calendarId} onChange={(event) => setCalendarId(event.target.value)}><option value="">{t('Choose calendar', 'Выберите календарь')}</option>{calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.summary || calendar.id}</option>)}{operation && !calendars.some((calendar) => calendar.id === calendarId) && <option value={calendarId}>{calendarId}</option>}</Select></Field>
        <Field label={t('Title', 'Название')}><Input value={draft.title} onChange={(event) => patch({ title: event.target.value })}/></Field>
        <Field label={t('Description', 'Описание')}><Textarea value={draft.description} onChange={(event) => patch({ description: event.target.value })}/></Field>
        <Field label={t('Location', 'Место')}><Input value={draft.location} onChange={(event) => patch({ location: event.target.value })}/></Field>
        <Checkbox label={t('All day', 'Весь день')} checked={draft.allDay} onChange={(event) => toggleAllDay(event.target.checked)}/>
        <Field label={t('Event opens', 'Начало события')}><Input type={draft.allDay ? 'date' : 'datetime-local'} value={draft.allDay ? draft.start : dateInput(draft.start)} onChange={(event) => patch({ start: draft.allDay ? event.target.value : fromDateInput(event.target.value) || '' })}/></Field>
        <Field label={draft.allDay ? t('First day after the event', 'Первый день после события') : t('Event ends', 'Конец события')}><Input type={draft.allDay ? 'date' : 'datetime-local'} value={draft.allDay ? draft.end : dateInput(draft.end)} onChange={(event) => patch({ end: draft.allDay ? event.target.value : fromDateInput(event.target.value) || '' })}/></Field>
        <p>{t('Times are shown in device timezone:', 'Время показано в часовом поясе устройства:')} {deviceZone}</p>
        <Checkbox label={t('Busy', 'Занят')} checked={draft.busy} onChange={(event) => patch({ busy: event.target.checked })}/>
    </fieldset>
  </ResponsiveDialog>;
}
