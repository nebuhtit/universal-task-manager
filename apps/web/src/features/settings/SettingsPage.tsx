import { useEffect, useRef, useState } from 'react';
import { interfaceLanguages } from '../../i18n';
import { CalendarIntegrationSettings } from '../calendar/CalendarIntegrationSettings';
import { useLegacyModalDismiss } from '../../components/ui/useLegacyModalDismiss';
import { LineIcon } from '../../components/ui/icons';
import { Button, Field, Input } from '../../components/ui/primitives';
import { BUILT_IN_VIEW_TEMPLATES } from '../views/viewTemplates';
import { formatRussianDateTime } from '../../utils/dates';
import {
  APP_VERSION, createId, createWorkspace, effectiveWorkspaceNow, parseExpression,
  testClockDisplay, testDayDurationSeconds,
  type CustomFieldDefinition, type SavedView, type TestClockUnit,
  type UniversalItem, type WorkspaceDocument,
} from '@utm/core';
import {
  changePassword, disablePasswordRequirement, enablePasswordRequirement,
  exportLocalWorkspaceSnapshot, listLocalWorkspaceSnapshots, reencryptWorkspaceFile,
  restoreLocalWorkspaceSnapshot,
  type LocalWorkspaceSnapshotInfo, type PasswordProtectionStatus, type UnlockedWorkspace,
} from '@utm/sdk';

export type PortableFormat = 'json' | 'csv' | 'xlsx' | 'ics';
const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const safeFilename = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'universal';
const downloadText = (content: string, filename: string, type = 'application/json') => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
};
const readEncryptedBackup = async (file: File): Promise<string> => new TextDecoder().decode(await file.arrayBuffer());

function ProductGuide() {
  return <details className="settings-disclosure"><summary>Guide: idea & scenarios / Идея и сценарии</summary><section className="settings-card settings-guide"><p className="eyebrow">UNIVERSAL TASK MANAGER</p><h2>One workspace for attention, time and context</h2><p><strong>Русский.</strong> Universal — локальный рабочий стол для задач, событий, привычек и повторяющихся дел. Item не копируется между экранами: один и тот же item может одновременно появляться в Today, Calendar, проекте, Area, Tag и собственных Views. Views только отбирают и сортируют данные; они не создают дубликаты.</p><p><strong>English.</strong> Universal is a local-first workspace for tasks, events, habits and repeating work. An item is never copied between screens: the same item can appear in Today, Calendar, a Project, an Area, a Tag and custom Views. Views only filter and sort data; they do not create duplicates.</p><details className="settings-guide-section" open><summary>Popular workflows / Популярные сценарии</summary><div><h3>1. Daily focus / План на день</h3><p><strong>RU:</strong> В Today оставьте только нужные условия: deadline, активный диапазон или event opens. Добавьте Duration, чтобы видеть занятое и свободное время. Завершите item — Undo даёт несколько секунд на отмену.</p><p><strong>EN:</strong> Keep only the relevant conditions in Today: deadline, active range or event opens. Add Duration to see reserved and free time. Completing an item includes a short Undo window.</p><h3>2. Projects, Areas and Tags / Проекты, области и теги</h3><p><strong>RU:</strong> Area — постоянная сфера, Project — конкретный результат, Tag — поперечный контекст. Unified priority решает, какая из всех связей item важнее: выигрывает связь, стоящая выше в общей лестнице.</p><p><strong>EN:</strong> An Area is an ongoing responsibility, a Project is a concrete outcome, and a Tag is a cross-cutting context. Unified priority selects the highest matching relationship across all of them.</p><h3>3. Capacity planning / Планирование ресурса</h3><p><strong>RU:</strong> Для периодического сна, работы или занятий создайте recurring item и включите его в reserved items View. Статистика вычитает такие Duration из периода и показывает свободное время.</p><p><strong>EN:</strong> Create recurring items for sleep, work or regular commitments and include them as reserved items in a View. Statistics subtract their Duration from the period and show free time.</p><h3>4. Repeating routines / Повторяющиеся дела</h3><p><strong>RU:</strong> Для «раз в три недели после выполнения» включите Repeat after completion: следующий цикл считается от фактического завершения. Для расписания по датам используйте Event-based recurrence.</p><p><strong>EN:</strong> For “every three weeks after completion”, enable Repeat after completion: the next cycle is calculated from the real completion time. Use event-based recurrence for calendar schedules.</p><h3>5. Calendar and reminders / Календарь и напоминания</h3><p><strong>RU:</strong> Calendar — это дневной список, а не отдельная база: его фильтр определяет, какие пересечения Schedule попадут в выбранный день. Reminders помогают не забыть момент; они не меняют план и не создают новый item.</p><p><strong>EN:</strong> Calendar is a daily list, not a separate database: its filter defines which Schedule intersections appear on the selected day. Reminders help you remember a moment; they do not alter the plan or create new items.</p><h3>Safety and backups / Безопасность и резервные копии</h3><p><strong>RU:</strong> Workspace хранится локально и зашифрован. Регулярно экспортируйте <code>.utmb</code> в Files или iCloud. Не передавайте пароль, резервную копию и расшифрованный JSON третьим лицам.</p><p><strong>EN:</strong> The workspace is local and encrypted. Export a <code>.utmb</code> backup regularly to Files or iCloud. Do not share the password, backup, or readable JSON with third parties.</p></div></details></section></details>;
}

