import { Component, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import * as XLSX from 'xlsx';
import { installDomLocalization, interfaceLanguages } from './i18n';
import { createPushPreferences, subscribeBackgroundPush, syncBackgroundPush, unsubscribeBackgroundPush } from './push';
import { CodeEditor } from './components/ui/CodeEditor';
import { CloseIcon, LineIcon } from './components/ui/icons';
import { Button } from './components/ui/primitives';
import { SectionGuide } from './components/ui/SectionGuide';
import {
  AllItemsPage,
  ALL_ITEMS_VIEW_ID,
  allItemsViewFor,
  isItemTemplate,
} from './features/items';
import { ItemEditor } from './features/items/editor/ItemEditor';
import { OrganizationManager, createParaStructurePackage } from './features/settings/OrganizationManager';
import { CalendarPage } from './features/calendar/CalendarPage';
import { AppShell, type AppNotice as Notice, type AppPage as Page } from './components/layout/AppShell';
import { ShellNotices } from './components/layout/ShellNotices';
import { useAppearance } from './hooks/useAppearance';
import { useToast } from './hooks/useToast';
import { playCompletionSoundUnlessPreviewed, useUiSounds } from './hooks/useUiSounds';
import { useViewport } from './hooks/useViewport';
import { useWorkspaceController } from './hooks/useWorkspaceController';
import { clearDiagnostics, diagnosticFailureCode, DIAGNOSTICS_CHANGED_EVENT, readDiagnostics, recordDiagnostic, setDiagnosticsEnabled, type DiagnosticEntry } from './services/diagnostics';
import {
  ViewsPage,
  COMPLETION_EXIT_MS,
  applyViewCreationDefaults,
  selectViewItems,
  setCompletionHold,
} from './features/views';
import { formatHeaderDate, formatRussianDateTime, formatSystemDateTime } from './utils/dates';
import {
  APP_NAME, APP_RELEASED_AT, APP_VERSION, SCHEMA_VERSION, applyPortableImport, buildPortableImportPreview,
  collectItemDependencies, createId, createItem, createPortablePackage,
  advanceCompletionAnchoredSeries, parseExpression, reconcileRecurrences,
  runAutomationEvents, serializePortablePackage,
  createWorkspace, effectiveWorkspaceNow, ensureAreaDefinition, ensureListDefinition, ensureProjectDefinition, ensureTagDefinition, fromICS, migrateWorkspace, packageToTabular, parseCsv, tabularToPackage, testClockDisplay, testDayDurationSeconds, toCsv, toICS,
  type AutomationAction, type AutomationRule, type CustomFieldDefinition,
  type ItemPreset, type PortableImportPreview, type PortableSelection, type SavedView, type TestClockUnit, type UniversalItem, type WorkspaceDocument, type WorkspaceLanguage,
} from '@utm/core';
import {
  createLocalWorkspace, createUnencryptedLocalWorkspace, decryptWorkspaceFile, disableFaceIdUnlock, enableFaceIdUnlock, exportContainer, exportEncryptedLocalBackup, exportLocalWorkspaceSnapshot, faceIdStatus, importAsLocalWorkspace,
  listLocalWorkspaceSnapshots, mergeIntoLocalWorkspace, restoreLocalWorkspace, restoreLocalWorkspaceSnapshot, saveLocalWorkspace, unlockLocalWorkspace, unlockLocalWorkspaceWithFaceId, validateContainer,
  type LocalWorkspaceSnapshotInfo, type UnlockedWorkspace,
} from '@utm/sdk';

const BUILD_COMMIT = (import.meta.env.VITE_COMMIT_SHA || 'local').slice(0, 7);

function useDisplayedBuild(): { commit: string; dirty: boolean } {
  const [build, setBuild] = useState({ commit: BUILD_COMMIT, dirty: false });
  useEffect(() => {
    // A previously installed PWA shell can be served by the service worker even
    // while its URL points at Vite dev. The live endpoint remains authoritative.
    const refresh = () => void fetch('/__utm-build-info', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() as Promise<{ commit?: string; dirty?: boolean }> : undefined)
      .then((result) => { if (result?.commit) setBuild({ commit: result.commit.slice(0, 7), dirty: Boolean(result.dirty) }); })
      .catch(() => undefined);
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => window.clearInterval(timer);
  }, []);
  return build;
}

const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
type PendingUndoAction = { id: string; label: string; expiresAt: number; undo: () => void; itemId?: string };
const UNDO_WINDOW_MS = 4_000;

/**
 * A visible recurring cycle is an occurrence, while recurrence settings belong
 * to its series template.  Opening the occurrence used to make the editor look
 * as though recurrence had not been saved.  Always resolve an occurrence back
 * to its source series for editing settings; completion still acts on the
 * occurrence itself through the separate state action.
 */
export const itemEditorSource = (workspace: WorkspaceDocument | undefined, item: UniversalItem): UniversalItem => {
  const seriesId = item.role === 'occurrence' ? item.occurrence?.seriesId : undefined;
  return seriesId && workspace?.items[seriesId] ? workspace.items[seriesId]! : item;
};
// Some iOS Files providers do not implement File.text() reliably for custom
// extensions. Reading bytes ourselves keeps .utmb recovery working reliably.
const readEncryptedBackup = async (file: File): Promise<string> => new TextDecoder().decode(await file.arrayBuffer());
const createUiItem = (title = '', preset: ItemPreset = 'task', now = new Date()) => {
  const item = createItem(title, preset, now);
  const startAt = now.toISOString();
  item.schedule = { ...item.schedule, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, startAt, endAt: new Date(now.getTime() + 10 * 60_000).toISOString() };
  return item;
};
const safeFilename = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'universal';
const downloadText = (content: string, filename: string, type = 'application/json') => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
};
const downloadDiagnosticsFile = () => downloadText(JSON.stringify(readDiagnostics(), null, 2), 'utm-diagnostics.json');
const downloadOfflineRecoveryKit = async () => {
  const module = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
  if (!module?.src || module.src.includes('/src/')) throw new Error('Build the production app before downloading the offline recovery kit');
  const styles = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]')];
  const [javascript, ...css] = await Promise.all([
    fetch(module.src, { cache: 'no-store' }).then((response) => { if (!response.ok) throw new Error('Cannot download recovery JavaScript'); return response.text(); }),
    ...styles.map((link) => fetch(link.href, { cache: 'no-store' }).then((response) => { if (!response.ok) throw new Error('Cannot download recovery styles'); return response.text(); })),
  ]);
  const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Universal offline recovery kit v${APP_VERSION}</title><style>${css.join('\n')}</style></head><body><div id="root"></div><script>window.__UTM_OFFLINE_RECOVERY_KIT__=true;</script><script type="module">${javascript.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
  downloadText(html, `universal-offline-recovery-kit-v${APP_VERSION}.html`, 'text/html;charset=utf-8');
};
const downloadLockedRecoveryCopy = async (source?: string, filenamePrefix = 'universal-locked-recovery') => {
  const recovery = JSON.parse(source ?? await exportEncryptedLocalBackup()) as Record<string, unknown>;
  if (recovery.magic !== 'UTM-LOCAL-ENCRYPTED' || recovery.version !== 1 || !recovery.metadata || !recovery.workspace) {
    throw new Error('Recovery copy failed structural validation and was not downloaded');
  }
  recovery.diagnostics = readDiagnostics();
  // Keep the release and schema visible in Files so several recovery copies
  // cannot be confused during an incident.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', 'Z');
  downloadText(JSON.stringify(recovery), `${filenamePrefix}-utm-v${APP_VERSION}-schema-${SCHEMA_VERSION}-${stamp}.utmb`, 'application/octet-stream');
};
const downloadBlob = (content: BlobPart, filename: string, type: string) => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
};
const confirmPlaintextDownload = (message = 'This JSON export is plaintext and may contain private item data. Download it now?') => window.confirm(message);

