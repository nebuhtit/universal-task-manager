import { useRef, useState } from 'react';
import { zonedDateTime, type GoogleCalendarEvent, type UniversalItem, type WorkspaceDocument } from '@utm/core';
import { ResponsiveDialog } from '../../components/ui/ResponsiveDialog';
import { Button, Checkbox, Field, Input, Textarea } from '../../components/ui/primitives';
import { requestGoogleCalendarToken } from '../../services/googleCalendar';
import { canEditGoogleEvent, GOOGLE_EDIT_EXTENSION, GoogleEditConflict, googleEventChanges, googleEventDraft, rebaseGoogleEdit, loadEditableGoogleEvent, updateSingleGoogleEvent, type GoogleEditOperation } from '../../services/googleCalendarEdit';
import type { GoogleEventDraft } from '../../services/googleCalendarCreate';
import './google-create.css';

export interface GoogleEditingCallbacks {
  onGoogleEditDraft: (operation: GoogleEditOperation | null) => Promise<void>;
  onGoogleUpdated: (event: GoogleCalendarEvent) => Promise<void>;
}
function wallTime(iso: string, timeZone: string): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return '';
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  } catch { return ''; }
}
export function EditGoogleEventDialog({ item, workspace, onClose, onGoogleEditDraft, onGoogleUpdated }: GoogleEditingCallbacks & { item: UniversalItem; workspace: WorkspaceDocument; onClose: () => void }) {
  const ru = workspace.calendarPreferences.language === 'ru';
  const t = (en: string, russian: string) => ru ? russian : en;
  const [operation, setOperation] = useState<GoogleEditOperation | undefined>(() => item.extensions?.[GOOGLE_EDIT_EXTENSION] as unknown as GoogleEditOperation | undefined);
  const [preview, setPreview] = useState(Boolean(operation?.attempted));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const inFlight = useRef(false);
  const draft = operation?.draft;
  const execute = async (action: () => Promise<void>) => { if (inFlight.current) return; inFlight.current = true; setBusy(true); setError(''); try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setConflict(reason instanceof GoogleEditConflict); } finally { inFlight.current = false; setBusy(false); } };
  const load = () => execute(async () => {
    const token = await requestGoogleCalendarToken(undefined, 'create');
    const accountEmail = workspace.calendarPreferences.googleCalendar?.accountEmail ?? '';
    const { event, timeZone } = await loadEditableGoogleEvent(token.accessToken, item.external!.calendarId, item.external!.eventId, accountEmail);
    if (!canEditGoogleEvent(event, timeZone)) throw new Error(t('Editing is available until 3 hours after the event ends.', 'Редактировать можно не позднее трёх часов после окончания события.'));
    const next: GoogleEditOperation = { calendarId: item.external!.calendarId, eventId: item.external!.eventId, accountEmail, baseline: event, draft: operation ? rebaseGoogleEdit(operation, event, timeZone) : googleEventDraft(event, timeZone) };
    setOperation(next); setConflict(false); setPreview(false); await onGoogleEditDraft(next);
  });
  const patch = (value: Partial<GoogleEventDraft>) => { if (operation) setOperation({ ...operation, draft: { ...operation.draft, ...value }, attempted: false }); };
  const review = () => execute(async () => { if (!operation) return; googleEventChanges(operation); await onGoogleEditDraft(operation); setPreview(true); });
  const save = () => execute(async () => {
    if (!operation) return;
    const token = await requestGoogleCalendarToken(undefined, 'create');
    const attempted = { ...operation, attempted: true };
    await onGoogleEditDraft(attempted); setOperation(attempted);
    const event = await updateSingleGoogleEvent(token.accessToken, operation);
    await onGoogleUpdated(event); onClose();
  });
  const close = () => execute(async () => { if (operation) await onGoogleEditDraft(operation); onClose(); });
  const toggleDay = (allDay: boolean) => {
    if (!draft) return;
    const startDay = draft.allDay ? draft.start : wallTime(draft.start, draft.timeZone).slice(0, 10);
    const endDay = draft.allDay ? draft.end : wallTime(draft.end, draft.timeZone).slice(0, 10);
    const nextDay = new Date(Date.parse(`${startDay}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    patch({ allDay, start: allDay ? startDay : zonedDateTime(startDay, 12, 0, draft.timeZone).toISOString(), end: allDay ? endDay > startDay ? endDay : nextDay : zonedDateTime(endDay, 13, 0, draft.timeZone).toISOString() });
  };
  const labels: Record<string, string> = { summary: t('Title', 'Название'), description: t('Description', 'Описание'), location: t('Location', 'Место'), start: t('Event opens', 'Начало'), end: t('Event ends', 'Окончание'), transparency: t('Availability', 'Занятость') };
  const renderValue = (key: string, value: unknown) => { if (key === 'transparency') return value === 'transparent' ? t('Free', 'Свободен') : t('Busy', 'Занят'); if (key === 'start' || key === 'end') { const date = value as { date?: string; dateTime?: string; timeZone?: string } | undefined; return date?.date ?? (date?.dateTime ? `${wallTime(date.dateTime, date.timeZone ?? draft?.timeZone ?? 'UTC').replace('T', ' ')} (${date.timeZone ?? draft?.timeZone})` : '—'); } return String(value ?? '') || '—'; };
  return <ResponsiveDialog open className="google-create-dialog" title={t('Edit Google event', 'Изменить событие Google')} onOpenChange={(open) => { if (!open && !busy) void close(); }} footer={<><Button disabled={busy} onClick={() => void close()}>{t('Close', 'Закрыть')}</Button>{operation && !conflict && (preview ? <><Button disabled={busy || operation.attempted} onClick={() => setPreview(false)}>{t('Back', 'Назад')}</Button><Button variant="primary" disabled={busy} onClick={() => void save()}>{operation.attempted ? t('Check / retry save', 'Проверить / повторить сохранение') : t('Save in Google', 'Сохранить в Google')}</Button></> : <Button disabled={busy} onClick={() => void review()}>{t('Preview changes', 'Проверить изменения')}</Button>)}</>}>
    <p>{t('Changes apply only to this occurrence. Google notifies attendees when appropriate.', 'Изменения применяются только к этому повторению. Google при необходимости уведомит участников.')}</p>
    {(!operation || conflict) && <Button disabled={busy} onClick={() => void load()}>{conflict ? t('Load current event; keep my draft', 'Загрузить актуальное, сохранив мой текст') : t('Load event for editing', 'Загрузить событие для редактирования')}</Button>}
    {error && <p role="alert">{error}</p>}
    {operation && draft && (preview ? <dl className="google-create-preview">{Object.entries(googleEventChanges(operation)).map(([key, value]) => <div key={key}><dt>{labels[key]}</dt><dd data-utm-user-data>{renderValue(key, operation.baseline[key as keyof GoogleCalendarEvent])} → {renderValue(key, value)}</dd></div>)}</dl> : <fieldset className="google-create-fields" disabled={busy || conflict}>
      <Field label={t('Title', 'Название')}><Input value={draft.title} onChange={(event) => patch({ title: event.target.value })} /></Field>
      <Field label={t('Description', 'Описание')}><Textarea value={draft.description} onChange={(event) => patch({ description: event.target.value })} /></Field>
      <Field label={t('Location', 'Место')}><Input value={draft.location} onChange={(event) => patch({ location: event.target.value })} /></Field>
      <Field label={t('Timezone', 'Часовой пояс')}><Input value={draft.timeZone} onChange={(event) => patch({ timeZone: event.target.value })} /></Field>
      <Checkbox label={t('All day', 'Весь день')} checked={draft.allDay} onChange={(event) => { try { toggleDay(event.target.checked); } catch { setError(t('Enter a valid timezone and dates.', 'Укажите корректный часовой пояс и даты.')); } }} />
      {(['start', 'end'] as const).map((key) => <Field key={key} label={key === 'start' ? t('Event opens', 'Начало') : draft.allDay ? t('First day after the event', 'Первый день после события') : t('Event ends', 'Окончание')}><Input type={draft.allDay ? 'date' : 'datetime-local'} value={draft.allDay ? draft[key] : wallTime(draft[key], draft.timeZone)} onChange={(event) => { try { const value = event.target.value; if (draft.allDay) patch({ [key]: value }); else if (value) { const [day, time] = value.split('T'); const [hour, minute] = time!.split(':').map(Number); patch({ [key]: zonedDateTime(day!, hour!, minute!, draft.timeZone).toISOString() }); } } catch { setError(t('Invalid date or timezone.', 'Некорректная дата или часовой пояс.')); } }} /></Field>)}
      <Checkbox label={t('Busy', 'Занят')} checked={draft.busy} onChange={(event) => patch({ busy: event.target.checked })} />
    </fieldset>)}
  </ResponsiveDialog>;
}
