import { useState } from 'react';
import { applyGoogleCalendarSync, reconcileCalendarOrganization, detachGoogleCalendar, createId, type GoogleCalendarPreferences, type WorkspaceDocument } from '@utm/core';
import { SearchableDisclosureList } from '../../components/ui/SearchableDisclosureList';
import { Button, Checkbox, Disclosure, Field, Input, Select } from '../../components/ui/primitives';
import { googleCalendarFailureDetails, recordDiagnostic, type GoogleCalendarSyncStage } from '../../services/diagnostics';
import { forgetGoogleCalendarAuthorization, GOOGLE_CALENDAR_CLIENT_ID, requestGoogleCalendarToken, synchronizeGoogleCalendars } from '../../services/googleCalendar';
import { disconnectNativeGoogle } from '../../services/nativeGoogleAuth';
import { isNativeGoogleAuthAvailable } from '../../services/nativeGoogleAuth';

type GoogleSyncLogEntry = { at: string; level: 'info' | 'error'; message: string };

export function CalendarIntegrationSettings({ workspace, commit, onFlush }: {
  workspace: WorkspaceDocument;
  commit: (message: string, mutation: (draft: WorkspaceDocument) => void) => boolean | void;
  onFlush: () => Promise<void>;
}) {
  const preferences = workspace.calendarPreferences;
  const googleAvailable = Boolean(GOOGLE_CALENDAR_CLIENT_ID) || isNativeGoogleAuthAvailable();
  const [googleToken, setGoogleToken] = useState<{ accessToken: string; expiresAt: number } | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState('');
  const [googleSyncStatus, setGoogleSyncStatus] = useState('');
  const [googleSyncLog, setGoogleSyncLog] = useState<GoogleSyncLogEntry[]>([]);

  const syncGoogle = async () => {
    const startedAt = performance.now();
    let diagnosticStage: GoogleCalendarSyncStage = 'authorization';
    const appendLog = (message: string, level: GoogleSyncLogEntry['level'] = 'info') => setGoogleSyncLog((entries) => [...entries, { at: new Date().toISOString(), level, message }].slice(-30));
    setGoogleBusy(true); setGoogleError('');
    const current: GoogleCalendarPreferences = preferences.googleCalendar ?? { connectionId: createId(), calendars: [], syncTokens: {} };
    try {
      const hasCurrentToken = Boolean(googleToken && googleToken.expiresAt > Date.now() + 60_000);
      setGoogleSyncStatus(hasCurrentToken ? 'Using current Google authorization…' : 'Waiting for Google authorization…');
      appendLog(hasCurrentToken ? 'Using current Google authorization.' : 'Waiting for Google authorization.');
      const token = hasCurrentToken ? googleToken! : await requestGoogleCalendarToken();
      setGoogleToken(token);
      appendLog('Google authorization received.');
      diagnosticStage = 'calendar-list';
      const result = await synchronizeGoogleCalendars(token.accessToken, current, (progress) => {
        diagnosticStage = progress.stage; setGoogleSyncStatus(progress.message); appendLog(progress.message);
      });
      diagnosticStage = 'save';
      setGoogleSyncStatus('Saving events to this workspace…'); appendLog('Saving downloaded events to this workspace.');
      const applied = commit('Sync Google Calendar', (draft) => {
        for (const batch of result.batches) applyGoogleCalendarSync(draft, batch);
        draft.calendarPreferences.googleCalendar = {
          ...JSON.parse(JSON.stringify(current)) as GoogleCalendarPreferences, connectionId: current.connectionId, calendars: result.calendars, syncTokens: result.syncTokens, syncWindow: result.syncWindow,
          ...(result.accountEmail ? { accountEmail: result.accountEmail } : {}), lastSyncedAt: result.syncedAt,
        };
        delete draft.calendarPreferences.googleCalendar.lastError;
        reconcileCalendarOrganization(draft);
      });
      if (applied === false) throw new Error('Could not save Google synchronization locally.');
      diagnosticStage = 'flush';
      await onFlush();
      window.dispatchEvent(new Event('utm-retry-google-queue'));
      const eventCount = result.batches.reduce((total, batch) => total + batch.events.length, 0);
      const durationMs = Math.round(performance.now() - startedAt);
      setGoogleSyncStatus(`Sync complete: ${eventCount} events.`);
      appendLog(`Sync complete: ${eventCount} events in ${(durationMs / 1_000).toFixed(1)}s.`);
      recordDiagnostic({ kind: 'result', message: 'Google Calendar sync completed', operation: 'Google Calendar sync', outcome: 'succeeded', durationMs, details: JSON.stringify({ calendars: result.batches.length, events: eventCount }) });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      const durationMs = Math.round(performance.now() - startedAt);
      setGoogleError(`${message} Stage: ${diagnosticStage}.`); setGoogleSyncStatus('Sync failed.'); appendLog(`Sync failed during ${diagnosticStage}: ${message}`, 'error');
      recordDiagnostic({ kind: 'error', message: 'Google Calendar sync failed', operation: 'Google Calendar sync', outcome: 'failed', durationMs, details: googleCalendarFailureDetails(diagnosticStage, reason) });
      if (preferences.googleCalendar) commit('Record Google Calendar sync error', (draft) => { if (draft.calendarPreferences.googleCalendar) draft.calendarPreferences.googleCalendar.lastError = message; });
    } finally { setGoogleBusy(false); }
  };

  const selectGoogleCalendar = (calendarId: string) => commit('Select Google calendar', (draft) => {
    const google = draft.calendarPreferences.googleCalendar;
    if (!google) return;
    const calendar = google.calendars.find((entry) => entry.id === calendarId);
    if (!calendar) return;
    calendar.selected = !calendar.selected;
    delete google.syncTokens[calendarId];
    if (!calendar.selected) {
      reconcileCalendarOrganization(draft);
      Object.values(draft.items).forEach((item) => {
      if (item.external?.provider !== 'google_calendar' || item.external.connectionId !== google.connectionId || item.external.calendarId !== calendarId) return;
      if (!item.external.readOnly) { detachGoogleCalendar(item); return; }
      delete draft.items[item.id]; delete draft.tombstones[item.id];
      });
    } else reconcileCalendarOrganization(draft);
  });

  const disconnectGoogleCalendar = async () => {
    if (!preferences.googleCalendar) return;
    const warning = preferences.language === 'ru'
      ? 'Отключить Google Календарь и удалить его зеркальные события из этого workspace? События в самом Google Календаре не изменятся.'
      : 'Disconnect Google Calendar and remove its mirrored events from this workspace? Your events in Google Calendar will not be changed.';
    if (!window.confirm(warning)) return;
    setGoogleBusy(true);
    try { await disconnectNativeGoogle(); }
    catch { setGoogleError('Could not remove Google authorization. Please retry.'); return; }
    finally { setGoogleBusy(false); }
    const connectionId = preferences.googleCalendar.connectionId;
    forgetGoogleCalendarAuthorization();
    setGoogleToken(null); setGoogleError(''); setGoogleSyncStatus(''); setGoogleSyncLog([]);
    commit('Disconnect Google Calendar', (draft) => {
      for (const item of Object.values(draft.items)) {
        if (item.external?.provider !== 'google_calendar' || item.external.connectionId !== connectionId) continue;
        if (!item.external.readOnly) { detachGoogleCalendar(item); continue; }
        delete draft.items[item.id]; delete draft.tombstones[item.id];
      }
      delete draft.calendarPreferences.googleCalendar;
    });
  };

  return <section className="settings-card calendar-dialog-fields" aria-label="Calendar and Google Calendar">
    <p className="eyebrow">CALENDAR</p><h2>Calendar preferences</h2>
    <Field label="Timezone"><Input value={preferences.timezone} onChange={(event) => commit('Change calendar timezone', (draft) => { draft.calendarPreferences.timezone = event.target.value; })} /></Field>
    <Field label="Week starts"><Select value={preferences.weekStartsOn} onChange={(event) => commit('Change first weekday', (draft) => { draft.calendarPreferences.weekStartsOn = Number(event.target.value) as 0 | 1; })}><option value="1">Monday</option><option value="0">Sunday</option></Select></Field>
    <hr />
    <section className="calendar-google-settings" aria-label="Google Calendar sync">
      <div><strong>Google Calendar</strong><small>{preferences.language === 'ru' ? 'Изменения отправляются только по кнопке сохранения. Связанные UTM-задачи сохраняются при отключении.' : 'Changes are sent only when you save in Google. Linked UTM tasks survive disconnection.'}</small></div>
      {preferences.googleCalendar && <><Field label={preferences.language === 'ru' ? 'Календарь по умолчанию для новых событий' : 'Default calendar for new events'}><Select value={preferences.googleCalendar.defaultCalendarId ?? ''} onChange={(event) => commit('Set default Google calendar', (draft) => { draft.calendarPreferences.googleCalendar!.defaultCalendarId = event.target.value; })}><option value="">{preferences.language === 'ru' ? 'Основной календарь' : 'Primary calendar'}</option>{preferences.googleCalendar.calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}</Select></Field><Button disabled={googleBusy} onClick={() => { setGoogleBusy(true); setGoogleError(''); void requestGoogleCalendarToken(undefined, 'create').catch((reason) => setGoogleError(String(reason))).finally(() => setGoogleBusy(false)); }}>{preferences.language === 'ru' ? 'Разрешить создание и изменение событий' : 'Authorize event creation and editing'}</Button></>}
      {!googleAvailable && <p className="hint">This build needs a Google OAuth client ID before connection is available.</p>}
      {preferences.googleCalendar?.accountEmail && <small>Connected as {preferences.googleCalendar.accountEmail}</small>}
      {preferences.googleCalendar && <Checkbox label={preferences.language === 'ru' ? 'Бета: редактировать события старше трёх часов' : 'Beta: edit events older than three hours'} checked={preferences.googleCalendar.allowPastEventEditing === true} onChange={(event) => commit('Toggle past event editing beta', (draft) => { draft.calendarPreferences.googleCalendar!.allowPastEventEditing = event.target.checked; })} />}
      {preferences.googleCalendar && <Disclosure persist={false} uiKey="calendar:google-write-safety" summary={preferences.language === 'ru' ? 'Защита данных Google' : 'Google data protection'}><p className="hint">{preferences.language === 'ru' ? 'UTM ограничивает исходящие изменения. При достижении лимита item сохраняется локально, а операция остаётся в очереди.' : 'UTM limits outgoing changes. When the limit is reached, the item stays saved locally and the operation remains queued.'}</p><div className="form-grid two"><Field label={preferences.language === 'ru' ? 'Изменений за 24 часа' : 'Changes per 24 hours'}><Input type="number" min={1} max={200} value={preferences.googleCalendar.writeDailyLimit ?? 25} onChange={(event) => commit('Change Google daily write limit', (draft) => { draft.calendarPreferences.googleCalendar!.writeDailyLimit = Math.max(1, Math.min(200, Number(event.target.value) || 25)); })} /></Field><Field label={preferences.language === 'ru' ? 'За одну синхронизацию' : 'Per synchronization'}><Input type="number" min={1} max={20} value={preferences.googleCalendar.writeBatchLimit ?? 5} onChange={(event) => commit('Change Google batch write limit', (draft) => { draft.calendarPreferences.googleCalendar!.writeBatchLimit = Math.max(1, Math.min(20, Number(event.target.value) || 5)); })} /></Field></div><small>{preferences.language === 'ru' ? `Использовано за последние 24 часа: ${(preferences.googleCalendar.writeTimestamps ?? []).filter((value) => Date.parse(value) >= Date.now() - 86_400_000).length}` : `Used in the last 24 hours: ${(preferences.googleCalendar.writeTimestamps ?? []).filter((value) => Date.parse(value) >= Date.now() - 86_400_000).length}`}</small></Disclosure>}
      {preferences.googleCalendar?.calendars.filter((calendar) => calendar.selected).map((calendar) => <Disclosure key={`organization:${calendar.id}`} persist={false} uiKey={`calendar-organization:${calendar.id}`} summary={<span style={calendar.color ? { color: calendar.color } : undefined}>{calendar.name} · PARA</span>}>
        {(['areas', 'projects'] as const).map((kind) => <SearchableDisclosureList key={kind} uiKey={`calendar:${calendar.id}:${kind}`} summary={`${kind === 'areas' ? 'Areas' : 'Projects'} · ${calendar[kind]?.length ?? 0}`} items={Object.keys(kind === 'areas' ? workspace.areaDefinitions : workspace.projectDefinitions)} getSearchText={(name) => name} searchLabel={`Search ${kind}`} renderItem={(name) => <Checkbox key={name} label={name} checked={calendar[kind]?.includes(name) ?? false} onChange={(event) => commit('Change calendar PARA assignments', (draft) => { const target = draft.calendarPreferences.googleCalendar!.calendars.find((entry) => entry.id === calendar.id)!; target[kind] = event.target.checked ? [...new Set([...(target[kind] ?? []), name])] : (target[kind] ?? []).filter((entry) => entry !== name); reconcileCalendarOrganization(draft); })} />} />)}
      </Disclosure>)}
      {preferences.googleCalendar?.calendars.length ? <div className="calendar-google-list">{preferences.googleCalendar.calendars.map((calendar) => <Checkbox key={calendar.id} label={`${calendar.name}${calendar.primary ? ' · primary' : ''}`} checked={calendar.selected} onChange={() => selectGoogleCalendar(calendar.id)} />)}</div> : null}
      <div className="settings-actions"><Button onClick={() => void syncGoogle()} disabled={googleBusy || !googleAvailable}>{googleBusy ? 'Syncing…' : preferences.googleCalendar ? 'Sync now' : 'Connect Google Calendar'}</Button>{preferences.googleCalendar && <Button variant="ghost" disabled={googleBusy} onClick={disconnectGoogleCalendar}>Disconnect Google Calendar</Button>}</div>
      {googleSyncStatus && <small className="calendar-google-status" role="status" aria-live="polite">{googleSyncStatus}</small>}
      {preferences.googleCalendar?.lastSyncedAt && <small>Last synced {new Intl.DateTimeFormat(preferences.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(preferences.googleCalendar.lastSyncedAt))}</small>}
      {(googleError || preferences.googleCalendar?.lastError) && <p className="form-error" role="alert">{googleError || preferences.googleCalendar?.lastError}</p>}
      {googleSyncLog.length > 0 && <Disclosure uiKey="calendar:google-sync-log" persist={false} className="calendar-google-log" summary={<span>Sync log <small>{googleSyncLog.length}</small></span>}><ol>{googleSyncLog.map((entry, index) => <li data-level={entry.level} key={`${entry.at}:${index}`}><time dateTime={entry.at}>{new Intl.DateTimeFormat(preferences.language, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(entry.at))}</time><span>{entry.message}</span></li>)}</ol></Disclosure>}
    </section>
  </section>;
}