type PortableFormat = 'json' | 'csv' | 'xlsx' | 'ics';
const packageForItems = (workspace: WorkspaceDocument, items: UniversalItem[], selection: PortableSelection) => createPortablePackage(workspace, { kind: 'items', items: collectItemDependencies(workspace, items), selection });
const exportPortable = (workspace: WorkspaceDocument, portable: ReturnType<typeof createPortablePackage>, filename: string, format: PortableFormat, metadata = false) => {
  if (!confirmPlaintextDownload(`This ${format.toUpperCase()} export is readable plaintext and may contain private item data. Download it now?`)) return;
  if (format === 'json') { downloadText(serializePortablePackage(portable), `${filename}.json`); return; }
  // Keep the canonical item column in readable tabular exports. The friendly
  // columns remain first for people; this final metadata column makes CSV and
  // Excel round-trips lossless for scripts, recurrence, reminders and future
  // universal fields that a flat table cannot otherwise represent.
  if (format === 'csv') { const data = packageToTabular(portable); const columns = [...new Set(data.items.flatMap((row) => Object.keys(row)))]; downloadText(toCsv(data.items, columns), `${filename}.csv`, 'text/csv;charset=utf-8'); return; }
  if (format === 'xlsx') {
    const data = packageToTabular(portable); const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(data.items), 'Items');
    if (data.customFields.length) XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(data.customFields), 'Custom fields');
    if (data.views.length) XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(data.views), 'Views');
    if (data.customValues.length) XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(data.customValues), 'Custom values');
    if (data.reminders.length) XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(data.reminders), 'Reminders');
    if (data.relations.length) XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(data.relations), 'Relations');
    if (data.attachments.length) XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(data.attachments), 'Attachments');
    if (data.habitDates.length) XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(data.habitDates), 'Habit dates');
    downloadBlob(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), `${filename}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); return;
  }
  const clone = clean(workspace); clone.items = Object.fromEntries(portable.items.map((item) => [item.id, item]));
  const exported = toICS(clone, { includeUtmMetadata: metadata });
  downloadText(exported.ics, `${filename}${metadata ? '-utm' : ''}.ics`, 'text/calendar;charset=utf-8');
};

const exportSavedView = (workspace: WorkspaceDocument, view: SavedView, mode: 'definition' | 'results' | 'bundle', format: PortableFormat = 'json', metadata = false) => {
  const results = selectViewItems(workspace, view); const dependencies = collectItemDependencies(workspace, results);
  const portable = createPortablePackage(workspace, {
    kind: mode === 'definition' ? 'views' : mode === 'results' ? 'items' : 'view_bundle',
    views: mode === 'results' ? [] : [view], items: mode === 'definition' ? [] : dependencies,
    selection: mode === 'definition' ? { type: 'view_definition', viewId: view.id, viewName: view.name } : { type: 'view_results', viewId: view.id, viewName: view.name },
    dependencyItemIds: dependencies.filter((item) => !results.some((result) => result.id === item.id)).map((item) => item.id),
  });
  exportPortable(workspace, portable, `${safeFilename(view.name)}-${mode}`, format, metadata);
};
const exportParaStructure = (workspace: WorkspaceDocument) => {
  exportPortable(workspace, createParaStructurePackage(workspace), `${safeFilename(workspace.name)}-para`, 'json');
};

async function portableFromFile(file: File, workspace: WorkspaceDocument): Promise<{ source: string; warnings: string[] }> {
  const extension = file.name.toLowerCase().split('.').pop();
  if (extension === 'json') return { source: await file.text(), warnings: [] };
  if (extension === 'ics') {
    const result = fromICS(await file.text(), createWorkspace('Imported calendar'));
    const portable = createPortablePackage(result.workspace, { kind: 'items', items: Object.values(result.workspace.items), selection: { type: 'all_items' } });
    return { source: serializePortablePackage(portable), warnings: result.warnings.map((warning) => warning.message) };
  }
  let tables: { items: Record<string, string | number | boolean | null | undefined>[]; customFields?: Record<string, string | number | boolean | null | undefined>[]; views?: Record<string, string | number | boolean | null | undefined>[]; customValues?: Record<string, string | number | boolean | null | undefined>[]; reminders?: Record<string, string | number | boolean | null | undefined>[]; relations?: Record<string, string | number | boolean | null | undefined>[]; attachments?: Record<string, string | number | boolean | null | undefined>[]; habitDates?: Record<string, string | number | boolean | null | undefined>[] };
  if (extension === 'csv') tables = { items: parseCsv(await file.text()) };
  else if (extension === 'xlsx') {
    const book = XLSX.read(await file.arrayBuffer(), { type: 'array' }); const table = (name: string) => book.SheetNames.includes(name) ? XLSX.utils.sheet_to_json<Record<string, string | number | boolean | null | undefined>>(book.Sheets[name]!, { defval: '' }) : [];
    tables = { items: table('Items'), customFields: table('Custom fields'), views: table('Views'), customValues: table('Custom values'), reminders: table('Reminders'), relations: table('Relations'), attachments: table('Attachments'), habitDates: table('Habit dates') };
    if (!tables.items.length) throw new Error('Excel file needs an Items sheet with a header row.');
  } else throw new Error('Choose a JSON, CSV, Excel (.xlsx), or iCalendar (.ics) file.');
  const result = tabularToPackage(tables, workspace);
  return { source: serializePortablePackage(result.package), warnings: result.warnings };
}

function LockScreen({ exists, onReady }: { exists: boolean; onReady: (session: UnlockedWorkspace, language: WorkspaceLanguage) => Promise<void> }) {
  const displayedBuild = useDisplayedBuild();
  const [name, setName] = useState('My workspace');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<File | null>(null);
  const [unencryptedTestWorkspace, setUnencryptedTestWorkspace] = useState(false);
  const [diagnosticCount, setDiagnosticCount] = useState(() => readDiagnostics().length);
  const [decryptFile, setDecryptFile] = useState<File | null>(null);
  const [decryptPassword, setDecryptPassword] = useState('');
  const [decryptError, setDecryptError] = useState('');
  const [decryptBusy, setDecryptBusy] = useState(false);
  const [faceId, setFaceId] = useState<'available' | 'unsupported' | 'configured'>('unsupported');
  const [online, setOnline] = useState(() => navigator.onLine);
  const [language, setLanguage] = useState<WorkspaceLanguage>(() => {
    const saved = window.localStorage.getItem('utm-interface-language') as WorkspaceLanguage | null;
    if (saved && interfaceLanguages.some((option) => option.value === saved)) return saved;
    const browserLanguage = navigator.language.slice(0, 2) as WorkspaceLanguage;
    return interfaceLanguages.some((option) => option.value === browserLanguage) ? browserLanguage : 'en';
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const decryptFileRef = useRef<HTMLInputElement>(null);
  const faceIdAttempted = useRef(false);

  useEffect(() => {
    window.localStorage.setItem('utm-interface-language', language);
    return installDomLocalization(language);
  }, [language]);
  useEffect(() => {
    const refresh = () => setDiagnosticCount(readDiagnostics().length);
    window.addEventListener(DIAGNOSTICS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(DIAGNOSTICS_CHANGED_EVENT, refresh);
  }, []);
  useEffect(() => {
    if (!exists) return;
    void faceIdStatus().then(setFaceId).catch(() => setFaceId('unsupported'));
  }, [exists]);
  useEffect(() => {
    const onOnline = () => setOnline(true); const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline);
    // Safari can keep navigator.onLine=true after a PWA has been fully closed.
    // This request is deliberately not precached; any HTTP response proves the
    // host is reachable, while a network failure exposes offline recovery mode.
    const probe = () => void fetch('/__utm-build-info', { cache: 'no-store' }).then(() => setOnline(true)).catch(() => setOnline(false));
    probe();
    const timer = window.setInterval(probe, 15_000);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); window.clearInterval(timer); };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (selectedBackup) { await importWorkspace(selectedBackup); return; }
    const startedAt = performance.now();
    const operation = exists ? 'Unlock local workspace' : unencryptedTestWorkspace ? 'Create unencrypted test workspace' : 'Create encrypted workspace';
    setError(''); setBusy(true);
    try {
      if (!exists && !unencryptedTestWorkspace && password !== confirm) throw new Error('Passwords do not match');
      const unlocked = exists
        ? await unlockLocalWorkspace(password)
        : unencryptedTestWorkspace
          ? await createUnencryptedLocalWorkspace(name, language)
          : await createLocalWorkspace(password, name, language);
      await onReady(unlocked, language);
      const durationMs = Math.round(performance.now() - startedAt);
      if (durationMs >= 1_500) recordDiagnostic({ kind: 'result', message: 'Workspace entry was slow', operation, outcome: 'succeeded', durationMs });
    } catch (reason) {
      recordDiagnostic({ kind: 'error', message: 'Workspace entry failed', operation, outcome: 'failed', durationMs: Math.round(performance.now() - startedAt), details: diagnosticFailureCode(reason) });
      setError(reason instanceof Error ? reason.message : String(reason));
    }
    finally { setBusy(false); }
  };

  const importWorkspace = async (file: File) => {
    if (password.length < 10) {
      setError('Enter the complete backup password, then tap Import selected backup.');
      return;
    }
    const startedAt = performance.now();
    const operation = 'Import encrypted workspace at setup';
    setBusy(true); setError('');
    try {
      const backup = await readEncryptedBackup(file);
      const unlocked = await importAsLocalWorkspace(backup, password);
      await onReady(unlocked, language);
      const durationMs = Math.round(performance.now() - startedAt);
      if (durationMs >= 1_500) recordDiagnostic({ kind: 'result', message: 'Workspace backup import was slow', operation, outcome: 'succeeded', durationMs });
    }
    catch (reason) {
      recordDiagnostic({ kind: 'error', message: 'Workspace entry failed', operation, outcome: 'failed', durationMs: Math.round(performance.now() - startedAt), details: diagnosticFailureCode(reason) });
      setError(reason instanceof Error ? reason.message : String(reason));
    }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const unlockWithFaceId = async () => {
    const startedAt = performance.now();
    setBusy(true); setError('');
    try {
      await onReady(await unlockLocalWorkspaceWithFaceId(), language);
      recordDiagnostic({ kind: 'result', message: 'Face ID workspace entry succeeded', operation: 'Unlock local workspace with Face ID', outcome: 'succeeded', durationMs: Math.round(performance.now() - startedAt) });
    } catch (reason) {
      recordDiagnostic({ kind: 'error', message: 'Face ID workspace entry failed', operation: 'Unlock local workspace with Face ID', outcome: 'failed', durationMs: Math.round(performance.now() - startedAt), details: diagnosticFailureCode(reason) });
      setError('Face ID was unavailable, cancelled, or could not unlock this workspace. Enter your password below instead.');
    } finally { setBusy(false); }
  };

  useEffect(() => {
    if (!exists || faceId !== 'configured' || faceIdAttempted.current || selectedBackup || decryptFile) return;
    faceIdAttempted.current = true;
    void unlockWithFaceId();
  }, [decryptFile, exists, faceId, selectedBackup]);

  const downloadLockedBackup = async () => {
    setError('');
    try {
      await downloadLockedRecoveryCopy();
      recordDiagnostic({ kind: 'result', message: 'Encrypted recovery copy downloaded before unlock', operation: 'Export locked recovery copy', outcome: 'succeeded' });
    } catch (reason) {
      recordDiagnostic({ kind: 'error', message: 'Encrypted recovery copy export failed', operation: 'Export locked recovery copy', outcome: 'failed', details: diagnosticFailureCode(reason) });
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const decryptSelectedFile = async () => {
    if (!decryptFile) return;
    setDecryptBusy(true); setDecryptError('');
    try {
      const readable = await decryptWorkspaceFile(await readEncryptedBackup(decryptFile), decryptPassword);
      downloadText(JSON.stringify(readable, null, 2), `${safeFilename(decryptFile.name.replace(/\.[^.]+$/, ''))}-readable.json`, 'application/json;charset=utf-8');
      recordDiagnostic({ kind: 'result', message: 'External encrypted workspace decrypted to readable JSON', operation: 'Decrypt workspace file', outcome: 'succeeded' });
    } catch (reason) {
      recordDiagnostic({ kind: 'error', message: 'External workspace decryption failed', operation: 'Decrypt workspace file', outcome: 'failed', details: diagnosticFailureCode(reason) });
      setDecryptError(reason instanceof Error ? reason.message : String(reason));
    } finally { setDecryptBusy(false); }
  };

  return <main className="lock-shell">
    <section className="lock-card">
      <div className="brand-mark">U</div>
      <p className="eyebrow">UNIVERSAL TASK MANAGER</p>
      <span className="auth-beta" aria-label="Beta version">BETA</span>
      <h1>{exists ? 'Unlock your workspace' : 'Build your own system'}</h1>
      {!online && <p className="offline-notice" role="status"><strong>No internet connection.</strong> Offline mode is active. You can still download the encrypted local database and troubleshooting log below; online hosting features are unavailable.</p>}
      <p className="muted">Your data stays on this device, encrypted. There is no account and no password recovery. Please remember your password.</p>
      <label className="language-picker">Language<select value={language} onChange={(event) => setLanguage(event.target.value as WorkspaceLanguage)}>{interfaceLanguages.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <form onSubmit={submit}>
        {!exists && <label>{selectedBackup ? 'Backup file' : 'Workspace name'}<input value={selectedBackup ? selectedBackup.name : name} readOnly={Boolean(selectedBackup)} onChange={(event) => setName(event.target.value)} required /></label>}
        {!(!exists && unencryptedTestWorkspace) && <label>{selectedBackup ? 'Backup password' : 'Password'}<input type="password" minLength={10} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={exists || selectedBackup ? 'current-password' : 'new-password'} required /></label>}
        {!exists && !selectedBackup && !unencryptedTestWorkspace && <label>Confirm password<input type="password" minLength={10} value={confirm} onChange={(event) => setConfirm(event.target.value)} required /></label>}
        {!exists && !selectedBackup && <label className="check"><input type="checkbox" checked={unencryptedTestWorkspace} onChange={(event) => { setUnencryptedTestWorkspace(event.target.checked); setError(''); }} />Create a local test workspace without password or encryption</label>}
        {!exists && unencryptedTestWorkspace && <p className="error" role="alert">Test mode: anyone with access to this browser profile can read these items. Do not use it for personal data, and do not rely on it as a backup.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {!selectedBackup && <button className="primary wide" disabled={busy}>{busy ? 'Working…' : exists ? 'Unlock' : unencryptedTestWorkspace ? 'Create unencrypted test workspace' : 'Create encrypted workspace'}</button>}
        {selectedBackup && <button className="primary wide" type="button" disabled={busy || password.length < 10} onClick={() => void importWorkspace(selectedBackup)}>{busy ? 'Importing…' : 'Import selected backup'}</button>}
      </form>
      {exists && faceId === 'configured' && <button className="secondary wide" type="button" disabled={busy} onClick={() => void unlockWithFaceId()}>Unlock with Face ID</button>}
      {exists && <p className="hint">Password unlock is always available, including if Face ID is unavailable, cancelled, or changes on this device.</p>}
      {!exists && <div className="import-lock">
        <span>Already have an encrypted workspace?</span>
        <button className="text-button" type="button" disabled={busy} onClick={() => fileRef.current?.click()}>Choose backup file</button>
        <input ref={fileRef} hidden type="file" accept=".utmb,application/octet-stream" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; setSelectedBackup(file); setUnencryptedTestWorkspace(false); setName(file.name); setConfirm(''); setError(''); }} />
        <small>Choose the file first, enter its password, then tap Import selected backup.</small>
      </div>}
      <details className="install-guide" open={!online}>
        <summary>Help</summary>
        <div>
          <h3>Install on your phone</h3>
          <p><strong>iPhone or iPad:</strong> open this page in Safari, tap Share, then choose <em>Add to Home Screen</em>.</p>
          <p><strong>Android:</strong> open it in Chrome, tap the menu, then choose <em>Install app</em> or <em>Add to Home screen</em>.</p>
          <p>Each device has its own encrypted workspace. Use an encrypted <code>.utmb</code> backup file to move or merge your data between devices.</p><p><strong>Important:</strong> if you remove Universal from the Home Screen, clear website data, or delete the browser profile, the local workspace may be lost. Export an encrypted <code>.utmb</code> backup regularly and keep it in Files, iCloud Drive, or another trusted cloud.</p>
          <button className="secondary" type="button" onClick={() => void downloadOfflineRecoveryKit().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))}>Download offline recovery kit</button><p><small>Save this standalone HTML beside your encrypted <code>.utmb</code>. It can decrypt the backup without Universal or GitHub.</small></p>
          <details className="notification-help"><summary>If the hosting site is unavailable</summary><div>
            <p>Your data is stored locally in the browser, not on GitHub or another host. To make a portable copy, open <em>Settings → Encrypted Transfer → Export encrypted .utmb</em>; in the Files/Save dialog choose a folder and confirm. The locked sign-in screen also has <em>Save encrypted recovery copy + log</em>, which creates a <code>.utmb</code> copy without unlocking.</p>
            <p><strong>iPhone/iPad:</strong> after export open the <em>Files</em> app and check <em>Downloads</em>, <em>On My iPhone/iPad</em> or <em>iCloud Drive</em> (the location you selected in the save dialog). Swipe down in that folder and search for <code>.utmb</code> or <code>universal-</code>. If the site is unavailable, open any working copy of Universal, tap <em>Choose backup file</em> on the sign-in screen, select the file in Files and enter the workspace password.</p>
            <p><strong>Android:</strong> exports normally appear in <em>Files → Downloads</em> (or the folder selected by the browser). Use the Files search for <code>.utmb</code> or <code>universal-</code>, then choose the file from the sign-in screen of any working Universal copy.</p>
            <p><strong>PC/Mac:</strong> check the browser’s <em>Downloads</em> folder or the folder chosen in the save dialog and search for <code>.utmb</code>. The encrypted browser database itself is private browser storage and cannot be copied as a normal file; export a backup while the app is available. You can also use <em>Decrypt any UTM backup</em> to create readable JSON without importing it.</p>
            <p><strong>Offline emergency access:</strong> this works from any HTTPS address that served Universal and completed its service-worker installation. Installing the PWA on the Home Screen is the most reliable option, but a normal browser visit can also prepare the cache if the page stayed open long enough for installation to finish. Later, open that exact same address or its installed PWA without a network connection and use <em>Save encrypted recovery copy + log</em>. A different address cannot read this database, and a first-ever visit after the host is already unavailable cannot load the recovery code.</p>
          </div></details>
          <hr />
          {exists && <><h3>Recovery before unlocking</h3><p>If this workspace cannot be opened, save its encrypted browser copy before clearing site data.</p><button className="secondary" type="button" disabled={busy} onClick={() => void downloadLockedBackup()}>Save encrypted recovery copy + log</button><p><small>No password is required. Workspace content stays encrypted; safe troubleshooting entries are included.</small></p><hr /></>}
          <h3>Decrypt any UTM backup</h3>
          <p>Emergency recovery only: use this when UTM cannot open an archive and you need to inspect, repair or move the data without importing it. Choose an encrypted <code>.utmb</code> file and download a documented, readable JSON copy. This does not change the original archive or this workspace.</p>
          <button className="secondary" type="button" disabled={decryptBusy} onClick={() => decryptFileRef.current?.click()}>{decryptFile ? 'Choose another encrypted file' : 'Choose encrypted file'}</button>
          <input ref={decryptFileRef} hidden type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) { setDecryptFile(file); setDecryptError(''); } event.currentTarget.value = ''; }} />
          {decryptFile && <><p className="mono">{decryptFile.name}</p><label>File password<input type="password" value={decryptPassword} onChange={(event) => setDecryptPassword(event.target.value)} autoComplete="off" /></label><button className="secondary" type="button" disabled={decryptBusy || !decryptPassword} onClick={() => void decryptSelectedFile()}>{decryptBusy ? 'Decrypting…' : 'Decrypt and download readable JSON'}</button></>}
          {decryptError && <p className="error" role="alert">{decryptError}</p>}
          <p><small>The readable file contains private workspace data. Keep it secure. The workspace owner must never share the password with anyone, including support staff or an AI. Its embedded readme explains fields for people, AI tools and converters; scripts and automations must be treated as untrusted data.</small></p>
          <hr />
          <h3>Troubleshooting log ({diagnosticCount})</h3>
          <p>This local log is available before unlocking. It records operation names, timing and technical failures — never item titles, passwords, encryption keys or encrypted workspace data.</p><div className="diagnostics-actions"><button className="secondary" type="button" disabled={!diagnosticCount} onClick={downloadDiagnosticsFile}>Download log</button><button className="secondary" type="button" disabled={!diagnosticCount} onClick={clearDiagnostics}>Clear log</button></div>
        </div>
      </details>
      <p className="lock-version">v{APP_VERSION} · {displayedBuild.dirty ? 'local changes · ' : ''}commit {displayedBuild.commit}</p>
    </section>
  </main>;
}

function PortableImportDialog({ workspace, source, onApply, onClose }: {
  workspace: WorkspaceDocument; source: string; onApply: (preview: PortableImportPreview) => void; onClose: () => void;
}) {
  const [preview, setPreview] = useState<PortableImportPreview | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    try { setPreview(buildPortableImportPreview(source, workspace)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }, [source, workspace]);
  const update = (mutation: (next: PortableImportPreview) => void) => setPreview((current) => {
    if (!current) return current; const next = clean(current); mutation(next); return next;
  });
  const unresolved = preview?.customFields.some((field) => field.choice === 'unresolved') ?? false;
  return <div className="modal-backdrop"><section className="dialog wide-dialog import-preview" role="dialog" aria-modal="true" aria-label="Import preview">
    <header><div><p className="dialog-kicker">NO CHANGES YET</p><h2>Import preview</h2></div><button className="icon-button" aria-label="Close import preview" onClick={onClose}><CloseIcon /></button></header>
    {error && <p className="error" role="alert">{error}</p>}
    {preview && <>
      <p>{preview.package.items.length} items · {preview.package.views.length} views · {preview.customFields.length} custom fields</p>
      {preview.resolvedWarnings.length > 0 && <details><summary>Compatibility notes ({preview.resolvedWarnings.length})</summary><ul>{preview.resolvedWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>}
      {preview.errors.length > 0 && <div className="error"><strong>Import is blocked</strong>{preview.errors.map((entry) => <p key={entry}>{entry}</p>)}</div>}
      {preview.customFields.some((field) => field.conflict) && <section><h3>Custom field conflicts</h3>{preview.customFields.filter((field) => field.conflict).map((field, index) => {
        const actual = preview.customFields.indexOf(field); return <div className="import-row" key={field.source.id}><span><strong>{field.source.label}</strong><small>custom.{field.source.key}</small></span><select value={field.choice} onChange={(event) => update((next) => { next.customFields[actual]!.choice = event.target.value as typeof field.choice; })}><option value="unresolved">Choose…</option><option value="rename">Rename imported</option><option value="use_local">Use local</option></select>{field.choice === 'rename' && <input aria-label={`New key for ${field.source.label}`} placeholder={`${field.source.key}_imported`} value={field.renamedKey ?? ''} onChange={(event) => update((next) => { next.customFields[actual]!.renamedKey = event.target.value; })} />}</div>;
      })}</section>}
      {preview.items.length > 0 && <section><h3>Items</h3>{preview.items.map((plan, index) => <div className="import-row" key={`${plan.source.id}-${index}`}><span><strong>{plan.source.title}</strong><small>{plan.conflict ? 'ID already exists' : 'New item'}</small></span><select value={plan.choice} onChange={(event) => update((next) => { next.items[index]!.choice = event.target.value as typeof plan.choice; })}><option value="add" disabled={plan.conflict}>Add</option><option value="copy">Copy with new ID</option><option value="skip">Skip</option></select></div>)}</section>}
      {preview.views.length > 0 && <section><h3>Views</h3>{preview.views.map((plan, index) => <div className="import-row" key={`${plan.source.id}-${index}`}><span><strong>{plan.source.name}</strong><small>{plan.conflict ? 'ID already exists' : 'New view'}</small></span><select value={plan.choice} onChange={(event) => update((next) => { next.views[index]!.choice = event.target.value as typeof plan.choice; })}><option value="add" disabled={plan.conflict}>Add</option><option value="copy">Copy with new ID</option><option value="skip">Skip</option></select></div>)}</section>}
      <footer><button className="secondary" onClick={onClose}>Cancel</button><span/><button className="primary" disabled={Boolean(preview.errors.length || unresolved)} onClick={() => onApply(preview)}>Import in one transaction</button></footer>
    </>}
  </section></div>;
}

const compareVersions = (left: string, right: string) => {
  const a = left.split('.').map(Number); const b = right.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) { const difference = (a[index] ?? 0) - (b[index] ?? 0); if (difference) return difference; }
  return 0;
};

function RecoveryShell({ session, reason, onRetry }: { session: UnlockedWorkspace | undefined; reason: string; onRetry?: () => void }) {
  const raw = session?.document as unknown as Partial<WorkspaceDocument> | undefined;
  const items = raw?.items && typeof raw.items === 'object' ? Object.values(raw.items).filter((item): item is UniversalItem => Boolean(item && typeof item === 'object')) : [];
  return <main className="lock-shell"><section className="lock-card recovery-shell"><p className="eyebrow">SAFE RECOVERY MODE</p><h1>Your workspace data is still available</h1><p className="error" role="alert">{reason}</p><p>Recurrence, scripts, automations, reminders, push and saved filters are disabled in this mode.</p><div className="settings-actions"><button className="primary" onClick={() => void downloadLockedRecoveryCopy()}>Download encrypted workspace + log</button>{onRetry && <button className="secondary" onClick={onRetry}>Retry normal startup</button>}</div>{items.length > 0 && <section><h2>Readable items ({items.length})</h2><div className="rule-list">{items.slice(0, 200).map((item) => <article className="rule-card" key={String(item.id)}><strong>{typeof item.title === 'string' ? item.title : 'Untitled item'}</strong><small>{typeof item.state === 'string' ? item.state : 'unknown'}{item.schedule?.startAt ? ` · ${formatRussianDateTime(item.schedule.startAt)}` : item.schedule?.dueAt ? ` · ${formatRussianDateTime(item.schedule.dueAt)}` : ''}</small>{typeof item.bodyMarkdown === 'string' && item.bodyMarkdown && <p>{item.bodyMarkdown.slice(0, 240)}</p>}</article>)}</div></section>}</section></main>;
}

function MigrationGate({ session, language, onUpdate, onRecovery }: { session: UnlockedWorkspace; language: WorkspaceLanguage; onUpdate: (session: UnlockedWorkspace, language: WorkspaceLanguage) => void; onRecovery: (reason: string) => void }) {
  const sourceVersion = String((session.document as WorkspaceDocument).schemaVersion ?? '1.0.0');
  const newer = compareVersions(sourceVersion, SCHEMA_VERSION) > 0;
  let preview: ReturnType<typeof migrateWorkspace> | undefined; let error = '';
  if (!newer) { try { preview = migrateWorkspace(clean(session.document as WorkspaceDocument)); } catch (reason) { error = reason instanceof Error ? reason.message : String(reason); } }
  const issues = preview?.value.migrationIssues.filter((issue) => issue.status === 'needs_repair') ?? [];
  const total = Object.keys((session.document as WorkspaceDocument).items ?? {}).length + Object.keys((session.document as WorkspaceDocument).views ?? {}).length;
  return <main className="lock-shell"><section className="lock-card"><p className="eyebrow">WORKSPACE UPDATE</p><h1>{newer ? 'This workspace was created by a newer app' : `Update workspace ${sourceVersion} → ${SCHEMA_VERSION}`}</h1><p>{newer ? 'Universal will not downgrade or overwrite it. Download a copy or open recovery mode, then update the app.' : 'The original encrypted workspace will be saved as a rollback version before any migrated data is written.'}</p>{preview && <dl><div><dt>Compatible entities</dt><dd>{Math.max(0, total - issues.length)}</dd></div><div><dt>Needs repair</dt><dd>{issues.length}</dd></div><div><dt>Target schema</dt><dd>{SCHEMA_VERSION}</dd></div></dl>}{error && <p className="error" role="alert">Preflight failed: {error}</p>}<div className="settings-actions"><button className="secondary" onClick={() => void downloadLockedRecoveryCopy()}>Download old encrypted copy</button>{!newer && preview && <button className="primary" onClick={() => onUpdate(session, language)}>Save old version and update</button>}<button className="secondary" onClick={() => onRecovery(newer ? `Workspace schema ${sourceVersion} is newer than supported ${SCHEMA_VERSION}.` : error || 'Opened without running incompatible features.')}>Open recovery mode</button></div></section></main>;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(reason: unknown) { return { error: reason instanceof Error ? reason.message : String(reason) }; }
  componentDidCatch(reason: unknown) { recordDiagnostic({ kind: 'error', message: 'Root render failed', operation: 'Render application', outcome: 'failed', details: diagnosticFailureCode(reason) }); }
  render() { return this.state.error ? <RecoveryShell session={undefined} reason={`Application startup failed: ${this.state.error}`} onRetry={() => this.setState({ error: null })} /> : this.props.children; }
}


function AutomationsPage({ workspace, commit }: { workspace: WorkspaceDocument; commit: (message: string, mutation: (draft: WorkspaceDocument) => void) => void }) {
  const [editing, setEditing] = useState<AutomationRule | null>(null);
  const [actions, setActions] = useState('[]');
  const [error, setError] = useState('');
  const edit = (rule: AutomationRule) => { setEditing(clean(rule)); setActions(JSON.stringify(rule.actions, null, 2)); };
  return <section className="page-section"><div className="page-title"><div><p className="eyebrow">IF → THEN, LOCALLY</p><h1>Automations</h1><p>Rules can change your workspace, but cannot run code or access the network.</p></div><button className="primary" onClick={() => edit({ id: createId(), name: 'New automation', enabled: true, trigger: { type: 'item.created' }, condition: { source: 'true' }, actions: [{ type: 'notify', title: 'Created', body: 'A new item was created' }], missedPolicy: 'run_each', maxDepth: 5, cooldownMs: 0 })}>+ New automation</button></div>
    <div className="automation-layout"><div className="rule-list">{Object.values(workspace.automations).map((rule) => <article className="rule-card" key={rule.id}><div><span className={`status-dot ${rule.enabled ? 'on' : ''}`} /><strong>{rule.name}</strong><small>{rule.trigger.type}</small></div><code>{rule.condition.source}</code>{rule.disabledReason && <p className="error">{rule.disabledReason}</p>}<footer><button className="secondary" onClick={() => commit('Toggle rule', (draft) => { draft.automations[rule.id]!.enabled = !draft.automations[rule.id]!.enabled; delete draft.automations[rule.id]!.disabledReason; })}>{rule.enabled ? 'Disable' : 'Enable'}</button><button className="secondary" onClick={() => edit(rule)}>Edit</button></footer></article>)}{!Object.keys(workspace.automations).length && <div className="empty-panel"><svg className="automation-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 2 4.5 13.2h7.3L11 22l8.5-11.2h-7.3L13 2Z" /></svg><h3>No automations yet</h3><p>Create a safe rule for repetitive work.</p></div>}</div><aside className="log-panel"><h3>Execution log</h3>{workspace.automationLog.slice(-20).reverse().map((entry) => <div className="log-line" key={entry.id}><span className={`status-dot ${entry.outcome === 'success' ? 'on' : entry.outcome === 'failed' ? 'bad' : ''}`} /><div><strong>{workspace.automations[entry.ruleId]?.name ?? 'Deleted rule'}</strong><small>{entry.outcome} · {formatSystemDateTime(entry.finishedAt, workspace.calendarPreferences.language)}</small></div></div>)}{!workspace.automationLog.length && <p className="empty">Runs will appear here.</p>}</aside></div>
    {editing && <div className="modal-backdrop"><section className="dialog wide-dialog"><header><h2>Automation rule</h2><button className="icon-button" onClick={() => setEditing(null)}>×</button></header><label>Name<input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label><div className="form-grid two"><label>Trigger<select value={editing.trigger.type} onChange={(event) => setEditing({ ...editing, trigger: { type: event.target.value as AutomationRule['trigger']['type'] } })}>{['item.created', 'item.updated', 'status.changed', 'occurrence.activated', 'occurrence.boundary', 'reminder.due', 'time.schedule'].map((trigger) => <option key={trigger}>{trigger}</option>)}</select></label><label>Missed runs<select value={editing.missedPolicy} onChange={(event) => setEditing({ ...editing, missedPolicy: event.target.value as AutomationRule['missedPolicy'] })}><option value="run_each">Run each</option><option value="run_once">Run once</option><option value="skip">Skip</option></select></label></div>{editing.trigger.type === 'time.schedule' && <label>Schedule RRULE<input value={editing.trigger.rrule ?? 'FREQ=DAILY;BYHOUR=9'} onChange={(event) => setEditing({ ...editing, trigger: { ...editing.trigger, rrule: event.target.value } })} /></label>}<label>Condition DSL<input value={editing.condition.source} onChange={(event) => setEditing({ ...editing, condition: { source: event.target.value } })} /></label><label>Actions <span className="hint">allowlisted JSON</span><textarea className="code-area" rows={11} value={actions} onChange={(event) => setActions(event.target.value)} /></label><p className="hint">Actions: set_field, close, archive, create_item, add_relation, set_progress, add_reminder, notify.</p>{error && <p className="error">{error}</p>}<footer><button className="danger" onClick={() => { commit('Delete automation', (draft) => { delete draft.automations[editing.id]; }); setEditing(null); }}>Delete</button><span /><button className="secondary" onClick={() => setEditing(null)}>Cancel</button><button className="primary" onClick={() => { try { parseExpression(editing.condition.source || 'true'); const parsed = JSON.parse(actions) as AutomationAction[]; if (!Array.isArray(parsed)) throw new Error('Actions must be an array'); commit('Save automation', (draft) => { draft.automations[editing.id] = clean({ ...editing, actions: parsed }); }); setEditing(null); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } }}>Save rule</button></footer></section></div>}
  </section>;
}

function SettingsPage({ workspace, commit, onNotify, onTransfer, onImportFile, onEnableBackground, onDisableBackground, onBackgroundContent, onRestoredSnapshot }: {
  workspace: WorkspaceDocument; commit: (message: string, mutation: (draft: WorkspaceDocument) => void) => void;
  onNotify: () => void; onTransfer: () => void; onImportFile: (file: File) => void;
  onEnableBackground: () => void; onDisableBackground: () => void;
  onBackgroundContent: (contentMode: WorkspaceDocument['pushPreferences']['contentMode']) => void;
  onRestoredSnapshot: (session: UnlockedWorkspace) => void;
}) {
  const [field, setField] = useState<CustomFieldDefinition | null>(null);
  const jsonInput = useRef<HTMLInputElement>(null);
  const [snapshots, setSnapshots] = useState<LocalWorkspaceSnapshotInfo[]>([]);
  const [snapshotError, setSnapshotError] = useState('');
  useEffect(() => { void listLocalWorkspaceSnapshots().then(setSnapshots).catch((reason) => setSnapshotError(reason instanceof Error ? reason.message : String(reason))); }, [workspace.schemaVersion]);
  const exportAll = (format: PortableFormat, metadata = false) => {
    const items = Object.values(workspace.items).filter((item) => !item.deletedAt);
    exportPortable(workspace, createPortablePackage(workspace, { kind: 'items', items, views: format === 'xlsx' ? Object.values(workspace.views) : [], selection: { type: 'all_items' } }), `${safeFilename(workspace.name)}-all-items`, format, metadata);
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
  return <div className="settings-page"><div className="page-title"><div><h1>Settings</h1></div></div>
<details className="settings-disclosure"><summary>Appearance and sounds</summary>    <section className="settings-card"><p className="eyebrow">APPEARANCE</p><h2>Theme</h2><p>Choose a light, dark or system theme. Scheduled mode switches automatically using the times below.</p><label>Theme<select value={workspace.calendarPreferences.appearance.mode} onChange={(event) => commit('Change theme mode', (draft) => { draft.calendarPreferences.appearance.mode = event.target.value as WorkspaceDocument['calendarPreferences']['appearance']['mode']; })}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option><option value="scheduled">Scheduled</option></select></label>{workspace.calendarPreferences.appearance.mode === 'scheduled' && <div className="form-grid two"><label>Light theme starts<input type="time" value={workspace.calendarPreferences.appearance.lightAt} onChange={(event) => commit('Change light theme schedule', (draft) => { draft.calendarPreferences.appearance.lightAt = event.target.value; })} /></label><label>Dark theme starts<input type="time" value={workspace.calendarPreferences.appearance.darkAt} onChange={(event) => commit('Change dark theme schedule', (draft) => { draft.calendarPreferences.appearance.darkAt = event.target.value; })} /></label></div>}<hr/><p className="eyebrow">GUIDANCE</p><h2>Detailed explanations</h2><label className="check explanations-setting"><input type="checkbox" checked={workspace.calendarPreferences.showExplanations} onChange={(event) => commit('Toggle detailed explanations', (draft) => { draft.calendarPreferences.showExplanations = event.target.checked; })} />Show explanatory text and guides throughout the interface</label><hr/><p className="eyebrow">SOUND</p><h2>Interface sounds</h2><label className="check"><input type="checkbox" checked={workspace.calendarPreferences.appearance.uiSound} onChange={(event) => commit('Toggle interface sounds', (draft) => { draft.calendarPreferences.appearance.uiSound = event.target.checked; })} />Play calm sounds for buttons and controls</label><h2>Completion sound</h2><label className="check"><input type="checkbox" checked={workspace.calendarPreferences.appearance.tickSound} onChange={(event) => commit('Toggle completion sound', (draft) => { draft.calendarPreferences.appearance.tickSound = event.target.checked; })} />Play a short sound when an item is completed</label></section></details>
<div className="settings-columns"><details className="settings-disclosure"><summary>Custom fields and testing</summary><section className="settings-card"><header><div><p className="eyebrow">DATA MODEL</p><h2>Custom fields</h2></div><button className="secondary" onClick={() => setField({ id: createId(), key: '', label: '', kind: 'text', required: false })}>+ Add</button></header>{Object.values(workspace.customFields).map((entry) => <button className="setting-row" key={entry.id} onClick={() => setField(clean(entry))}><span><strong>{entry.label}</strong><small>custom.{entry.key}</small></span><span>{entry.kind}</span></button>)}{!Object.keys(workspace.customFields).length && <p className="empty">No custom fields yet.</p>}<hr/><p className="eyebrow">TESTING</p><h2>Accelerated day</h2><p>Choose how much real time equals one simulated day. The visible clock, Views, scripts, active ranges, recurrence, Calendar and local reminders follow it.</p><label className="check"><input type="checkbox" checked={testClockDraft.enabled} onChange={(event) => setTestClockDraft((current) => ({ ...current, enabled: event.target.checked }))} /> Enable accelerated test clock</label><div className="form-grid two"><label>One simulated day<input type="number" min="0.01" step="any" inputMode="decimal" value={testClockDraft.value} onChange={(event) => setTestClockDraft((current) => ({ ...current, value: event.target.value }))} /></label><label>Unit<select value={testClockDraft.unit} onChange={(event) => setTestClockDraft((current) => ({ ...current, unit: event.target.value as TestClockUnit }))}><option value="seconds">Seconds</option><option value="minutes">Minutes</option><option value="hours">Hours</option></select></label></div><button className="secondary" disabled={!validTestClockDraft || !testClockDraftChanged} onClick={applyTestClock}>Apply</button><p className="hint">Changes start only after Apply. Example: 30 seconds = one simulated day. Backup schedules, diagnostics and background push remain on real time to avoid false alerts or external deliveries during a test.</p></section></details>
<details className="settings-disclosure"><summary>Data, notifications and application</summary>    <section className="settings-card"><p className="eyebrow">INTERFACE</p><h2>Interface language</h2><p>Choose the language used by the app on this device. Item titles and your data are never translated.</p><label>Language<select value={workspace.calendarPreferences.language} onChange={(event) => commit('Change interface language', (draft) => { draft.calendarPreferences.language = event.target.value as WorkspaceDocument['calendarPreferences']['language']; })}>{interfaceLanguages.map((language) => <option value={language.value} key={language.value}>{language.label}</option>)}</select></label><hr/><p className="eyebrow">PORTABILITY</p><h2>Move your data</h2><p>Encrypted Transfer is safe for complete workspace merge. Readable exports use the same preview, add and copy rules on import.</p><div className="settings-actions"><button className="secondary" onClick={onTransfer}><LineIcon name="transfer"/> Encrypted Transfer</button><details className="inline-menu"><summary>Export all…</summary><div><button onClick={() => exportAll('json')}>JSON</button><button onClick={() => exportAll('csv')}>CSV</button><button onClick={() => exportAll('xlsx')}>Excel</button><button onClick={() => exportAll('ics')}>iCalendar</button><button onClick={() => exportAll('ics', true)}>iCalendar + UTM metadata</button></div></details><button className="secondary" onClick={() => jsonInput.current?.click()}>Import data…</button><input ref={jsonInput} hidden type="file" accept=".json,.csv,.xlsx,.ics,application/json,text/csv,text/calendar,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImportFile(file); event.currentTarget.value = ''; }} /></div><hr/><p className="eyebrow">DEVICE</p><h2>Notifications</h2><p>Local reminders appear while the app is open. Background delivery uses optional Web Push and the free Cloudflare plan checks due jobs every 15 minutes.</p><button className="secondary" onClick={onNotify}>Allow local notifications</button><div className="background-push"><div><strong>Background notifications</strong><small>{workspace.pushPreferences.enabled ? 'Enabled for this encrypted workspace copy.' : 'Off — reminders stay only on this device while the app is open.'}</small></div>{workspace.pushPreferences.enabled ? <button className="secondary" onClick={onDisableBackground}>Disable</button> : <button className="secondary" onClick={onEnableBackground}>Enable background delivery</button>}</div>{workspace.pushPreferences.enabled && <label className="push-privacy">Lock-screen content<select value={workspace.pushPreferences.contentMode} onChange={(event) => onBackgroundContent(event.target.value as WorkspaceDocument['pushPreferences']['contentMode'])}><option value="generic">Generic — no task title leaves this device</option><option value="detailed">Show task title and urgency</option></select></label>}<p className="hint">For iPhone, install Universal to the Home Screen, then enable this from the installed app. The Worker never receives your password or encrypted database.</p><details className="notification-help"><summary>iPhone background notification instructions</summary><div><p>First add Universal to the Home Screen and open it from there. Tap <em>Allow local notifications</em> if iOS has not granted permission yet. Then tap <em>Enable background delivery</em> and enter the notification access code supplied by the workspace owner. This is optional; without it, reminders remain local to the device.</p><p>Background delivery is checked about every 15 minutes on the free service, so it is not an exact alarm. GitHub only hosts the app files; it does not receive your workspace or notification list. When detailed lock-screen content is selected, the push service temporarily receives the task title, Start, Deadline and reminder urgency needed to send the notification.</p></div></details><hr/><p className="eyebrow">LOCAL WORKSPACE</p><h2>Workspace storage</h2><p>Your workspace is encrypted and stored in this browser's private app storage (IndexedDB). iPhone does not expose a normal folder path for site data.</p><dl><div><dt>Storage</dt><dd>Encrypted local browser storage</dd></div><div><dt>Workspace ID</dt><dd className="mono">{workspace.workspaceId}</dd></div><div><dt>Portable backup</dt><dd>Encrypted <code>.utmb</code> file</dd></div></dl><p className="hint">Use Encrypted Transfer above to save a <code>.utmb</code> backup in Files, iCloud Drive or another cloud. The app validates the encrypted contents instead of trusting the filename.</p><div className="backup-notice"><strong>Backups are manual in this web app</strong><span>Browsers and iOS do not allow a PWA to silently write encrypted backups into a user-selected folder. Choose a folder in Files when exporting, then replace the previous backup there.</span></div><p className="hint">This release supports one local workspace owner. Separate user accounts and permissions are not enabled yet; adding names here would not create real security boundaries.</p><hr/><p className="eyebrow">APPLICATION</p><h2>{APP_NAME}</h2><dl><div><dt>Version</dt><dd>v{APP_VERSION}</dd></div><div><dt>Released</dt><dd><time dateTime={APP_RELEASED_AT}>{formatRussianDateTime(APP_RELEASED_AT)}</time></dd></div></dl><hr/><p className="eyebrow">WORKSPACE</p><h2>{workspace.name}</h2><dl><div><dt>Schema</dt><dd>{workspace.schemaVersion}</dd></div><div><dt>Items</dt><dd>{Object.keys(workspace.items).length}</dd></div><div><dt>Workspace ID</dt><dd className="mono">{workspace.workspaceId}</dd></div></dl></section></details></div>
<details className="settings-disclosure"><summary>Workspace versions</summary>    <section className="settings-card"><p className="eyebrow">RECOVERY</p><h2>Workspace versions</h2><p>Universal keeps the two encrypted versions from before schema updates.</p>{snapshotError && <p className="error">{snapshotError}</p>}{snapshots.map((snapshot) => <div className="setting-row" key={snapshot.id}><span><strong>Schema {snapshot.schemaVersion}</strong><small>{formatRussianDateTime(snapshot.createdAt)} · {snapshot.reason}</small></span><span className="settings-actions"><button className="secondary" onClick={() => void exportLocalWorkspaceSnapshot(snapshot.id).then((source) => downloadLockedRecoveryCopy(source, `universal-schema-${snapshot.schemaVersion}`)).catch((reason) => setSnapshotError(reason instanceof Error ? reason.message : String(reason)))}>Download</button><button className="secondary" onClick={() => { const password = window.prompt('Enter the password for this workspace version'); if (!password) return; void restoreLocalWorkspaceSnapshot(snapshot.id, password).then(onRestoredSnapshot).catch((reason) => setSnapshotError(reason instanceof Error ? reason.message : String(reason))); }}>Restore</button></span></div>)}{!snapshots.length && <p className="empty">No previous workspace versions yet.</p>}</section></details>
{workspace.migrationIssues.length > 0 && <details className="settings-disclosure"><summary>Compatibility repairs</summary><section className="settings-card"><p className="eyebrow">COMPATIBILITY</p><h2>Items needing repair</h2>{workspace.migrationIssues.map((issue) => <div className="setting-row" key={issue.id}><span><strong>{issue.code}</strong><small>{issue.entityType} · {issue.entityId} · disabled {issue.disabledCapability}</small></span>{issue.status === 'needs_repair' && issue.code === 'recurrence_missing_anchor' ? <span className="settings-actions"><button className="secondary" onClick={() => repairRecurrenceIssue(issue.id, issue.entityId)}>Choose start</button><button className="secondary" onClick={() => discardQuarantinedRecurrence(issue.id, issue.entityId)}>Remove recurrence</button></span> : <span>{issue.status}</span>}</div>)}</section></details>}
    {field && <div className="modal-backdrop"><section className="dialog"><header><h2>Custom field</h2><button className="icon-button" onClick={() => setField(null)}>×</button></header><label>Label<input value={field.label} onChange={(event) => setField({ ...field, label: event.target.value, key: field.key || event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_') })} /></label><label>Key<input value={field.key} pattern="[a-z][a-z0-9_]*" onChange={(event) => setField({ ...field, key: event.target.value })} /></label><label>Type<select value={field.kind} onChange={(event) => setField({ ...field, kind: event.target.value as CustomFieldDefinition['kind'] })}>{['text', 'number', 'boolean', 'date', 'datetime', 'duration', 'enum', 'multi_enum', 'url', 'item_ref', 'formula'].map((kind) => <option key={kind}>{kind}</option>)}</select></label>{field.kind === 'formula' && <label>Formula DSL<input value={field.formula ?? ''} onChange={(event) => setField({ ...field, formula: event.target.value })} placeholder="custom.rate * custom.hours" /></label>}<footer><button className="danger" onClick={() => { commit('Delete custom field', (draft) => { delete draft.customFields[field.id]; }); setField(null); }}>Delete</button><span/><button className="primary" disabled={!field.label || !/^[a-z][a-z0-9_]*$/.test(field.key)} onClick={() => { if (field.formula) parseExpression(field.formula); commit('Save custom field', (draft) => { draft.customFields[field.id] = clean(field); }); setField(null); }}>Save field</button></footer></section></div>}
  </div>;
}

function TransferDialog({ session, onMerged, onReplaced, onBackupExported, onClose }: { session: UnlockedWorkspace; onMerged: (session: UnlockedWorkspace, message: string) => void; onReplaced: (session: UnlockedWorkspace, message: string) => void; onBackupExported?: () => void; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [restoreSource, setRestoreSource] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const download = async () => {
    setBusy(true); setError('');
    try {
      await saveLocalWorkspace(session.document, session.dataKey, session.storageMode);
      const content = await exportEncryptedLocalBackup();
      const filename = `${session.document.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'workspace'}.utmb`;
      const file = new File([content], filename, { type: 'application/octet-stream', lastModified: Date.now() });
      const shareNavigator = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
      const isAppleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
      if (isAppleMobile && navigator.share && shareNavigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'Encrypted Universal backup' });
      else {
        const url = URL.createObjectURL(file);
        const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      }
      onBackupExported?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const importFile = async (file: File) => {
    setBusy(true); setError('');
    try {
      const source = await readEncryptedBackup(file);
      const details = await validateContainer(source, password);
      if (details.workspaceId !== session.document.workspaceId) {
        setRestoreSource(source);
        setError(`This backup belongs to a different workspace (${details.itemCount} items). It cannot be merged. You can replace this device's local workspace with it instead.`);
        return;
      }
      const result = await mergeIntoLocalWorkspace(session, source, password);
      onMerged(result.unlocked, `Merged ${result.changedItems} changed items`);
      onClose();
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  const replaceFromBackup = async () => {
    if (!restoreSource) return;
    setBusy(true); setError('');
    try {
      const restored = await restoreLocalWorkspace(restoreSource, password);
      onReplaced(restored, `Restored ${Object.keys(restored.document.items).length} items from encrypted backup`);
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <div className="modal-backdrop"><section className="dialog"><header><h2>Encrypted backup & transfer</h2><button className="icon-button" onClick={onClose}>×</button></header><p>The unlocked workspace can be exported immediately: Universal reuses its existing encryption and verifies the saved encrypted block. A password is needed only to open an imported backup.</p><label>Backup password (only for import)<input type="password" minLength={10} value={password} onChange={(event) => { setPassword(event.target.value); setRestoreSource(null); }} /></label>{error && <p className="error">{error}</p>}<div className="transfer-actions"><button className="primary" disabled={busy} onClick={() => void download()}>Export encrypted .utmb</button><button className="secondary" disabled={password.length < 10 || busy} onClick={() => input.current?.click()}>{restoreSource ? 'Choose another backup' : 'Merge from backup'}</button><input ref={input} hidden type="file" accept=".utmb,application/octet-stream" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); }} /></div>{restoreSource && <div className="restore-warning"><strong>Replace this device?</strong><p>This removes the current local workspace from this browser and restores the selected encrypted backup. The backup itself is not changed.</p><button className="danger" disabled={busy} onClick={() => void replaceFromBackup()}>Replace local workspace from backup</button></div>}<p className="hint">On iPhone, choose a <code>.utmb</code> backup in Files. Wrong passwords, unrelated files and modified containers are rejected before your local workspace changes.</p></section></div>;
}