function PasswordProtectionSettings({ status, onStatusChange, onBeforeCriticalAction }: {
  status: PasswordProtectionStatus | 'checking';
  onStatusChange: () => Promise<PasswordProtectionStatus>;
  onBeforeCriticalAction: () => Promise<void>;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [backupOldPassword, setBackupOldPassword] = useState('');
  const [backupNewPassword, setBackupNewPassword] = useState('');
  const [backupConfirmPassword, setBackupConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const backupInput = useRef<HTMLInputElement>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('');
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const updatePassword = () => void run(async () => {
    if (newPassword.length < 10) throw new Error('New password must contain at least 10 characters');
    if (newPassword !== confirmPassword) throw new Error('New passwords do not match');
    await onBeforeCriticalAction();
    await changePassword(currentPassword, newPassword);
    setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    setMessage('Password changed. Existing backups and saved workspace versions still use their previous passwords.');
  });
  const toggleRequirement = () => void run(async () => {
    await onBeforeCriticalAction();
    if (status === 'disabled') await enablePasswordRequirement(currentPassword);
    else await disablePasswordRequirement(currentPassword);
    const next = await onStatusChange();
    setCurrentPassword('');
    setMessage(next === 'disabled'
      ? 'Password prompt disabled on this device. Anyone with access to this browser profile can open the workspace.'
      : 'Password is required again when this workspace starts or locks.');
  });
  const reencryptBackup = (file: File) => void run(async () => {
    if (backupNewPassword.length < 10) throw new Error('New backup password must contain at least 10 characters');
    if (backupNewPassword !== backupConfirmPassword) throw new Error('New backup passwords do not match');
    const result = await reencryptWorkspaceFile(await readEncryptedBackup(file), backupOldPassword, backupNewPassword);
    const sourceName = file.name.replace(/\.utmb$/i, '');
    downloadText(result.source, `${safeFilename(sourceName)}-reencrypted-v${APP_VERSION}.utmb`, 'application/octet-stream');
    setBackupOldPassword(''); setBackupNewPassword(''); setBackupConfirmPassword('');
    setMessage('Re-encrypted backup verified and downloaded. The original file was not changed.');
  });
  const encrypted = status !== 'plaintext';
  return <details className="settings-disclosure"><summary>Password protection</summary><section className="settings-card password-protection-settings">
    <p className="eyebrow">LOCAL SECURITY</p><h2>Password protection</h2>
    {status === 'checking' ? <p>Checking password protection…</p> : status === 'plaintext' ? <p className="error" role="alert">This test workspace is stored without encryption. Create an encrypted workspace to use password protection.</p> : <>
      <div className="setting-row"><span><strong>Password on startup</strong><small>{status === 'disabled' ? 'Disabled on this device' : 'Required'}</small></span></div>
      <p>The current password is required to change the password or toggle the startup prompt. Passwords stay in memory only while an action is running.</p>
      {status === 'disabled' && <p className="error" role="alert">The workspace block remains encrypted, but its unlock key is saved in this browser profile. Anyone who can open this profile can read the workspace.</p>}
      <Field label="Current password"><Input type="password" minLength={10} autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></Field>
      <div className="form-grid two">
        <Field label="New password"><Input type="password" minLength={10} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></Field>
        <Field label="Confirm new password"><Input type="password" minLength={10} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></Field>
      </div>
      <div className="settings-actions">
        <Button disabled={busy || currentPassword.length < 10 || newPassword.length < 10 || newPassword !== confirmPassword} onClick={updatePassword}>Change password</Button>
        <Button variant={status === 'disabled' ? 'primary' : 'destructive'} disabled={busy || currentPassword.length < 10} onClick={toggleRequirement}>{status === 'disabled' ? 'Require password on startup' : 'Disable password on this device'}</Button>
      </div>
    </>}
    {encrypted && <><hr/><h2>Old encrypted backups</h2>
      <p>Changing the workspace password cannot modify files already saved in Files, iCloud Drive or another folder. Those backups and older saved workspace versions keep their old passwords.</p>
      <p className="hint">A selected valid .utmb can be fully opened with its old password, encrypted again with a new password and verified before download. Universal cannot make an already outdated backup current or repair a damaged source; it refuses the conversion instead. The original file is never overwritten.</p>
      <div className="form-grid two">
        <Field label="Old backup password"><Input type="password" minLength={10} autoComplete="current-password" value={backupOldPassword} onChange={(event) => setBackupOldPassword(event.target.value)} /></Field>
        <Field label="New backup password"><Input type="password" minLength={10} autoComplete="new-password" value={backupNewPassword} onChange={(event) => setBackupNewPassword(event.target.value)} /></Field>
      </div>
      <Field label="Confirm new backup password"><Input type="password" minLength={10} autoComplete="new-password" value={backupConfirmPassword} onChange={(event) => setBackupConfirmPassword(event.target.value)} /></Field>
      <Button disabled={busy || backupOldPassword.length < 10 || backupNewPassword.length < 10 || backupNewPassword !== backupConfirmPassword} onClick={() => backupInput.current?.click()}>Choose and re-encrypt old backup…</Button>
      <input ref={backupInput} hidden type="file" accept=".utmb,application/octet-stream" onChange={(event) => { const file = event.target.files?.[0]; if (file) reencryptBackup(file); event.currentTarget.value = ''; }} />
    </>}
    {error && <p className="error" role="alert">{error}</p>}{message && <p className="success" role="status">{message}</p>}
  </section></details>;
}

export function SettingsPage({ workspace, passwordProtection, onPasswordProtectionChanged, onBeforeCriticalAction, onExportAll, onDownloadLockedRecoveryCopy, commit, onNotify, onTransfer, onImportFile, onEnableBackground, onDisableBackground, onBackgroundContent, onRestoredSnapshot }: {
  workspace: WorkspaceDocument; commit: (message: string, mutation: (draft: WorkspaceDocument) => void) => void;
  passwordProtection: PasswordProtectionStatus | 'checking'; onPasswordProtectionChanged: () => Promise<PasswordProtectionStatus>;
  onBeforeCriticalAction: () => Promise<void>;
  onExportAll: (format: PortableFormat, metadata?: boolean) => Promise<void>;
  onDownloadLockedRecoveryCopy: (source: string, filenamePrefix: string) => Promise<void>;
  onNotify: () => void; onTransfer: () => void; onImportFile: (file: File) => void;
  onEnableBackground: () => void; onDisableBackground: () => void;
  onBackgroundContent: (contentMode: WorkspaceDocument['pushPreferences']['contentMode']) => void;
  onRestoredSnapshot: (session: UnlockedWorkspace) => void;
}) {
  const starterWorkspace = useRef(createWorkspace('New workspace defaults', new Date(0))).current;
  const starterViews = starterWorkspace.viewOrder.map((id) => starterWorkspace.views[id]).filter((view): view is SavedView => Boolean(view));
  const starterDayView = starterWorkspace.calendarPreferences.dayView!;
  const [field, setField] = useState<CustomFieldDefinition | null>(null);
  useLegacyModalDismiss(Boolean(field), () => setField(null));
  const jsonInput = useRef<HTMLInputElement>(null);
  const [snapshots, setSnapshots] = useState<LocalWorkspaceSnapshotInfo[]>([]);
  const [snapshotError, setSnapshotError] = useState('');
  const [criticalError, setCriticalError] = useState('');
  useEffect(() => { void listLocalWorkspaceSnapshots().then(setSnapshots).catch((reason) => setSnapshotError(reason instanceof Error ? reason.message : String(reason))); }, [workspace.schemaVersion]);
  const exportAll = (format: PortableFormat, metadata = false) => {
    setCriticalError('');
    void onBeforeCriticalAction()
      .then(() => onExportAll(format, metadata))
      .catch((reason) => setCriticalError(`Export stopped because the latest change could not be saved: ${reason instanceof Error ? reason.message : String(reason)}`));
  };
  const testClock = workspace.calendarPreferences.testClock ?? { enabled: false, secondsPerDay: 86_400, dayDurationValue: 24, dayDurationUnit: 'hours' as const, startedAt: new Date().toISOString(), virtualAt: new Date().toISOString() };
  const testClockInput = testClockDisplay(testClock);
  const [testClockDraft, setTestClockDraft] = useState(() => ({ enabled: testClock.enabled, value: String(testClockInput.value), unit: testClockInput.unit }));
  useEffect(() => {
    setTestClockDraft({ enabled: testClock.enabled, value: String(testClockInput.value), unit: testClockInput.unit });
  }, [testClock.enabled, testClock.secondsPerDay, testClockInput.unit, testClockInput.value]);
  const draftTestClockValue = Number(testClockDraft.value);
  const validTestClockDraft = Number.isFinite(draftTestClockValue) && draftTestClockValue > 0;
  const testClockDraftChanged = testClockDraft.enabled !== testClock.enabled || testClockDraft.unit !== testClockInput.unit || (validTestClockDraft && draftTestClockValue !== testClockInput.value);
  const applyTestClock = () => commit('Apply accelerated test clock', (draft) => {
    const realNow = new Date();
    const current = draft.calendarPreferences.testClock ?? testClock;
    const value = Math.max(0.01, draftTestClockValue);
    const unit = testClockDraft.unit;
    const enabled = testClockDraft.enabled;
    const virtualNow = current.enabled ? effectiveWorkspaceNow(draft, realNow) : realNow;
    draft.calendarPreferences.testClock = {
      ...current, enabled, secondsPerDay: testDayDurationSeconds(value, unit), dayDurationValue: value, dayDurationUnit: unit,
      startedAt: realNow.toISOString(), virtualAt: enabled && current.enabled ? virtualNow.toISOString() : realNow.toISOString(),
    };
  });
  const repairRecurrenceIssue = (issueId: string, itemId: string) => {
    const value = window.prompt('Enter recurrence start as an ISO date/time', new Date().toISOString());
    if (!value || Number.isNaN(Date.parse(value))) { setSnapshotError('Enter a valid ISO date/time.'); return; }
    commit('Repair migrated recurrence', (draft) => {
      const item = draft.items[itemId]; const issue = draft.migrationIssues.find((entry) => entry.id === issueId); if (!item || !issue) return;
      const quarantine = item.extensions?.quarantine as Record<string, unknown> | undefined;
      if (!quarantine?.recurrence || typeof quarantine.recurrence !== 'object') return;
      item.recurrence = clean(quarantine.recurrence) as NonNullable<UniversalItem['recurrence']>;
      item.role = 'series_template'; item.schedule = { ...(item.schedule ?? { timezone: item.recurrence.timezone || 'UTC' }), timezone: item.schedule?.timezone || item.recurrence.timezone || 'UTC', startAt: new Date(value).toISOString() };
      delete quarantine.recurrence; issue.status = 'resolved'; item.updatedAt = new Date().toISOString(); item.revision += 1;
    });
  };
  const discardQuarantinedRecurrence = (issueId: string, itemId: string) => commit('Remove incompatible recurrence', (draft) => { const item = draft.items[itemId]; const issue = draft.migrationIssues.find((entry) => entry.id === issueId); const quarantine = item?.extensions?.quarantine as Record<string, unknown> | undefined; if (quarantine) delete quarantine.recurrence; if (issue) issue.status = 'resolved'; });
  return <div className="settings-page"><div className="page-title"><div><h1>Settings</h1></div></div>{criticalError && <p className="error" role="alert">{criticalError}</p>}
<PasswordProtectionSettings status={passwordProtection} onStatusChange={onPasswordProtectionChanged} onBeforeCriticalAction={onBeforeCriticalAction} />
<details className="settings-disclosure"><summary>Guide</summary><section className="settings-card settings-guide"><p className="eyebrow">GUIDE</p><h2>How Universal starts</h2><details className="settings-guide-section" open><summary>Presets</summary><div><p>These values come from the same defaults used to create a new workspace. Existing workspaces keep their own customized values.</p><h3>Starter Home views</h3><ul>{starterViews.map((view) => <li key={view.id}><strong>{view.name}</strong><small>{view.query.source} · {view.renderer} · {view.fields.length} fields</small></li>)}</ul><h3>Available View templates</h3><ul>{BUILT_IN_VIEW_TEMPLATES.map((view) => <li key={view.id}><strong>{view.name}</strong><small>{view.query.source} · {view.renderer}</small></li>)}</ul><h3>Calendar day view</h3><dl><div><dt>Filter</dt><dd>{starterDayView.filter.source}</dd></div><div><dt>Schedule sources</dt><dd>{starterDayView.scheduleSources.join(', ')}</dd></div><div><dt>Displayed fields</dt><dd>{starterDayView.fields.join(', ')}</dd></div><div><dt>Sorting</dt><dd>{starterDayView.sortSource}</dd></div></dl><h3>Workspace settings</h3><dl><div><dt>Week starts</dt><dd>{starterWorkspace.calendarPreferences.weekStartsOn === 1 ? 'Monday' : 'Sunday'}</dd></div><div><dt>Calendar</dt><dd>{starterWorkspace.calendarPreferences.lastMode} · weekends {starterWorkspace.calendarPreferences.weekends ? 'shown' : 'hidden'} · {starterWorkspace.calendarPreferences.timeFormat}</dd></div><div><dt>Working hours</dt><dd>{starterWorkspace.calendarPreferences.workingHours.start}–{starterWorkspace.calendarPreferences.workingHours.end}</dd></div><div><dt>Default Duration</dt><dd>{starterWorkspace.calendarPreferences.defaultDurationMinutes} min</dd></div><div><dt>Appearance</dt><dd>{starterWorkspace.calendarPreferences.appearance.mode} · interface sound on · completion sound on</dd></div><div><dt>Detailed explanations</dt><dd>Off</dd></div><div><dt>Backup reminder</dt><dd>Every {starterWorkspace.calendarPreferences.backupPreferences?.reminderDays ?? 7} days</dd></div><div><dt>Diagnostics</dt><dd>On</dd></div><div><dt>Background push</dt><dd>Off · generic lock-screen content</dd></div></dl></div></details></section></details>
<ProductGuide />
<details className="settings-disclosure"><summary>Calendar and Google Calendar</summary><CalendarIntegrationSettings workspace={workspace} commit={commit} /></details>
<details className="settings-disclosure"><summary>Appearance and sounds</summary>    <section className="settings-card"><p className="eyebrow">APPEARANCE</p><h2>Theme</h2><p>Choose a light, dark or system theme. Scheduled mode switches automatically using the times below.</p><label>Theme<select value={workspace.calendarPreferences.appearance.mode} onChange={(event) => commit('Change theme mode', (draft) => { draft.calendarPreferences.appearance.mode = event.target.value as WorkspaceDocument['calendarPreferences']['appearance']['mode']; })}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option><option value="scheduled">Scheduled</option></select></label>{workspace.calendarPreferences.appearance.mode === 'scheduled' && <div className="form-grid two"><label>Light theme starts<input type="time" value={workspace.calendarPreferences.appearance.lightAt} onChange={(event) => commit('Change light theme schedule', (draft) => { draft.calendarPreferences.appearance.lightAt = event.target.value; })} /></label><label>Dark theme starts<input type="time" value={workspace.calendarPreferences.appearance.darkAt} onChange={(event) => commit('Change dark theme schedule', (draft) => { draft.calendarPreferences.appearance.darkAt = event.target.value; })} /></label></div>}<hr/><p className="eyebrow">GUIDANCE</p><h2>Detailed explanations</h2><label className="check explanations-setting"><input type="checkbox" checked={workspace.calendarPreferences.showExplanations} onChange={(event) => commit('Toggle detailed explanations', (draft) => { draft.calendarPreferences.showExplanations = event.target.checked; })} />Show explanatory text and guides throughout the interface</label><hr/><p className="eyebrow">SOUND</p><h2>Interface sounds</h2><label className="check"><input type="checkbox" checked={workspace.calendarPreferences.appearance.uiSound} onChange={(event) => commit('Toggle interface sounds', (draft) => { draft.calendarPreferences.appearance.uiSound = event.target.checked; })} />Play calm sounds for buttons and controls</label><h2>Completion sound</h2><label className="check"><input type="checkbox" checked={workspace.calendarPreferences.appearance.tickSound} onChange={(event) => commit('Toggle completion sound', (draft) => { draft.calendarPreferences.appearance.tickSound = event.target.checked; })} />Play a short sound when an item is completed</label></section></details>
<div className="settings-columns"><details className="settings-disclosure"><summary>Custom fields and testing</summary><section className="settings-card"><header><div><p className="eyebrow">DATA MODEL</p><h2>Custom fields</h2></div><button className="secondary" onClick={() => setField({ id: createId(), key: '', label: '', kind: 'text', required: false })}>+ Add</button></header>{Object.values(workspace.customFields).map((entry) => <button className="setting-row" key={entry.id} onClick={() => setField(clean(entry))}><span><strong>{entry.label}</strong><small>custom.{entry.key}</small></span><span>{entry.kind}</span></button>)}{!Object.keys(workspace.customFields).length && <p className="empty">No custom fields yet.</p>}<hr/><p className="eyebrow">TESTING</p><h2>Accelerated day</h2><p>Choose how much real time equals one simulated day. The visible clock, Views, scripts, active ranges, recurrence, Calendar and local reminders follow it.</p><label className="check"><input type="checkbox" checked={testClockDraft.enabled} onChange={(event) => setTestClockDraft((current) => ({ ...current, enabled: event.target.checked }))} /> Enable accelerated test clock</label><div className="form-grid two"><label>One simulated day<input type="number" min="0.01" step="any" inputMode="decimal" value={testClockDraft.value} onChange={(event) => setTestClockDraft((current) => ({ ...current, value: event.target.value }))} /></label><label>Unit<select value={testClockDraft.unit} onChange={(event) => setTestClockDraft((current) => ({ ...current, unit: event.target.value as TestClockUnit }))}><option value="seconds">Seconds</option><option value="minutes">Minutes</option><option value="hours">Hours</option></select></label></div><button className="secondary" disabled={!validTestClockDraft || !testClockDraftChanged} onClick={applyTestClock}>Apply</button><p className="hint">Changes start only after Apply. Example: 30 seconds = one simulated day. Backup schedules, diagnostics and background push remain on real time to avoid false alerts or external deliveries during a test.</p></section></details>
<details className="settings-disclosure"><summary>Data, notifications and application</summary>    <section className="settings-card"><p className="eyebrow">INTERFACE</p><h2>Interface language</h2><p>Choose the language used by the app on this device. Item titles and your data are never translated.</p><label>Language<select value={workspace.calendarPreferences.language} onChange={(event) => commit('Change interface language', (draft) => { draft.calendarPreferences.language = event.target.value as WorkspaceDocument['calendarPreferences']['language']; })}>{interfaceLanguages.map((language) => <option value={language.value} key={language.value}>{language.label}</option>)}</select></label><hr/><p className="eyebrow">PORTABILITY</p><h2>Move your data</h2><p>Encrypted Transfer is safe for complete workspace merge. Readable exports use the same preview, add and copy rules on import.</p><div className="settings-actions"><button className="secondary" onClick={onTransfer}><LineIcon name="transfer"/> Encrypted Transfer</button><details className="inline-menu"><summary>Export all…</summary><div><button onClick={() => void exportAll('json')}>JSON</button><button onClick={() => void exportAll('csv')}>CSV</button><button onClick={() => void exportAll('xlsx')}>Excel</button><button onClick={() => void exportAll('ics')}>iCalendar</button><button onClick={() => void exportAll('ics', true)}>iCalendar + UTM metadata</button></div></details><button className="secondary" onClick={() => jsonInput.current?.click()}>Import data…</button><input ref={jsonInput} hidden type="file" accept=".json,.csv,.xlsx,.ics,application/json,text/csv,text/calendar,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImportFile(file); event.currentTarget.value = ''; }} /></div><hr/><p className="eyebrow">DEVICE</p><h2>Notifications</h2><p>Local reminders appear while the app is open. Background delivery uses optional Web Push and the free Cloudflare plan checks due jobs every 15 minutes.</p><button className="secondary" onClick={onNotify}>Allow local notifications</button><div className="background-push"><div><strong>Background notifications</strong><small>{workspace.pushPreferences.enabled ? 'Enabled for this encrypted workspace copy.' : 'Off — reminders stay only on this device while the app is open.'}</small></div>{workspace.pushPreferences.enabled ? <button className="secondary" onClick={onDisableBackground}>Disable</button> : <button className="secondary" onClick={onEnableBackground}>Enable background delivery</button>}</div>{workspace.pushPreferences.enabled && <label className="push-privacy">Lock-screen content<select value={workspace.pushPreferences.contentMode} onChange={(event) => onBackgroundContent(event.target.value as WorkspaceDocument['pushPreferences']['contentMode'])}><option value="generic">Generic — no task title leaves this device</option><option value="detailed">Show task title and urgency</option></select></label>}<p className="hint">For iPhone, install Universal to the Home Screen, then enable this from the installed app. The Worker never receives your password or encrypted database.</p><details className="notification-help"><summary>iPhone background notification instructions</summary><div><p>First add Universal to the Home Screen and open it from there. Tap <em>Allow local notifications</em> if iOS has not granted permission yet. Then tap <em>Enable background delivery</em> and enter the notification access code supplied by the workspace owner. This is optional; without it, reminders remain local to the device.</p><p>Background delivery is checked about every 15 minutes on the free service, so it is not an exact alarm. GitHub only hosts the app files; it does not receive your workspace or notification list. When detailed lock-screen content is selected, the push service temporarily receives the task title, Start, Deadline and reminder urgency needed to send the notification.</p></div></details><hr/><p className="eyebrow">LOCAL WORKSPACE</p><h2>Workspace storage</h2><p>Your workspace is encrypted and stored in this browser's private app storage (IndexedDB). iPhone does not expose a normal folder path for site data.</p><dl><div><dt>Storage</dt><dd>Encrypted local browser storage</dd></div><div><dt>Workspace ID</dt><dd className="mono">{workspace.workspaceId}</dd></div><div><dt>Portable backup</dt><dd>Encrypted <code>.utmb</code> file</dd></div></dl><p className="hint">Use Encrypted Transfer above to save a <code>.utmb</code> backup in Files, iCloud Drive or another cloud. The app validates the encrypted contents instead of trusting the filename.</p><div className="backup-notice"><strong>Backups are manual in this web app</strong><span>Browsers and iOS do not allow a PWA to silently write encrypted backups into a user-selected folder. Choose a folder in Files when exporting, then replace the previous backup there.</span></div><p className="hint">This release supports one local workspace owner. Separate user accounts and permissions are not enabled yet; adding names here would not create real security boundaries.</p><hr/><p className="eyebrow">WORKSPACE</p><h2>{workspace.name}</h2><dl><div><dt>Schema</dt><dd>{workspace.schemaVersion}</dd></div><div><dt>Items</dt><dd>{Object.keys(workspace.items).length}</dd></div><div><dt>Workspace ID</dt><dd className="mono">{workspace.workspaceId}</dd></div></dl></section></details></div>
<details className="settings-disclosure"><summary>Workspace versions</summary>    <section className="settings-card"><p className="eyebrow">RECOVERY</p><h2>Workspace versions</h2><p>Universal keeps the two encrypted versions from before schema updates.</p>{snapshotError && <p className="error">{snapshotError}</p>}{snapshots.map((snapshot) => <div className="setting-row" key={snapshot.id}><span><strong>Schema {snapshot.schemaVersion}</strong><small>{formatRussianDateTime(snapshot.createdAt)} · {snapshot.reason}</small></span><span className="settings-actions"><button className="secondary" onClick={() => { const password = window.prompt('Enter the password for this workspace version'); if (!password) return; void onBeforeCriticalAction().then(() => exportLocalWorkspaceSnapshot(snapshot.id, password)).then((source) => onDownloadLockedRecoveryCopy(source, `universal-schema-${snapshot.schemaVersion}`)).catch((reason) => setSnapshotError(reason instanceof Error ? reason.message : String(reason))); }}>Download</button><button className="secondary" onClick={() => { const password = window.prompt('Enter the password for this workspace version'); if (!password) return; void onBeforeCriticalAction().then(() => restoreLocalWorkspaceSnapshot(snapshot.id, password)).then(onRestoredSnapshot).catch((reason) => setSnapshotError(reason instanceof Error ? reason.message : String(reason))); }}>Restore</button></span></div>)}{!snapshots.length && <p className="empty">No previous workspace versions yet.</p>}</section></details>
{workspace.migrationIssues.length > 0 && <details className="settings-disclosure"><summary>Compatibility repairs</summary><section className="settings-card"><p className="eyebrow">COMPATIBILITY</p><h2>Items needing repair</h2>{workspace.migrationIssues.map((issue) => <div className="setting-row" key={issue.id}><span><strong>{issue.code}</strong><small>{issue.entityType} · {issue.entityId} · disabled {issue.disabledCapability}</small></span>{issue.status === 'needs_repair' && issue.code === 'recurrence_missing_anchor' ? <span className="settings-actions"><button className="secondary" onClick={() => repairRecurrenceIssue(issue.id, issue.entityId)}>Choose start</button><button className="secondary" onClick={() => discardQuarantinedRecurrence(issue.id, issue.entityId)}>Remove recurrence</button></span> : <span>{issue.status}</span>}</div>)}</section></details>}
    {field && <div className="modal-backdrop"><section className="dialog"><header><h2>Custom field</h2><button className="icon-button" onClick={() => setField(null)}>×</button></header><label>Label<input value={field.label} onChange={(event) => setField({ ...field, label: event.target.value, key: field.key || event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_') })} /></label><label>Key<input value={field.key} pattern="[a-z][a-z0-9_]*" onChange={(event) => setField({ ...field, key: event.target.value })} /></label><label>Type<select value={field.kind} onChange={(event) => setField({ ...field, kind: event.target.value as CustomFieldDefinition['kind'] })}>{['text', 'number', 'boolean', 'date', 'datetime', 'duration', 'enum', 'multi_enum', 'url', 'item_ref', 'formula'].map((kind) => <option key={kind}>{kind}</option>)}</select></label>{field.kind === 'formula' && <label>Formula DSL<input value={field.formula ?? ''} onChange={(event) => setField({ ...field, formula: event.target.value })} placeholder="custom.rate * custom.hours" /></label>}<footer><button className="danger" onClick={() => { commit('Delete custom field', (draft) => { delete draft.customFields[field.id]; }); setField(null); }}>Delete</button><span/><button className="primary" disabled={!field.label || !/^[a-z][a-z0-9_]*$/.test(field.key)} onClick={() => { if (field.formula) parseExpression(field.formula); commit('Save custom field', (draft) => { draft.customFields[field.id] = clean(field); }); setField(null); }}>Save field</button></footer></section></div>}
  </div>;
}
