import { useState } from 'react';
import { applyGoogleCalendarSync, createId, type GoogleCalendarPreferences, type WorkspaceDocument } from '@utm/core';
import { Button, Checkbox, Disclosure, Field, Input, Select } from '../../components/ui/primitives';
import { recordDiagnostic } from '../../services/diagnostics';
import { GOOGLE_CALENDAR_CLIENT_ID, requestGoogleCalendarToken, synchronizeGoogleCalendars } from '../../services/googleCalendar';

type GoogleSyncLogEntry = { at: string; level: 'info' | 'error'; message: string };

export function CalendarIntegrationSettings({ workspace, commit }: {
  workspace: WorkspaceDocument;
  commit: (message: string, mutation: (draft: WorkspaceDocument) => void) => void;
}) {
  const preferences = workspace.calendarPreferences;
  const [googleToken, setGoogleToken] = useState<{ accessToken: string; expiresAt: number } | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState('');
  const [googleSyncStatus, setGoogleSyncStatus] = useState('');
  const [googleSyncLog, setGoogleSyncLog] = useState<GoogleSyncLogEntry[]>([]);

  const syncGoogle = async () => {
    const startedAt = performance.now();
    let diagnosticStage = 'authorization';
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
      diagnosticStage = 'download';
      const result = await synchronizeGoogleCalendars(token.accessToken, current, (progress) => {
        diagnosticStage = progress.stage; setGoogleSyncStatus(progress.message); appendLog(progress.message);
      });
      diagnosticStage = 'save';
      setGoogleSyncStatus('Saving events to this workspace…'); appendLog('Saving downloaded events to this workspace.');
      commit('Sync Google Calendar', (draft) => {
        for (const batch of result.batches) applyGoogleCalendarSync(draft, batch);
        draft.calendarPreferences.googleCalendar = {
          connectionId: current.connectionId, calendars: result.calendars, syncTokens: result.syncTokens, syncWindow: result.syncWindow,
          ...(result.accountEmail ? { accountEmail: result.accountEmail } : {}), lastSyncedAt: result.syncedAt,
        };
      });
      const eventCount = result.batches.reduce((total, batch) => total + batch.events.length, 0);
      const durationMs = Math.round(performance.now() - startedAt);
      setGoogleSyncStatus(`Sync complete: ${eventCount} events.`);
      appendLog(`Sync complete: ${eventCount} events in ${(durationMs / 1_000).toFixed(1)}s.`);
      recordDiagnostic({ kind: 'result', message: 'Google Calendar sync completed', operation: 'Google Calendar sync', outcome: 'succeeded', durationMs, details: JSON.stringify({ calendars: result.batches.length, events: eventCount }) });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      const durationMs = Math.round(performance.now() - startedAt);
      setGoogleError(`${message} Stage: ${diagnosticStage}.`); setGoogleSyncStatus('Sync failed.'); appendLog(`Sync failed during ${diagnosticStage}: ${message}`, 'error');
      recordDiagnostic({ kind: 'error', message: 'Google Calendar sync failed', operation: 'Google Calendar sync', outcome: 'failed', durationMs, details: JSON.stringify({ stage: diagnosticStage, status: (reason as { status?: unknown })?.status ?? null, errorType: reason instanceof Error ? reason.name : typeof reason }) });
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
    if (!calendar.selected) Object.values(draft.items).forEach((item) => {
      if (item.external?.provider !== 'google_calendar' || item.external.connectionId !== google.connectionId || item.external.calendarId !== calendarId) return;
      delete draft.items[item.id]; delete draft.tombstones[item.id];
    });
  });

  return <section className="settings-card calendar-dialog-fields" aria-label="Calendar and Google Calendar">
    <p className="eyebrow">CALENDAR</p><h2>Calendar preferences</h2>
    <Field label="Timezone"><Input value={preferences.timezone} onChange={(event) => commit('Change calendar timezone', (draft) => { draft.calendarPreferences.timezone = event.target.value; })} /></Field>
    <Field label="Week starts"><Select value={preferences.weekStartsOn} onChange={(event) => commit('Change first weekday', (draft) => { draft.calendarPreferences.weekStartsOn = Number(event.target.value) as 0 | 1; })}><option value="1">Monday</option><option value="0">Sunday</option></Select></Field>
    <hr />
    <section className="calendar-google-settings" aria-label="Google Calendar sync">
      <div><strong>Google Calendar</strong><small>Read-only. Events are mirrored into this workspace; editing opens Google Calendar.</small></div>
      {!GOOGLE_CALENDAR_CLIENT_ID && <p className="hint">This build needs a Google OAuth client ID before connection is available.</p>}
      {preferences.googleCalendar?.accountEmail && <small>Connected as {preferences.googleCalendar.accountEmail}</small>}
      {preferences.googleCalendar?.calendars.length ? <div className="calendar-google-list">{preferences.googleCalendar.calendars.map((calendar) => <Checkbox key={calendar.id} label={`${calendar.name}${calendar.primary ? ' · primary' : ''}`} checked={calendar.selected} onChange={() => selectGoogleCalendar(calendar.id)} />)}</div> : null}
      <Button onClick={() => void syncGoogle()} disabled={googleBusy || !GOOGLE_CALENDAR_CLIENT_ID}>{googleBusy ? 'Syncing…' : preferences.googleCalendar ? 'Sync now' : 'Connect Google Calendar'}</Button>
      {googleSyncStatus && <small className="calendar-google-status" role="status" aria-live="polite">{googleSyncStatus}</small>}
      {preferences.googleCalendar?.lastSyncedAt && <small>Last synced {new Intl.DateTimeFormat(preferences.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(preferences.googleCalendar.lastSyncedAt))}</small>}
      {(googleError || preferences.googleCalendar?.lastError) && <p className="form-error" role="alert">{googleError || preferences.googleCalendar?.lastError}</p>}
      {googleSyncLog.length > 0 && <Disclosure uiKey="calendar:google-sync-log" persist={false} className="calendar-google-log" summary={<span>Sync log <small>{googleSyncLog.length}</small></span>}><ol>{googleSyncLog.map((entry, index) => <li data-level={entry.level} key={`${entry.at}:${index}`}><time dateTime={entry.at}>{new Intl.DateTimeFormat(preferences.language, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(entry.at))}</time><span>{entry.message}</span></li>)}</ol></Disclosure>}
    </section>
  </section>;
}