export default function App() {
  const [page, setPage] = useState<Page>('home');
  const [editor, setEditor] = useState<UniversalItem | null>(null);
  const [editorIsNew, setEditorIsNew] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [popupNoticeIds, setPopupNoticeIds] = useState<string[]>([]);
  const [noticeCenterOpen, setNoticeCenterOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [newViewRequest, setNewViewRequest] = useState(0);
  const [toast, setToast] = useToast();
  const [backupReminder, setBackupReminder] = useState(false);
  const [faceId, setFaceId] = useState<'available' | 'unsupported' | 'configured'>('unsupported');
  const [quick, setQuick] = useState('');
  const [celebrationColors, setCelebrationColors] = useState<Map<string, string>>(new Map());
  const [undoActions, setUndoActions] = useState<PendingUndoAction[]>([]);
  const [undoClock, setUndoClock] = useState(() => Date.now());
  const [portableImportSource, setPortableImportSource] = useState<string | null>(null);
  const [clockTick, refreshClock] = useState(() => Date.now());
  const seenNoticeIds = useRef(new Set<string>());
  const noticeTimers = useRef(new Map<string, number>());
  const completionTimers = useRef(new Map<string, { exit: number; remove: number }>());
  const pushError = useRef('');
  const captureInputRef = useRef<HTMLInputElement>(null);
  const [diagnosticCount, setDiagnosticCount] = useState(() => readDiagnostics().length);
  const [pendingUpgrade, setPendingUpgrade] = useState<{ session: UnlockedWorkspace; language: WorkspaceLanguage } | null>(null);
  const [recovery, setRecovery] = useState<{ session?: UnlockedWorkspace; reason: string } | null>(null);
  const { boot, session, workspace, activate, commit, lockWorkspace, adoptSession } = useWorkspaceController({ onToast: setToast, setNotices });
  useEffect(() => {
    if (!workspace || session?.storageMode === 'plaintext') { setFaceId('unsupported'); return; }
    void faceIdStatus().then(setFaceId).catch(() => setFaceId('unsupported'));
  }, [workspace?.workspaceId, session?.storageMode]);
  const enterWorkspace = async (unlocked: UnlockedWorkspace, language: WorkspaceLanguage) => {
    const sourceVersion = String((unlocked.document as WorkspaceDocument).schemaVersion ?? '1.0.0');
    if (sourceVersion !== SCHEMA_VERSION) { setPendingUpgrade({ session: unlocked, language }); return; }
    await activate(unlocked, language);
  };
  const queueUndo = (label: string, undo: () => void, expiresAt?: number, itemId?: string) => {
    const queuedAt = Date.now();
    const resolvedExpiresAt = expiresAt ?? queuedAt + UNDO_WINDOW_MS;
    const id = createId();
    setUndoClock(queuedAt);
    setUndoActions((current) => [...(itemId ? current.filter((action) => action.itemId !== itemId) : current), { id, label, expiresAt: resolvedExpiresAt, undo, ...(itemId ? { itemId } : {}) }]);
    return id;
  };
  const clearCompletionHold = (itemId: string) => {
    const timers = completionTimers.current.get(itemId);
    if (timers) { window.clearTimeout(timers.exit); window.clearTimeout(timers.remove); }
    completionTimers.current.delete(itemId);
    setCompletionHold(itemId);
  };
  const holdCompletedItem = (item: UniversalItem, undoUntil: number) => {
    clearCompletionHold(item.id);
    const removeAt = undoUntil + COMPLETION_EXIT_MS;
    setCompletionHold(item.id, { previous: clean(item), undoUntil, removeAt });
    const exit = window.setTimeout(() => refreshClock(Date.now()), Math.max(0, undoUntil - Date.now()));
    const remove = window.setTimeout(() => {
      completionTimers.current.delete(item.id);
      setCompletionHold(item.id);
      refreshClock(Date.now());
    }, Math.max(0, removeAt - Date.now()));
    completionTimers.current.set(item.id, { exit, remove });
  };
  const runUndo = (id: string) => {
    const action = undoActions.find((candidate) => candidate.id === id);
    if (action && action.expiresAt > Date.now()) action.undo();
    setUndoActions((current) => current.filter((candidate) => candidate.id !== id));
  };
  const systemNow = workspace ? effectiveWorkspaceNow(workspace, new Date(clockTick)) : new Date(clockTick);
  const recurrenceReconcileMinute = Math.floor(systemNow.getTime() / 60_000);
  const recurrenceSeriesSignature = workspace ? Object.values(workspace.items).filter((item) => item.role === 'series_template' && item.recurrence && !item.deletedAt).map((item) => `${item.id}:${item.revision}`).sort().join('|') : '';
  const backupReminderDays = workspace?.calendarPreferences.backupPreferences?.reminderDays ?? 7;
  const [backupReminderDraft, setBackupReminderDraft] = useState(() => String(backupReminderDays));
  useEffect(() => { setBackupReminderDraft(String(backupReminderDays)); }, [backupReminderDays]);
  const applyBackupReminderDays = () => {
    const reminderDays = Math.max(0, Number(backupReminderDraft || 0));
    const normalized = Number.isFinite(reminderDays) ? Math.floor(reminderDays) : 0;
    setBackupReminderDraft(String(normalized));
    if (normalized === backupReminderDays) return;
    commit('Change backup reminder', (draft) => {
      draft.calendarPreferences.backupPreferences = {
        ...(draft.calendarPreferences.backupPreferences ?? { reminderDays: 7 }),
        reminderDays: normalized,
      };
    });
  };
  useEffect(() => {
    const capture = (kind: DiagnosticEntry['kind'], message: string, details?: string) => { recordDiagnostic({ kind, message, page, ...(details ? { details } : {}) }); setDiagnosticCount(readDiagnostics().length); };
    const onError = (event: ErrorEvent) => capture('error', event.message || 'Unknown error', event.error?.stack);
    const onRejection = (event: PromiseRejectionEvent) => capture('unhandledrejection', event.reason instanceof Error ? event.reason.message : String(event.reason));
    window.addEventListener('error', onError); window.addEventListener('unhandledrejection', onRejection);
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); };
  }, [page]);
  useEffect(() => {
    const refresh = () => setDiagnosticCount(readDiagnostics().length);
    window.addEventListener(DIAGNOSTICS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(DIAGNOSTICS_CHANGED_EVENT, refresh);
  }, []);
  useViewport(captureInputRef, boot === 'ready');
  useEffect(() => {
    if (!workspace || !recurrenceSeriesSignature) return;
    commit('Reconcile recurring items', (draft) => { reconcileRecurrences(draft, effectiveWorkspaceNow(draft, new Date(clockTick))); });
  }, [workspace?.workspaceId, recurrenceSeriesSignature, recurrenceReconcileMinute]);
  useEffect(() => {
    if (!workspace) return;
    const prefs = workspace.calendarPreferences.backupPreferences;
    const days = prefs?.reminderDays ?? 7;
    // A new workspace should not be nagged immediately. Until its first backup,
    // use the workspace creation time as the reminder baseline.
    const reminderBaseline = prefs?.lastBackupAt ?? workspace.createdAt;
    const overdue = days > 0 && Date.now() - new Date(reminderBaseline).getTime() >= days * 86_400_000;
    setBackupReminder(overdue);
  }, [workspace?.updatedAt, workspace?.calendarPreferences.backupPreferences?.lastBackupAt, workspace?.calendarPreferences.backupPreferences?.reminderDays]);
  // Views using activeRange are time-sensitive; refresh their predicates without a reload.
  useEffect(() => {
    const timer = window.setInterval(() => refreshClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!undoActions.length) return;
    const refresh = () => { const now = Date.now(); setUndoClock(now); setUndoActions((current) => current.filter((action) => action.expiresAt > now)); };
    const timer = window.setInterval(refresh, 200);
    return () => window.clearInterval(timer);
  }, [undoActions.length]);
  useEffect(() => {
    setUndoActions([]);
    completionTimers.current.forEach(({ exit, remove }, itemId) => {
      window.clearTimeout(exit); window.clearTimeout(remove); setCompletionHold(itemId);
    });
    completionTimers.current.clear();
  }, [workspace?.workspaceId]);
  useEffect(() => {
    const fresh = notices.filter((notice) => !seenNoticeIds.current.has(notice.id));
    if (!fresh.length) return;
    fresh.forEach((notice) => {
      seenNoticeIds.current.add(notice.id);
      const timer = window.setTimeout(() => {
        setPopupNoticeIds((current) => current.filter((id) => id !== notice.id));
        noticeTimers.current.delete(notice.id);
      }, 3_000);
      noticeTimers.current.set(notice.id, timer);
    });
    setPopupNoticeIds((current) => [...current, ...fresh.map((notice) => notice.id)]);
  }, [notices]);
  useEffect(() => () => {
    noticeTimers.current.forEach((timer) => window.clearTimeout(timer));
    completionTimers.current.forEach(({ exit, remove }) => { window.clearTimeout(exit); window.clearTimeout(remove); });
  }, []);

  useEffect(() => {
    if (!workspace) return;
    const language = workspace.calendarPreferences.language;
    window.localStorage.setItem('utm-interface-language', language);
    // English is the source language. Installing a whole-document mutation
    // observer for it adds no value and can race React's own text updates
    // (notably the live active-item counters).
    if (language === 'en') return;
    return installDomLocalization(language);
  }, [workspace?.calendarPreferences.language]);
  useEffect(() => {
    if (workspace) setDiagnosticsEnabled(workspace.calendarPreferences.diagnosticsEnabled !== false);
  }, [workspace?.calendarPreferences.diagnosticsEnabled]);
  useEffect(() => {
    document.documentElement.dataset.explanations = workspace?.calendarPreferences.showExplanations ? 'on' : 'off';
    return () => { delete document.documentElement.dataset.explanations; };
  }, [workspace?.calendarPreferences.showExplanations]);
  useAppearance(workspace?.calendarPreferences.appearance, boot === 'ready', systemNow);
  useUiSounds(workspace?.calendarPreferences.appearance.uiSound);
  useEffect(() => {
    const itemId = new URLSearchParams(window.location.search).get('item');
    if (!itemId || !workspace?.items[itemId]) return;
    setEditor(itemEditorSource(workspace, workspace.items[itemId]!));
    window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash}`);
  }, [workspace]);
  useEffect(() => {
    if (!workspace?.pushPreferences.enabled) return;
    const timer = window.setTimeout(() => {
      void syncBackgroundPush(workspace).then(() => { pushError.current = ''; }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (pushError.current !== message) { pushError.current = message; setToast(`Background notification sync: ${message}`); }
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [workspace?.updatedAt, workspace?.pushPreferences.enabled]);

  const enableBackgroundNotifications = async () => {
    if (!workspace) return;
    const accessCode = window.prompt('Enter notification access code');
    if (!accessCode?.trim()) return;
    const preferences = createPushPreferences(workspace.pushPreferences.contentMode);
    const draftWorkspace = clean(workspace); draftWorkspace.pushPreferences = preferences;
    try {
      await subscribeBackgroundPush(draftWorkspace, accessCode.trim());
      await syncBackgroundPush(draftWorkspace);
      commit('Enable background notifications', (draft) => { draft.pushPreferences = clean(preferences); });
      setToast('Background notifications are enabled. Delivery on the free plan can take up to 15 minutes.');
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    }
  };
  const disableBackgroundNotifications = async () => {
    if (!workspace) return;
    try { await unsubscribeBackgroundPush(workspace); } catch { /* Removing a local subscription must still work offline. */ }
    commit('Disable background notifications', (draft) => { draft.pushPreferences = { enabled: false, contentMode: draft.pushPreferences.contentMode }; });
    setToast('Background notifications are disabled for this device.');
  };
  const setBackgroundNotificationContent = (contentMode: WorkspaceDocument['pushPreferences']['contentMode']) => {
    commit('Change background notification privacy', (draft) => { draft.pushPreferences.contentMode = contentMode; });
  };

  const changeItemState = (item: UniversalItem, state: UniversalItem['state'], celebrationColor = 'var(--color-text)') => {
    const occurredAt = workspace ? effectiveWorkspaceNow(workspace).toISOString() : new Date().toISOString();
    const completionExpiresAt = Date.now() + UNDO_WINDOW_MS;
    const targetId = item.habit ? item.id : item.occurrence?.seriesId && workspace?.items[item.occurrence.seriesId]?.habit ? item.occurrence.seriesId : item.id;
    const beforeTarget = workspace?.items[targetId] ? clean(workspace.items[targetId]!) : undefined;
    if (state === 'done') playCompletionSoundUnlessPreviewed(item.id, workspace?.calendarPreferences.appearance.tickSound);
    if (state === 'done') {
      setCelebrationColors((current) => new Map(current).set(item.id, celebrationColor));
      window.setTimeout(() => setCelebrationColors((current) => { const next = new Map(current); next.delete(item.id); return next; }), 900);
    }
    else {
      clearCompletionHold(item.id);
      setUndoActions((current) => current.filter((action) => action.itemId !== item.id));
      setCelebrationColors((current) => {
        if (!current.has(item.id)) return current;
        const next = new Map(current); next.delete(item.id); return next;
      });
    }
    let undoId: string | undefined;
    if (state === 'done' && beforeTarget) {
      holdCompletedItem(item, completionExpiresAt);
      undoId = queueUndo('Item completed', () => {
        commit('Undo item completion', (draft) => { draft.items[targetId] = clean(beforeTarget); });
        clearCompletionHold(item.id);
        setCelebrationColors((current) => { const next = new Map(current); next.delete(item.id); return next; });
      }, completionExpiresAt, item.id);
    }
    window.requestAnimationFrame(() => window.setTimeout(() => {
      const changed = commit('Change item state', (draft) => {
        let target = draft.items[item.id]; if (!target) return;
        if (item.habit || (item.occurrence?.seriesId && draft.items[item.occurrence.seriesId]?.habit)) {
          if (item.occurrence?.seriesId && draft.items[item.occurrence.seriesId]) target = draft.items[item.occurrence.seriesId]!;
          target.habit ??= { target: 1, unit: 'times', streakMode: 'manual_only', completedDates: [] };
          target.habit.completedDates ??= [];
          const date = (item.occurrence?.recurrenceId ?? occurredAt).slice(0, 10);
          if (state === 'done' && !target.habit.completedDates.includes(date)) target.habit.completedDates.push(date);
          if (state === 'open') {
            const index = target.habit.completedDates.indexOf(date);
            if (index >= 0) target.habit.completedDates.splice(index, 1);
          }
          target.state = 'open'; delete target.closure;
          target.updatedAt = occurredAt; target.revision += 1;
          return;
        }
        target.state = state; target.updatedAt = occurredAt; target.revision += 1;
        if (state === 'open') delete target.closure;
        else target.closure = { at: target.updatedAt, actor: 'user', reason: state === 'cancelled' ? 'cancelled' : 'manual' };
        if ((state === 'done' || state === 'cancelled') && target.occurrence && target.closure) advanceCompletionAnchoredSeries(draft, target, target.closure.at);
        const event = { id: createId(), type: 'status.changed' as const, at: target.updatedAt, itemId: target.id, before: clean(item), after: clean(target as unknown as UniversalItem), causationId: createId(), depth: 0 };
        const result = runAutomationEvents(draft, [event]);
        if (result.notifications.length) setNotices((current) => [...current, ...result.notifications.map((notice) => ({ ...notice, id: createId(), at: occurredAt }))]);
      });
      if (!changed && undoId) {
        setUndoActions((current) => current.filter((action) => action.id !== undoId));
        clearCompletionHold(item.id);
      }
      if (changed && state !== 'open') setNotices((current) => current.filter((notice) => notice.itemId !== item.id));
    }, 0));
  };
  const dismissPopupNotice = (id: string) => {
    const timer = noticeTimers.current.get(id);
    if (timer) window.clearTimeout(timer);
    noticeTimers.current.delete(id);
    setPopupNoticeIds((current) => current.filter((candidate) => candidate !== id));
  };
  const deleteNotice = (id: string) => {
    const notice = notices.find((candidate) => candidate.id === id);
    if (notice?.itemId && notice.reminderIds?.length) {
      const acknowledgedAt = workspace ? effectiveWorkspaceNow(workspace).toISOString() : new Date().toISOString();
      commit('Acknowledge reminders', (draft) => {
        const item = draft.items[notice.itemId!];
        if (!item) return;
        item.reminders.forEach((reminder) => { if (notice.reminderIds!.includes(reminder.id)) reminder.acknowledgedAt = acknowledgedAt; });
        item.updatedAt = acknowledgedAt; item.revision += 1;
      });
    }
    dismissPopupNotice(id);
    setNotices((current) => current.filter((notice) => notice.id !== id));
  };
  const openNoticeItem = (notice: Notice) => {
    const item = notice.itemId ? workspace?.items[notice.itemId] : Object.values(workspace?.items ?? {}).find((candidate) => candidate.title === notice.title);
    if (item) setEditor(itemEditorSource(workspace, item));
  };

  if (recovery) return <RecoveryShell session={recovery.session} reason={recovery.reason} onRetry={() => { setRecovery(null); setPendingUpgrade(null); }} />;
  if (pendingUpgrade) return <MigrationGate session={pendingUpgrade.session} language={pendingUpgrade.language} onUpdate={(next, language) => { setPendingUpgrade(null); void activate(next, language).catch((reason) => setRecovery({ session: next, reason: reason instanceof Error ? reason.message : String(reason) })); }} onRecovery={(reason) => setRecovery({ session: pendingUpgrade.session, reason })} />;
  if (boot === 'checking') return <main className="splash"><div className="brand-mark">U</div><p>Opening encrypted workspace…</p></main>;
  if (boot === 'empty' || boot === 'locked') return <LockScreen exists={boot === 'locked'} onReady={enterWorkspace} />;
  if (!workspace || !session) return null;
  const allItemsView = allItemsViewFor(workspace);

  const openItems = new Set(Object.values(workspace.items).filter((item) => item.state === 'open' && !item.deletedAt && !isItemTemplate(item) && (item.role !== 'series_template' || item.habit)).map((item) => item.occurrence?.seriesId ?? item.id)).size;
  const restoreItem = (item: UniversalItem) => commit('Restore item from trash', (draft) => {
    const target = draft.items[item.id]; if (!target?.deletedAt) return;
    delete target.deletedAt; delete draft.tombstones[item.id];
    target.updatedAt = systemNow.toISOString(); target.revision += 1;
    if (target.role === 'series_template') reconcileRecurrences(draft, systemNow);
  });
  const clearTrash = () => commit('Clear trash', (draft) => {
    Object.values(draft.items).forEach((item) => { if (item.deletedAt) { delete draft.items[item.id]; delete draft.tombstones[item.id]; } });
  });
  const permanentlyDeleteItem = (item: UniversalItem) => {
    const snapshot = clean(item);
    const deleted = commit('Permanently delete item', (draft) => {
    const target = draft.items[item.id]; if (!target?.deletedAt) return;
    delete draft.items[item.id]; delete draft.tombstones[item.id];
    });
    if (deleted) queueUndo('Item permanently deleted', () => commit('Undo permanent item deletion', (draft) => { draft.items[item.id] = clean(snapshot); if (snapshot.deletedAt) draft.tombstones[item.id] = snapshot.deletedAt; }));
  };
  const persistQuickItem = (item: UniversalItem) => {
    commit('Quick capture', (draft) => { draft.items[item.id] = clean(item); runAutomationEvents(draft, [{ id: createId(), type: 'item.created', at: item.createdAt, itemId: item.id, after: clean(item), causationId: createId(), depth: 0 }]); });
    setEditorIsNew(true); setEditor(item);
  };
  const captureQuickItem = () => {
    if (!quick.trim()) return;
    // Quick capture should only preserve what the user actually entered.
    // Calendar dates are added by calendar/view creation flows or explicitly
    // in the editor, never implicitly by the global capture field.
    persistQuickItem(createItem(quick.trim(), 'task', systemNow));
    setQuick('');
  };
  const captureQuickViewItem = (view: SavedView, title: string) => {
    const value = title.trim();
    if (!value) return;
    persistQuickItem(applyViewCreationDefaults(createItem(value, 'task', systemNow), view, workspace));
  };
  const downloadDiagnostics = downloadDiagnosticsFile;

  const activeDateLabel = formatHeaderDate(systemNow, workspace.calendarPreferences.language);
  return <><AppShell page={page} onPage={setPage} activeDateLabel={activeDateLabel} openItems={openItems} notices={notices} popupNoticeIds={popupNoticeIds} noticeCenterOpen={noticeCenterOpen} mobileNavOpen={mobileNavOpen} onNewView={() => setNewViewRequest((value) => value + 1)} onToggleNotices={() => { setMobileNavOpen(false); setNoticeCenterOpen((open) => !open); setPopupNoticeIds([]); }} onToggleNavigation={() => { setNoticeCenterOpen(false); setMobileNavOpen((open) => !open); }} onCloseNavigation={() => setMobileNavOpen(false)} onDismissPopup={dismissPopupNotice} onDeleteNotice={deleteNotice} onOpenNotice={openNoticeItem} onTransfer={() => setTransfer(true)} onLock={lockWorkspace} backupReminder={backupReminder && !transfer} onBackupReminder={() => setTransfer(true)} onDismissBackupReminder={() => setBackupReminder(false)}>
      {page === 'home' && <><ViewsPage workspace={workspace} commit={commit} onEditItem={(item) => setEditor(itemEditorSource(workspace, item))} onState={changeItemState} celebrationColors={celebrationColors} createRequest={newViewRequest} onAddItem={(view) => { setEditorIsNew(true); setEditor(applyViewCreationDefaults(createUiItem('', 'task', systemNow), view, workspace)); }} onExportView={(view, mode, format, metadata) => exportSavedView(workspace, view, mode, format, metadata)} /></>}
      {page === 'calendar' && <CalendarPage workspace={workspace} now={systemNow} commit={commit} createUiItem={createUiItem} onEditItem={(item) => setEditor(itemEditorSource(workspace, item))} />}
      {page === 'all' && <AllItemsPage workspace={workspace} view={allItemsView} onEdit={(item) => setEditor(itemEditorSource(workspace, item))} onState={changeItemState} onSaveView={(view) => commit('Customize all items view', (draft) => { draft.views[ALL_ITEMS_VIEW_ID] = clean(view); })} onRestore={restoreItem} onClearTrash={clearTrash} onDelete={permanentlyDeleteItem} />}
      {page === 'automations' && <AutomationsPage workspace={workspace} commit={commit} />}
      {page === 'organization' && <section className="page-section organization-page"><div className="page-title"><div><p className="eyebrow">PARA ORGANIZATION</p><h1>Areas, Projects and Tags</h1></div></div><OrganizationManager workspace={workspace} commit={commit} onEditItem={(item) => setEditor(itemEditorSource(workspace, item))} onState={changeItemState} celebrationColors={celebrationColors} onAddItem={(view) => { setEditorIsNew(true); setEditor(applyViewCreationDefaults(createUiItem('', 'task', systemNow), view, workspace)); }} onQuickAddItem={captureQuickViewItem} onExport={() => exportParaStructure(workspace)} /></section>}
      {page === 'settings' && <section className="page-section settings-page-shell">
        <details className="settings-disclosure"><summary>Backup and recovery</summary><section className="settings-card backup-controls"><p className="eyebrow">BACKUP SCHEDULE</p><h2>Backup reminders</h2><p>Choose how often the app should remind you to export an encrypted <code>.utmb</code> backup. The browser will not write to a folder by itself.</p><label>Remind every (days; 0 disables)<input type="text" inputMode="numeric" pattern="[0-9]*" value={backupReminderDraft} onChange={(event) => { const next = event.target.value; if (/^\d*$/.test(next)) setBackupReminderDraft(next); }} onBlur={applyBackupReminderDays} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label><label>Backup location note (optional)<input value={workspace.calendarPreferences.backupPreferences?.locationLabel ?? ''} placeholder="iCloud Drive / Universal" onChange={(event) => commit('Change backup location note', (draft) => { draft.calendarPreferences.backupPreferences = { ...(draft.calendarPreferences.backupPreferences ?? { reminderDays: 7 }), locationLabel: event.target.value }; })} /></label><button className="secondary" onClick={() => setTransfer(true)}>Create encrypted backup now</button><button className="secondary" onClick={() => void downloadOfflineRecoveryKit().then(() => setToast('Offline recovery kit downloaded.')).catch((reason) => setToast(reason instanceof Error ? reason.message : String(reason)))}>Download offline recovery kit</button>{workspace.calendarPreferences.backupPreferences?.lastBackupAt && <small>Last backup: {formatRussianDateTime(workspace.calendarPreferences.backupPreferences.lastBackupAt)}</small>}</section></details>
        <SettingsPage workspace={workspace} commit={commit} onTransfer={() => setTransfer(true)} onImportFile={(file) => { void portableFromFile(file, workspace).then(({ source, warnings }) => { if (warnings.length) setToast(warnings[0]!); setPortableImportSource(source); }).catch((error) => setToast(error instanceof Error ? error.message : String(error))); }} onNotify={() => void Notification.requestPermission().then((permission) => setToast(`Notification permission: ${permission}`))} onEnableBackground={() => void enableBackgroundNotifications()} onDisableBackground={() => void disableBackgroundNotifications()} onBackgroundContent={setBackgroundNotificationContent} onRestoredSnapshot={(next) => { adoptSession(next, true); setToast('Previous workspace version restored.'); }} />
        <details className="settings-disclosure"><summary>Diagnostics</summary><section className="settings-card diagnostics-card"><p className="eyebrow">DIAGNOSTICS</p><h2>Actions, results and error log</h2><p>Local diagnostics record operation names, results, durations and crashes without task content. Nothing is uploaded automatically.</p><label className="check"><input type="checkbox" checked={workspace.calendarPreferences.diagnosticsEnabled !== false} onChange={(event) => { setDiagnosticsEnabled(event.target.checked); commit('Toggle local diagnostics', (draft) => { draft.calendarPreferences.diagnosticsEnabled = event.target.checked; }); }} />Record local diagnostics</label><div className="diagnostics-actions"><span>{diagnosticCount} recorded entries</span><button className="secondary" onClick={downloadDiagnostics} disabled={!diagnosticCount}>Download log</button><button className="secondary" onClick={clearDiagnostics}>Clear log</button></div></section></details>
        <details className="settings-disclosure"><summary>Device unlock</summary><section className="settings-card"><p className="eyebrow">DEVICE UNLOCK</p><h2>Face ID / Touch ID</h2>{faceId === 'unsupported' ? <p>Unavailable on this browser or device. Password unlock remains available.</p> : <><p>Optional quick unlock for this device only. Face ID never replaces your password, and exports still require the password.</p>{faceId === 'configured' ? <button className="secondary" onClick={() => void disableFaceIdUnlock().then(() => { setFaceId('available'); setToast('Face ID unlock disabled. Password unlock remains unchanged.'); }).catch((reason) => setToast(reason instanceof Error ? reason.message : String(reason)))}>Disable Face ID</button> : <button className="secondary" onClick={() => void enableFaceIdUnlock(session.dataKey).then(() => { setFaceId('configured'); setToast('Face ID unlock is ready on this device.'); }).catch((reason) => setToast(reason instanceof Error ? reason.message : String(reason)))}>Enable Face ID</button>}<p className="hint">If Face ID fails, is cancelled, or the device changes, use the password field on the lock screen. Removing this option never removes your workspace.</p></>}</section></details>
      </section>}
    </AppShell>
    {page !== 'settings' && page !== 'organization' && <div className="capture-dock"><form className="quick-capture" data-quick-capture onSubmit={(event) => { event.preventDefault(); captureQuickItem(); }}><input ref={captureInputRef} enterKeyHint="done" value={quick} onChange={(event) => setQuick(event.target.value)} placeholder="Add new item" aria-label="Add new item"/></form></div>}
    {editor && <ItemEditor initial={editor} workspace={workspace} now={systemNow} isNew={editorIsNew} onReadPortableFile={async (file) => (await portableFromFile(file, workspace)).source} onExportItem={(item, format, metadata) => exportPortable(workspace, packageForItems(workspace, [item], { type: 'single_item', itemId: item.id }), `${safeFilename(item.title)}.utm-items`, format, metadata)} onClose={() => { setEditorIsNew(false); setEditor(null); }} onToggleSubtask={(id) => { const subtask = workspace.items[id]; if (subtask) changeItemState(subtask, subtask.state === 'done' ? 'open' : 'done'); }} onCreateSubtask={(title, parentId) => { const subtask = createUiItem(title, 'task', systemNow); commit('Create subtask', (draft) => { draft.items[subtask.id] = clean(subtask); const parent = draft.items[parentId]; if (parent && !parent.relations.some((relation) => relation.type === 'parent' && relation.targetId === subtask.id)) parent.relations = [...parent.relations, { id: createId(), targetId: subtask.id, type: 'parent' }]; }); return subtask; }} onSave={(item, options) => { const isNew = !workspace.items[item.id]; let recurrenceError = ''; const saved = commit(isNew ? 'Create item' : 'Update item', (draft) => { const before = draft.items[item.id]; draft.items[item.id] = clean(item); item.areas.forEach((area) => ensureAreaDefinition(draft, area)); item.projects.forEach((project) => { const existing = draft.projectDefinitions[project]; const converted = options?.convertedProject === project; ensureProjectDefinition(draft, project, !existing || converted ? { areas: [...new Set([...(existing?.areas ?? []), ...item.areas])] } : {}); }); item.tags.forEach((tag) => ensureTagDefinition(draft, tag)); if (item.list) ensureListDefinition(draft, item.list, { kind: 'list' }); if (before?.state === 'open' && (item.state === 'done' || item.state === 'cancelled') && item.occurrence && item.closure?.at) advanceCompletionAnchoredSeries(draft, item, item.closure.at); const event = { id: createId(), type: isNew ? 'item.created' as const : 'item.updated' as const, at: item.updatedAt, itemId: item.id, after: clean(item), causationId: createId(), depth: 0 }; runAutomationEvents(draft, [event], { now: systemNow }); if (item.role === 'series_template') { try { reconcileRecurrences(draft, systemNow); } catch (reason) { recurrenceError = reason instanceof Error ? reason.message : String(reason); } } }); if (saved) { recordDiagnostic({ kind: 'result', message: options?.convertedProject ? 'Item converted to Project and saved' : 'Item organization saved', operation: 'Save item organization', outcome: 'succeeded', details: JSON.stringify({ itemId: item.id, areas: item.areas.length, projects: item.projects.length, tags: item.tags.length, converted: Boolean(options?.convertedProject) }) }); setEditorIsNew(false); setEditor(null); if (recurrenceError) setToast(`Series saved. Recurrence sync will retry in the background (${recurrenceError}).`); } }} onDelete={(item) => { const snapshot = clean(workspace.items[item.id] ?? item); const deleted = commit('Delete item', (draft) => { const target = draft.items[item.id]; if (target) { target.deletedAt = systemNow.toISOString(); draft.tombstones[item.id] = target.deletedAt; } }); if (deleted) { queueUndo('Item deleted', () => commit('Undo item deletion', (draft) => { draft.items[item.id] = clean(snapshot); delete draft.tombstones[item.id]; })); setEditorIsNew(false); setEditor(null); } }} />}
    {transfer && <TransferDialog session={session} onClose={() => setTransfer(false)} onBackupExported={() => { commit('Record encrypted backup', (draft) => { draft.calendarPreferences.backupPreferences = { ...(draft.calendarPreferences.backupPreferences ?? { reminderDays: 7 }), lastBackupAt: new Date().toISOString() }; }); setBackupReminder(false); setToast('Encrypted backup saved. Choose its folder in Files.'); }} onMerged={(next, message) => { adoptSession(next); setToast(message); }} onReplaced={(next, message) => { adoptSession(next, true); setToast(message); }} />}
    {portableImportSource && <PortableImportDialog workspace={workspace} source={portableImportSource} onClose={() => setPortableImportSource(null)} onApply={(preview) => { commit('Import portable JSON package', (draft) => { const result = applyPortableImport(draft, preview); setToast(`Imported ${result.addedItems + result.copiedItems} items and ${result.addedViews + result.copiedViews} views`); }); setPortableImportSource(null); }} />}
    <ShellNotices toast={toast} undoNotices={undoActions.map((action) => ({ id: action.id, label: action.label, secondsLeft: Math.max(1, Math.ceil((action.expiresAt - undoClock) / 1_000)) }))} onUndo={runUndo} />
  </>;
}
