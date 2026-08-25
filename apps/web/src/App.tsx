import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import * as Automerge from '@automerge/automerge';
import ReactMarkdown from 'react-markdown';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/react/daygrid';
import timeGridPlugin from '@fullcalendar/react/timegrid';
import listPlugin from '@fullcalendar/react/list';
import interactionPlugin, { Draggable } from '@fullcalendar/react/interaction';
import * as XLSX from 'xlsx';
import type { CalendarApi, DateClickInfo, DateSelectInfo, DatesSetInfo, EventClickInfo, EventDropInfo, EventInput, EventReceiveInfo, EventResizeDoneInfo } from '@fullcalendar/react';
import '@fullcalendar/react/skeleton.css';
import { installDomLocalization, interfaceLanguages } from './i18n';
import { createPushPreferences, subscribeBackgroundPush, syncBackgroundPush, unsubscribeBackgroundPush } from './push';
import { CodeEditor } from './components/ui/CodeEditor';
import { CloseIcon, LineIcon, type LineIconName } from './components/ui/icons';
import { SectionGuide } from './components/ui/SectionGuide';
import {
  AllItemsPage,
  ALL_ITEMS_VIEW_ID,
  allItemsViewFor,
  formatScriptResult,
  inferredPreset,
  isItemTemplate,
  priorityNames,
  stateNames,
} from './features/items';
import { ItemEditor } from './features/items/editor/ItemEditor';
import {
  ViewsPage,
  effectiveWorkspaceNow,
  selectViewItems,
  setRecentlyDone,
} from './features/views';
import { dateInput, formatHeaderDate, formatRussianDateTime, formatSystemDateTime, formatViewDate, fromDateInput, isSleepTime, scheduledTheme } from './utils/dates';
import { calendarDuration, calendarDurationMs, parseEstimateDuration, parseFriendlyDuration, parseReminderDuration, reminderIsoDuration, toIsoDuration, type FriendlyDurationUnit, type ReminderDurationUnit } from './utils/durations';
import {
  APP_NAME, APP_RELEASED_AT, APP_VERSION, applyPortableImport, backfillItemCreationVersions, buildPortableImportPreview,
  collectItemDependencies, collectScheduledEvents, compileQuery, compileSort, createId, createItem, createPortablePackage, buildRecurrenceRule,
  consolidateHabitOccurrences, evaluateFormulas, evaluateItemScripts, makeSeries, materializeProjectedOccurrence, migrateItem, migrateView, migrateWorkspace, moveCalendarItems,
  advanceCompletionAnchoredSeries, moveRecurringOccurrence, parseExpression, parsePortablePackage, parseSortSource, projectOccurrences, reconcileRecurrences,
  removeDuplicateReminders, resizeCalendarItem, restoreCalendarSchedules, runAutomationEvents, serializePortablePackage, serializeSortRules,
  createWorkspace, fromICS, packageToTabular, parseCsv, tabularToPackage, toCsv, toICS,
  validateViewCreationDefaults,
  type AutomationAction, type AutomationRule, type CustomFieldDefinition,
  type CalendarViewMode, type PortableImportPreview, type ProjectedOccurrence, type RecurrenceEditScope,
  type DomainEvent, type ItemPreset, type ItemScriptField, type PortableSelection, type SavedView, type Schedule, type UniversalItem, type ViewSortRule, type WorkspaceDocument, type WorkspaceLanguage,
  type ReconcileResult,
} from '@utm/core';
import {
  createLocalWorkspace, exportContainer, hasLocalWorkspace, importAsLocalWorkspace, lock,
  mergeIntoLocalWorkspace, restoreLocalWorkspace, saveLocalWorkspace, unlockLocalWorkspace, validateContainer,
  type UnlockedWorkspace,
} from '@utm/sdk';

type Page = 'home' | 'calendar' | 'all' | 'automations' | 'settings';
type Notice = { id: string; title: string; body: string; at: string; itemId?: string; reminderIds?: string[] };
const BUILD_COMMIT = (import.meta.env.VITE_COMMIT_SHA || 'local').slice(0, 7);

const DIAGNOSTICS_KEY = 'utm:diagnostics:v1';
type DiagnosticEntry = { at: string; kind: 'error' | 'unhandledrejection' | 'usage'; message: string; page?: string; details?: string };
const readDiagnostics = (): DiagnosticEntry[] => {
  try { const value = JSON.parse(localStorage.getItem(DIAGNOSTICS_KEY) ?? '[]'); return Array.isArray(value) ? value : []; } catch { return []; }
};
const recordDiagnostic = (entry: Omit<DiagnosticEntry, 'at'>) => {
  try {
    const next = [...readDiagnostics(), { ...entry, at: new Date().toISOString() }].slice(-200);
    localStorage.setItem(DIAGNOSTICS_KEY, JSON.stringify(next));
  } catch { /* diagnostics must never interfere with the app */ }
};

const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

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
// Some iOS Files providers do not implement File.text() reliably for unknown
// custom extensions. Reading bytes ourselves keeps .utmb and legacy .utm
// recovery working even when Files labels the document as an unknown type.
const readEncryptedBackup = async (file: File): Promise<string> => new TextDecoder().decode(await file.arrayBuffer());
const playTickSound = () => {
  try {
    const Audio = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Audio) return;
    const context = new Audio(); const oscillator = context.createOscillator(); const gain = context.createGain();
    oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(740, context.currentTime); oscillator.frequency.exponentialRampToValueAtTime(1040, context.currentTime + .07);
    gain.gain.setValueAtTime(.0001, context.currentTime); gain.gain.exponentialRampToValueAtTime(.12, context.currentTime + .008); gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .11);
    oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .12); oscillator.onended = () => void context.close();
  } catch { /* Sound is optional and must never block completing an item. */ }
};
type UiSoundKind = 'click' | 'confirm' | 'dismiss' | 'toggle' | 'expand' | 'reset';
const playUiSound = (kind: UiSoundKind) => {
  try {
    const Audio = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Audio) return;
    const context = new Audio(); const oscillator = context.createOscillator(); const gain = context.createGain();
    const [start, end, duration] = kind === 'confirm' ? [560, 760, .11] : kind === 'dismiss' ? [420, 300, .09] : kind === 'reset' ? [360, 220, .14] : kind === 'toggle' ? [620, 700, .07] : kind === 'expand' ? [480, 620, .08] : [500, 540, .045];
    oscillator.type = kind === 'click' || kind === 'toggle' ? 'sine' : 'triangle'; oscillator.frequency.setValueAtTime(start, context.currentTime); oscillator.frequency.exponentialRampToValueAtTime(end, context.currentTime + duration);
    gain.gain.setValueAtTime(.0001, context.currentTime); gain.gain.exponentialRampToValueAtTime(kind === 'click' ? .018 : .028, context.currentTime + .006); gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + duration);
    oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + duration + .01); oscillator.onended = () => void context.close();
  } catch { /* Interface sound is optional and must never block an action. */ }
};
const commaList = (value: string) => value.split(',').map((part) => part.trim()).filter(Boolean);
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

async function reconcileOffMainThread(workspace: WorkspaceDocument, now: Date): Promise<ReconcileResult> {
  if (typeof Worker === 'undefined') {
    return await Promise.race([
      Promise.resolve().then(() => reconcileRecurrences(clean(workspace), now)),
      new Promise<ReconcileResult>((_, reject) => window.setTimeout(() => reject(new Error('Recurrence reconciliation timed out')), 8_000)),
    ]);
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./recurrence.worker.ts', import.meta.url), { type: 'module' });
    const timeout = window.setTimeout(() => { worker.terminate(); reject(new Error('Recurrence worker timed out')); }, 8_000);
    worker.onmessage = (event: MessageEvent<{ ok: true; result: ReconcileResult } | { ok: false; error: string }>) => {
      window.clearTimeout(timeout); worker.terminate();
      if (event.data.ok) resolve(event.data.result); else reject(new Error(event.data.error));
    };
    worker.onerror = () => { window.clearTimeout(timeout); worker.terminate(); reject(new Error('Recurrence worker failed')); };
    worker.postMessage({ workspace: clean(workspace), now: now.toISOString() });
  });
}

function LockScreen({ exists, onReady }: { exists: boolean; onReady: (session: UnlockedWorkspace, language: WorkspaceLanguage) => Promise<void> }) {
  const [name, setName] = useState('My workspace');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<File | null>(null);
  const [language, setLanguage] = useState<WorkspaceLanguage>(() => {
    const saved = window.localStorage.getItem('utm-interface-language') as WorkspaceLanguage | null;
    if (saved && interfaceLanguages.some((option) => option.value === saved)) return saved;
    const browserLanguage = navigator.language.slice(0, 2) as WorkspaceLanguage;
    return interfaceLanguages.some((option) => option.value === browserLanguage) ? browserLanguage : 'en';
  });
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    window.localStorage.setItem('utm-interface-language', language);
    return installDomLocalization(language);
  }, [language]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (selectedBackup) { await importWorkspace(selectedBackup); return; }
    setError(''); setBusy(true);
    try {
      if (!exists && password !== confirm) throw new Error('Passwords do not match');
      await onReady(exists ? await unlockLocalWorkspace(password) : await createLocalWorkspace(password, name, language), language);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };

  const importWorkspace = async (file: File) => {
    if (password.length < 10) {
      setError('Enter the complete backup password, then tap Import selected backup.');
      return;
    }
    setBusy(true); setError('');
    try {
      await onReady(await importAsLocalWorkspace(await readEncryptedBackup(file), password), language);
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  return <main className="lock-shell">
    <section className="lock-card">
      <div className="brand-mark">U</div>
      <p className="eyebrow">UNIVERSAL TASK MANAGER</p>
      <span className="auth-beta" aria-label="Beta version">BETA</span>
      <h1>{exists ? 'Unlock your workspace' : 'Build your own system'}</h1>
      <p className="muted">Your data stays on this device, encrypted. There is no account and no password recovery. Please remember your password.</p>
      <label className="language-picker">Language<select value={language} onChange={(event) => setLanguage(event.target.value as WorkspaceLanguage)}>{interfaceLanguages.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <form onSubmit={submit}>
        {!exists && <label>{selectedBackup ? 'Backup file' : 'Workspace name'}<input value={selectedBackup ? selectedBackup.name : name} readOnly={Boolean(selectedBackup)} onChange={(event) => setName(event.target.value)} required /></label>}
        <label>{selectedBackup ? 'Backup password' : 'Password'}<input type="password" minLength={10} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={exists || selectedBackup ? 'current-password' : 'new-password'} required /></label>
        {!exists && !selectedBackup && <label>Confirm password<input type="password" minLength={10} value={confirm} onChange={(event) => setConfirm(event.target.value)} required /></label>}
        {error && <p className="error" role="alert">{error}</p>}
        {!selectedBackup && <button className="primary wide" disabled={busy}>{busy ? 'Working…' : exists ? 'Unlock' : 'Create encrypted workspace'}</button>}
        {selectedBackup && <button className="primary wide" type="button" disabled={busy || password.length < 10} onClick={() => void importWorkspace(selectedBackup)}>{busy ? 'Importing…' : 'Import selected backup'}</button>}
      </form>
      {!exists && <div className="import-lock">
        <span>Already have an encrypted workspace?</span>
        <button className="text-button" type="button" disabled={busy} onClick={() => fileRef.current?.click()}>Choose backup file</button>
        <input ref={fileRef} hidden type="file" accept=".utmb,.utm,application/octet-stream,text/plain" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; setSelectedBackup(file); setName(file.name); setConfirm(''); setError(''); }} />
        <small>Choose the file first, enter its password, then tap Import selected backup.</small>
      </div>}
      <details className="install-guide">
        <summary>Install on your phone</summary>
        <div>
          <p><strong>iPhone or iPad:</strong> open this page in Safari, tap Share, then choose <em>Add to Home Screen</em>.</p>
          <p><strong>Android:</strong> open it in Chrome, tap the menu, then choose <em>Install app</em> or <em>Add to Home screen</em>.</p>
          <p>Each device has its own encrypted workspace. Use an encrypted <code>.utmb</code> backup file to move or merge your data between devices.</p><p><strong>Important:</strong> if you remove Universal from the Home Screen, clear website data, or delete the browser profile, the local workspace may be lost. Export an encrypted <code>.utmb</code> backup regularly and keep it in Files, iCloud Drive, or another trusted cloud.</p>
          <hr />
        </div>
      </details>
      <p className="lock-version">v{APP_VERSION} · commit {BUILD_COMMIT}</p>
    </section>
  </main>;
}

const setDefaultPath = (target: Record<string, unknown>, path: string, value: unknown) => {
  const parts = path.split('.'); let cursor = target;
  for (const part of parts.slice(0, -1)) {
    const existing = cursor[part];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts.at(-1)!] = clean(value);
};
const applyViewCreationDefaults = (item: UniversalItem, view: SavedView): UniversalItem => {
  const defaults = view.creationDefaults ?? {};
  const next = clean(item) as unknown as Record<string, unknown>;
  for (const [path, value] of Object.entries(defaults)) setDefaultPath(next, path, value);
  const nextItem = next as unknown as UniversalItem;
  if (Object.keys(defaults).some((path) => path.startsWith('recurrence.'))) {
    nextItem.role = 'series_template';
    nextItem.recurrence = {
      rrule: 'FREQ=WEEKLY;INTERVAL=1', rdates: [], exdates: [], timezone: nextItem.schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      closeAt: 'next_activation', anchor: 'schedule', autoRenew: false, ...nextItem.recurrence,
    };
  }
  if (Object.keys(defaults).some((path) => path.startsWith('habit.'))) nextItem.habit = { target: 1, unit: 'times', streakMode: 'manual_only', ...nextItem.habit, completedDates: [] };
  if (Array.isArray(nextItem.reminders)) nextItem.reminders = nextItem.reminders.map((reminder) => { const { acknowledgedAt: _acknowledgedAt, ...freshReminder } = reminder; return { ...freshReminder, id: createId() }; });
  if (view.list) nextItem.list = view.list;
  nextItem.preset = inferredPreset(nextItem);
  return nextItem;
};
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

type CalendarPendingMove = { rows: ProjectedOccurrence[]; deltaMs: number };
function CalendarPage({ workspace, commit, onEditItem }: {
  workspace: WorkspaceDocument; commit: (message: string, mutation: (draft: WorkspaceDocument) => void) => void; onEditItem: (item: UniversalItem) => void;
}) {
  const preferences = workspace.calendarPreferences;
  const initialMode: CalendarViewMode = typeof window !== 'undefined' && window.innerWidth <= 620 && preferences.lastMode === 'month' ? 'day' : preferences.lastMode;
  const [mode, setMode] = useState<CalendarViewMode>(initialMode);
  const [range, setRange] = useState(() => ({ start: new Date(new Date().getFullYear(), new Date().getMonth(), 1), end: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 8) }));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [quickDraft, setQuickDraft] = useState<UniversalItem | null>(null);
  const [pendingMove, setPendingMove] = useState<CalendarPendingMove | null>(null);
  const [undoItems, setUndoItems] = useState<Record<string, UniversalItem> | null>(null);
  const [moveDialog, setMoveDialog] = useState(false);
  const [moveTarget, setMoveTarget] = useState('');
  const [unscheduledOpen, setUnscheduledOpen] = useState(false);
  const [calendarSettingsOpen, setCalendarSettingsOpen] = useState(false);
  const unscheduledRef = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<{ getApi: () => CalendarApi }>(null);

  const projected = useMemo(() => {
    const all = projectOccurrences(workspace, range.start, range.end);
    const predicate = preferences.selectedViewId ? (() => {
      const view = workspace.views[preferences.selectedViewId!];
      if (!view) return (_row: ProjectedOccurrence) => true;
      try {
        const compiled = compileQuery(view.query.source.trim() || 'true');
        return (row: ProjectedOccurrence) => {
          const source = workspace.items[row.materializedItemId ?? row.sourceItemId];
          if (!source) return false;
          const logical = row.virtual ? { ...clean(source), role: 'occurrence' as const, state: row.state, schedule: row.schedule } : source;
          try { return compiled(logical); } catch { return false; }
        };
      } catch { return (_row: ProjectedOccurrence) => false; }
    })() : (_row: ProjectedOccurrence) => true;
    return all.filter((row) => preferences.includeStates.includes(row.state) && predicate(row));
  }, [workspace, range.start, range.end, preferences.selectedViewId, preferences.includeStates]);
  const byId = useMemo(() => new Map(projected.map((row) => [row.id, row])), [projected]);
  const unscheduled = Object.values(workspace.items).filter((item) => !item.deletedAt && item.role !== 'series_template' && !item.schedule?.startAt && !item.schedule?.dueAt);

  useEffect(() => {
    const container = unscheduledRef.current; if (!container) return;
    const draggable = new Draggable(container, {
      itemSelector: '.unscheduled-item', longPressDelay: 420,
      eventData: (element) => ({ id: `external:${(element as HTMLElement).dataset.itemId}`, title: (element as HTMLElement).dataset.title, duration: '00:30' }),
    });
    return () => draggable.destroy();
  }, [unscheduled.map((item) => item.id).join('|')]);

  useEffect(() => {
    if (!undoItems) return; const timer = window.setTimeout(() => setUndoItems(null), 8_000); return () => window.clearTimeout(timer);
  }, [undoItems]);

  const setCalendarMode = (next: CalendarViewMode) => {
    setMode(next); calendarRef.current?.getApi().changeView(next === 'month' ? 'dayGridMonth' : next === 'week' ? 'timeGridWeek' : next === 'day' ? 'timeGridDay' : next === 'three_day' ? 'timeGridThreeDay' : 'listYear');
    commit('Save calendar mode', (draft) => { draft.calendarPreferences.lastMode = next; });
  };
  const saveUndoPoint = () => setUndoItems(clean(workspace.items));
  const applyMove = (rows: ProjectedOccurrence[], deltaMs: number, scope: RecurrenceEditScope) => {
    saveUndoPoint();
    commit(rows.length > 1 ? 'Move selected calendar items' : 'Move calendar item', (draft) => {
      const ordinaryIds: string[] = [];
      const movedSeries = new Set<string>();
      rows.forEach((row) => {
        if (row.seriesId) {
          if (scope === 'entire_series' && movedSeries.has(row.seriesId)) return;
          moveRecurringOccurrence(draft, row, deltaMs, scope); movedSeries.add(row.seriesId);
        } else ordinaryIds.push(materializeProjectedOccurrence(draft, row).id);
      });
      if (ordinaryIds.length) moveCalendarItems(draft, ordinaryIds, deltaMs);
    });
    setSelected(new Set()); setPendingMove(null);
  };
  const requestMove = (row: ProjectedOccurrence, deltaMs: number) => {
    const rows = selected.has(row.id) ? projected.filter((entry) => selected.has(entry.id)) : [row];
    if (rows.some((entry) => entry.seriesId)) setPendingMove({ rows, deltaMs });
    else applyMove(rows, deltaMs, 'this_occurrence');
  };
  const createDraftForRange = (start: Date, end: Date | null, allDay: boolean) => {
    const item = createUiItem('', 'task', start);
    item.schedule = { timezone: preferences.timezone, startAt: start.toISOString(), endAt: (end ?? new Date(start.getTime() + preferences.defaultDurationMinutes * 60_000)).toISOString(), ...(allDay ? { allDay: true } : {}) };
    setQuickDraft(item);
  };
  const patchQuickSchedule = (key: 'startAt' | 'endAt', value: string) => setQuickDraft((current) => {
    if (!current) return current;
    const schedule = { ...current.schedule! } as Record<string, unknown>; const converted = fromDateInput(value);
    if (converted) schedule[key] = converted; else delete schedule[key];
    return { ...current, schedule: schedule as unknown as Schedule };
  });
  const openProjected = (row: ProjectedOccurrence) => {
    let opened: UniversalItem | undefined;
    if (row.virtual) commit('Materialize calendar occurrence', (draft) => { opened = clean(materializeProjectedOccurrence(draft, row)); });
    else opened = workspace.items[row.materializedItemId ?? row.id];
    if (opened) onEditItem(clean(opened));
  };
  const events: EventInput[] = projected.map((row) => {
    const start = row.schedule.startAt ?? row.schedule.dueAt!;
    const defaultEnd = row.schedule.startAt ? new Date(new Date(start).getTime() + preferences.defaultDurationMinutes * 60_000).toISOString() : undefined;
    const end = row.schedule.endAt ?? defaultEnd;
    return {
      id: row.id, title: row.title || 'Untitled', start, ...(end ? { end } : {}), allDay: Boolean(row.schedule.allDay),
      editable: true, durationEditable: !row.dueOnly, class: [`calendar-state-${row.state}`, `calendar-priority-${row.priority ?? 0}`, row.schedule.startAt && !row.schedule.allDay ? 'calendar-time-event' : '', row.dueOnly ? 'calendar-due-only' : '', selected.has(row.id) ? 'calendar-selected' : ''].filter(Boolean).join(' '),
      extendedProps: { row },
    };
  });
  const handleEventClick = (info: EventClickInfo) => {
    const row = byId.get(info.event.id); if (!row) return;
    if (info.jsEvent.shiftKey) { setSelected((current) => { const next = new Set(current); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next; }); return; }
    openProjected(row);
  };
  const handleSelect = (info: DateSelectInfo) => {
    if (info.jsEvent?.shiftKey || info.jsEvent === null) {
      const start = info.start.getTime(); const end = info.end.getTime();
      setSelected(new Set(projected.filter((row) => { const value = new Date(row.schedule.startAt ?? row.schedule.dueAt!).getTime(); return value >= start && value < end; }).map((row) => row.id)));
      return;
    }
    createDraftForRange(info.start, info.end, info.allDay);
  };
  const handleDrop = (info: EventDropInfo) => {
    const row = byId.get(info.event.id); const start = info.event.start; if (!row || !start) { info.revert(); return; }
    const original = new Date(row.schedule.startAt ?? row.schedule.dueAt!).getTime(); const delta = start.getTime() - original;
    info.revert(); requestMove(row, delta);
  };
  const handleResize = (info: EventResizeDoneInfo) => {
    const row = byId.get(info.event.id); const start = info.event.start; const end = info.event.end; info.revert(); if (!row || !start || !end) return;
    saveUndoPoint();
    commit('Resize calendar item', (draft) => { const item = materializeProjectedOccurrence(draft, row); resizeCalendarItem(draft, item.id, end.toISOString(), new Date(), start.toISOString()); });
  };
  const handleExternal = (info: EventReceiveInfo) => {
    const itemId = info.event.id.replace(/^external:/, ''); const start = info.event.start; const end = info.event.end; const allDay = info.event.allDay; info.revert(); if (!start) return;
    saveUndoPoint();
    commit('Schedule unscheduled item', (draft) => { const item = draft.items[itemId]; if (!item) return; item.schedule = { timezone: preferences.timezone, startAt: start.toISOString(), endAt: (end ?? new Date(start.getTime() + preferences.defaultDurationMinutes * 60_000)).toISOString(), ...(allDay ? { allDay: true } : {}) }; item.updatedAt = new Date().toISOString(); item.revision += 1; });
    setUnscheduledOpen(false);
  };
  const selectedRows = projected.filter((row) => selected.has(row.id));
  const performKeyboardMove = () => {
    if (!selectedRows.length || !moveTarget) return;
    const earliest = Math.min(...selectedRows.map((row) => new Date(row.schedule.startAt ?? row.schedule.dueAt!).getTime()));
    const delta = new Date(moveTarget).getTime() - earliest;
    if (selectedRows.some((row) => row.seriesId)) setPendingMove({ rows: selectedRows, deltaMs: delta }); else applyMove(selectedRows, delta, 'this_occurrence');
    setMoveDialog(false);
  };

  return <section className="calendar-page page-section">
    <div className="calendar-title"><div><p className="eyebrow">TIME, WITHOUT SILOS</p><h1>Calendar</h1></div><div className="calendar-nav"><button onClick={() => setCalendarSettingsOpen(true)} aria-label="Calendar settings"><LineIcon name="settings"/></button><button onClick={() => calendarRef.current?.getApi().prev()} aria-label="Previous period">‹</button><button onClick={() => calendarRef.current?.getApi().today()}>Today</button><button onClick={() => calendarRef.current?.getApi().next()} aria-label="Next period">›</button></div></div>
    <div className="calendar-controls"><div className="calendar-modes">{(['month', ...(window.innerWidth <= 620 ? ['three_day'] : ['week']), 'day', 'agenda'] as CalendarViewMode[]).map((entry) => <button className={mode === entry ? 'active' : ''} key={entry} onClick={() => setCalendarMode(entry)}>{entry === 'three_day' ? '3 days' : entry}</button>)}</div><label>Saved view<select value={preferences.selectedViewId ?? ''} onChange={(event) => commit('Set calendar view filter', (draft) => { if (event.target.value) draft.calendarPreferences.selectedViewId = event.target.value; else delete draft.calendarPreferences.selectedViewId; })}><option value="">All active + completed</option>{Object.values(workspace.views).map((view) => <option value={view.id} key={view.id}>{view.name}</option>)}</select></label><button className="secondary unscheduled-toggle" onClick={() => setUnscheduledOpen(true)}>Unscheduled ({unscheduled.length})</button></div>
    <div className="calendar-state-filters">{(['open', 'done', 'auto_closed', 'cancelled', 'archived'] as const).map((state) => <label className="check" key={state}><input type="checkbox" checked={preferences.includeStates.includes(state)} onChange={() => commit('Change calendar state filters', (draft) => { const values = draft.calendarPreferences.includeStates; const index = values.indexOf(state); if (index >= 0) values.splice(index, 1); else values.push(state); })} />{stateNames[state]}</label>)}</div>
    {selected.size > 0 && <div className="selection-bar"><strong>{selected.size} selected</strong><button onClick={() => { const earliest = Math.min(...selectedRows.map((row) => new Date(row.schedule.startAt ?? row.schedule.dueAt!).getTime())); setMoveTarget(dateInput(new Date(earliest).toISOString())); setMoveDialog(true); }}>Move selected…</button><button onClick={() => setSelected(new Set())}>Clear</button></div>}
    <div className="calendar-layout"><div className="calendar-main-panel"><FullCalendar ref={calendarRef} plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]} initialView={mode === 'month' ? 'dayGridMonth' : mode === 'week' ? 'timeGridWeek' : mode === 'day' ? 'timeGridDay' : mode === 'three_day' ? 'timeGridThreeDay' : 'listYear'} views={{ timeGridThreeDay: { type: 'timeGrid', duration: { days: 3 } } }} headerToolbar={false} events={events} editable eventResizableFromStart selectable selectMirror droppable nowIndicator weekends={preferences.weekends} firstDay={preferences.weekStartsOn} slotMinTime="00:00:00" slotMaxTime="24:00:00" scrollTime={`${preferences.sleepSchedule.wake}:00`} scrollTimeReset={false} slotHeaderContent={(info) => info.isTime ? `${info.date.getHours()}:${String(info.date.getMinutes()).padStart(2, '0')}` : info.text} slotLaneClass={(info) => [info.isMajor ? 'calendar-hour-line' : 'calendar-half-hour-line', isSleepTime(info.date, preferences.sleepSchedule) ? 'calendar-sleep-slot' : ''].filter(Boolean).join(' ')} slotHeaderClass={(info) => info.isTime && isSleepTime(info.date, preferences.sleepSchedule) ? 'calendar-sleep-label' : ''} snapDuration={`00:${String(preferences.snapMinutes).padStart(2, '0')}:00`} slotDuration="00:30:00" longPressDelay={420} eventLongPressDelay={420} selectLongPressDelay={420} height="auto" datesSet={(info: DatesSetInfo) => setRange((current) => current.start.getTime() === info.start.getTime() && current.end.getTime() === info.end.getTime() ? current : { start: info.start, end: info.end })} dateClick={(info: DateClickInfo) => createDraftForRange(info.date, null, info.allDay)} select={handleSelect} eventClick={handleEventClick} eventDrop={handleDrop} eventResize={handleResize} eventReceive={handleExternal} eventContent={(info) => { const row = info.event.extendedProps.row as ProjectedOccurrence | undefined; return <span className="calendar-event-content"><i aria-hidden>{selected.has(info.event.id) ? '✓' : ''}</i><span>{info.event.title}</span>{row?.schedule.dueAt && !row.dueOnly && <b title="Has deadline">◆</b>}</span>; }} eventDidMount={(info) => { let timer = 0; info.el.addEventListener('touchstart', () => { timer = window.setTimeout(() => setSelected((current) => new Set(current).add(info.event.id)), 460); }, { passive: true }); info.el.addEventListener('touchend', () => window.clearTimeout(timer), { passive: true }); }} /></div>
      <aside ref={unscheduledRef} className={`unscheduled-panel ${unscheduledOpen ? 'open' : ''}`}><header><div><h2>Unscheduled</h2><p>Drag an item into the calendar.</p></div><button className="icon-button mobile-unscheduled-close" aria-label="Close unscheduled items" onClick={() => setUnscheduledOpen(false)}><CloseIcon /></button></header><div>{unscheduled.map((item) => <button className="unscheduled-item" data-item-id={item.id} data-title={item.title} key={item.id} onClick={() => onEditItem(item)}><span>{item.title}</span><small>{inferredPreset(item)}</small></button>)}{!unscheduled.length && <p className="empty">Everything has a date.</p>}</div></aside>
    </div>
    {quickDraft && <div className="modal-backdrop"><section className="dialog quick-event"><header><h2>New calendar item</h2><button className="icon-button" aria-label="Close quick create" onClick={() => setQuickDraft(null)}><CloseIcon /></button></header><label>Title<input autoFocus value={quickDraft.title} onChange={(event) => setQuickDraft({ ...quickDraft, title: event.target.value })} /></label><div className="form-grid two"><label>Start<input type="datetime-local" value={dateInput(quickDraft.schedule?.startAt)} onChange={(event) => setQuickDraft({ ...quickDraft, schedule: { ...quickDraft.schedule!, startAt: fromDateInput(event.target.value) } })} /></label><label>End<input type="datetime-local" value={dateInput(quickDraft.schedule?.endAt)} onChange={(event) => setQuickDraft({ ...quickDraft, schedule: { ...quickDraft.schedule!, endAt: fromDateInput(event.target.value) } })} /></label></div><label>Priority<select value={quickDraft.priority ?? 0} onChange={(event) => setQuickDraft({ ...quickDraft, priority: Number(event.target.value) as NonNullable<UniversalItem['priority']> })}>{[0,1,2,3,4].map((value) => <option value={value} key={value}>{value === 0 ? 'None' : priorityNames[value as 1|2|3|4]}</option>)}</select></label><footer><button className="secondary" onClick={() => { onEditItem(quickDraft); setQuickDraft(null); }}>More options</button><span/><button className="primary" disabled={!quickDraft.title.trim()} onClick={() => { commit('Create calendar item', (draft) => { draft.items[quickDraft.id] = clean({ ...quickDraft, title: quickDraft.title.trim() }); }); setQuickDraft(null); }}>Save</button></footer></section></div>}
    {pendingMove && <div className="modal-backdrop"><section className="dialog"><header><h2>Move repeating item</h2><button className="icon-button" aria-label="Cancel recurring move" onClick={() => setPendingMove(null)}><CloseIcon /></button></header><p>{pendingMove.rows.length > 1 ? 'Choose one scope for the selected recurring items. You can move individual rows separately afterwards.' : 'Which part of the series should move?'}</p><div className="scope-actions"><button onClick={() => applyMove(pendingMove.rows, pendingMove.deltaMs, 'this_occurrence')}>This occurrence</button><button onClick={() => applyMove(pendingMove.rows, pendingMove.deltaMs, 'this_and_future')}>This and future</button><button onClick={() => applyMove(pendingMove.rows, pendingMove.deltaMs, 'entire_series')}>Entire series</button></div></section></div>}
    {moveDialog && <div className="modal-backdrop"><section className="dialog"><header><h2>Move selected items</h2><button className="icon-button" aria-label="Close move dialog" onClick={() => setMoveDialog(false)}><CloseIcon /></button></header><p>Set the new date and time for the earliest selected item. Every selected item keeps the same relative distance.</p><label>New start<input type="datetime-local" value={moveTarget} onChange={(event) => setMoveTarget(event.target.value)} /></label><footer><button className="secondary" onClick={() => setMoveDialog(false)}>Cancel</button><span/><button className="primary" onClick={performKeyboardMove}>Move group</button></footer></section></div>}
    {undoItems && <div className="calendar-undo" role="status"><span>Calendar change saved</span><button onClick={() => { commit('Undo calendar operation', (draft) => { draft.items = clean(undoItems); }); setUndoItems(null); }}>Undo</button></div>}
    {calendarSettingsOpen && <div className="modal-backdrop"><section className="dialog"><header><h2>Calendar settings</h2><button className="icon-button" aria-label="Close calendar settings" onClick={() => setCalendarSettingsOpen(false)}><CloseIcon /></button></header><label>Timezone<input value={preferences.timezone} onChange={(event) => commit('Change calendar timezone', (draft) => { draft.calendarPreferences.timezone = event.target.value; })} /></label><div className="form-grid two"><label>Wake time<input type="time" value={preferences.sleepSchedule.wake} onChange={(event) => commit('Change wake time', (draft) => { draft.calendarPreferences.sleepSchedule.wake = event.target.value; })} /></label><label>Sleep time<input type="time" value={preferences.sleepSchedule.sleep} onChange={(event) => commit('Change sleep time', (draft) => { draft.calendarPreferences.sleepSchedule.sleep = event.target.value; })} /></label><label>Snap minutes<input type="number" min="5" step="5" value={preferences.snapMinutes} onChange={(event) => commit('Change calendar snap', (draft) => { draft.calendarPreferences.snapMinutes = Math.max(5, Number(event.target.value) || 15); })} /></label><label>Default duration<input type="number" min="5" step="5" value={preferences.defaultDurationMinutes} onChange={(event) => commit('Change default duration', (draft) => { draft.calendarPreferences.defaultDurationMinutes = Math.max(5, Number(event.target.value) || 30); })} /></label></div><p className="hint">The full 24-hour day stays available. Time between Sleep and Wake is shaded in the calendar.</p><label className="check"><input type="checkbox" checked={preferences.weekends} onChange={(event) => commit('Toggle calendar weekends', (draft) => { draft.calendarPreferences.weekends = event.target.checked; })} /> Show weekends</label><label>Week starts<select value={preferences.weekStartsOn} onChange={(event) => commit('Change first weekday', (draft) => { draft.calendarPreferences.weekStartsOn = Number(event.target.value) as 0 | 1; })}><option value="1">Monday</option><option value="0">Sunday</option></select></label></section></div>}
  </section>;
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

function SettingsPage({ workspace, commit, onNotify, onTransfer, onImportFile, onEnableBackground, onDisableBackground, onBackgroundContent }: {
  workspace: WorkspaceDocument; commit: (message: string, mutation: (draft: WorkspaceDocument) => void) => void;
  onNotify: () => void; onTransfer: () => void; onImportFile: (file: File) => void;
  onEnableBackground: () => void; onDisableBackground: () => void;
  onBackgroundContent: (contentMode: WorkspaceDocument['pushPreferences']['contentMode']) => void;
}) {
  const [field, setField] = useState<CustomFieldDefinition | null>(null);
  const jsonInput = useRef<HTMLInputElement>(null);
  const exportAll = (format: PortableFormat, metadata = false) => {
    const items = Object.values(workspace.items).filter((item) => !item.deletedAt);
    exportPortable(workspace, createPortablePackage(workspace, { kind: 'items', items, views: format === 'xlsx' ? Object.values(workspace.views) : [], selection: { type: 'all_items' } }), `${safeFilename(workspace.name)}-all-items`, format, metadata);
  };
  const testClock = workspace.calendarPreferences.testClock ?? { enabled: false, secondsPerDay: 86_400, startedAt: new Date().toISOString(), virtualAt: new Date().toISOString() };
  return <section className="page-section"><div className="page-title"><div><h1>Settings</h1></div></div>
    <section className="settings-card"><p className="eyebrow">APPEARANCE</p><h2>Theme</h2><p>Choose a light, dark or system theme. Scheduled mode switches automatically using the times below.</p><label>Theme<select value={workspace.calendarPreferences.appearance.mode} onChange={(event) => commit('Change theme mode', (draft) => { draft.calendarPreferences.appearance.mode = event.target.value as WorkspaceDocument['calendarPreferences']['appearance']['mode']; })}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option><option value="scheduled">Scheduled</option></select></label>{workspace.calendarPreferences.appearance.mode === 'scheduled' && <div className="form-grid two"><label>Light theme starts<input type="time" value={workspace.calendarPreferences.appearance.lightAt} onChange={(event) => commit('Change light theme schedule', (draft) => { draft.calendarPreferences.appearance.lightAt = event.target.value; })} /></label><label>Dark theme starts<input type="time" value={workspace.calendarPreferences.appearance.darkAt} onChange={(event) => commit('Change dark theme schedule', (draft) => { draft.calendarPreferences.appearance.darkAt = event.target.value; })} /></label></div>}<hr/><p className="eyebrow">SOUND</p><h2>Interface sounds</h2><label className="check"><input type="checkbox" checked={workspace.calendarPreferences.appearance.uiSound} onChange={(event) => commit('Toggle interface sounds', (draft) => { draft.calendarPreferences.appearance.uiSound = event.target.checked; })} />Play calm sounds for buttons and controls</label><h2>Completion sound</h2><label className="check"><input type="checkbox" checked={workspace.calendarPreferences.appearance.tickSound} onChange={(event) => commit('Toggle completion sound', (draft) => { draft.calendarPreferences.appearance.tickSound = event.target.checked; })} />Play a short sound when an item is completed</label></section>
    <div className="settings-columns"><section className="settings-card"><header><div><p className="eyebrow">DATA MODEL</p><h2>Custom fields</h2></div><button className="secondary" onClick={() => setField({ id: createId(), key: '', label: '', kind: 'text', required: false })}>+ Add</button></header>{Object.values(workspace.customFields).map((entry) => <button className="setting-row" key={entry.id} onClick={() => setField(clean(entry))}><span><strong>{entry.label}</strong><small>custom.{entry.key}</small></span><span>{entry.kind}</span></button>)}{!Object.keys(workspace.customFields).length && <p className="empty">No custom fields yet.</p>}<hr/><p className="eyebrow">TESTING</p><h2>Accelerated day</h2><p>Optional local test clock. When enabled, one simulated day passes in the selected number of real seconds. It affects recurrence and active-range checks only on this device.</p><label className="check"><input type="checkbox" checked={testClock.enabled} onChange={(event) => commit('Toggle accelerated test clock', (draft) => { const now = new Date().toISOString(); draft.calendarPreferences.testClock = { ...testClock, enabled: event.target.checked, startedAt: now, virtualAt: now }; })} /> Enable accelerated test clock</label>{testClock.enabled && <label>Seconds per simulated day<input type="number" min="1" step="1" value={testClock.secondsPerDay} onChange={(event) => commit('Change accelerated day length', (draft) => { const current = draft.calendarPreferences.testClock ?? testClock; draft.calendarPreferences.testClock = { ...current, secondsPerDay: Math.max(1, Number(event.target.value) || 1), startedAt: new Date().toISOString(), virtualAt: new Date().toISOString() }; })} /></label>}<p className="hint">Example: 30 seconds = one simulated day. Turn it off after testing to return to real time.</p></section>
    <section className="settings-card"><p className="eyebrow">INTERFACE</p><h2>Interface language</h2><p>Choose the language used by the app on this device. Item titles and your data are never translated.</p><label>Language<select value={workspace.calendarPreferences.language} onChange={(event) => commit('Change interface language', (draft) => { draft.calendarPreferences.language = event.target.value as WorkspaceDocument['calendarPreferences']['language']; })}>{interfaceLanguages.map((language) => <option value={language.value} key={language.value}>{language.label}</option>)}</select></label><hr/><p className="eyebrow">PORTABILITY</p><h2>Move your data</h2><p>Encrypted Transfer is safe for complete workspace merge. Readable exports use the same preview, add and copy rules on import.</p><div className="settings-actions"><button className="secondary" onClick={onTransfer}><LineIcon name="transfer"/> Encrypted Transfer</button><details className="inline-menu"><summary>Export all…</summary><div><button onClick={() => exportAll('json')}>JSON</button><button onClick={() => exportAll('csv')}>CSV</button><button onClick={() => exportAll('xlsx')}>Excel</button><button onClick={() => exportAll('ics')}>iCalendar</button><button onClick={() => exportAll('ics', true)}>iCalendar + UTM metadata</button></div></details><button className="secondary" onClick={() => jsonInput.current?.click()}>Import data…</button><input ref={jsonInput} hidden type="file" accept=".json,.csv,.xlsx,.ics,application/json,text/csv,text/calendar,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImportFile(file); event.currentTarget.value = ''; }} /></div><hr/><p className="eyebrow">DEVICE</p><h2>Notifications</h2><p>Local reminders appear while the app is open. Background delivery uses optional Web Push and the free Cloudflare plan checks due jobs every 15 minutes.</p><button className="secondary" onClick={onNotify}>Allow local notifications</button><div className="background-push"><div><strong>Background notifications</strong><small>{workspace.pushPreferences.enabled ? 'Enabled for this encrypted workspace copy.' : 'Off — reminders stay only on this device while the app is open.'}</small></div>{workspace.pushPreferences.enabled ? <button className="secondary" onClick={onDisableBackground}>Disable</button> : <button className="secondary" onClick={onEnableBackground}>Enable background delivery</button>}</div>{workspace.pushPreferences.enabled && <label className="push-privacy">Lock-screen content<select value={workspace.pushPreferences.contentMode} onChange={(event) => onBackgroundContent(event.target.value as WorkspaceDocument['pushPreferences']['contentMode'])}><option value="generic">Generic — no task title leaves this device</option><option value="detailed">Show task title and urgency</option></select></label>}<p className="hint">For iPhone, install Universal to the Home Screen, then enable this from the installed app. The Worker never receives your password or encrypted database.</p><details className="notification-help"><summary>iPhone background notification instructions</summary><div><p>First add Universal to the Home Screen and open it from there. Tap <em>Allow local notifications</em> if iOS has not granted permission yet. Then tap <em>Enable background delivery</em> and enter the notification access code supplied by the workspace owner. This is optional; without it, reminders remain local to the device.</p><p>Background delivery is checked about every 15 minutes on the free service, so it is not an exact alarm. GitHub only hosts the app files; it does not receive your workspace or notification list. When detailed lock-screen content is selected, the push service temporarily receives the task title, Start, Deadline and reminder urgency needed to send the notification.</p></div></details><hr/><p className="eyebrow">LOCAL WORKSPACE</p><h2>Workspace storage</h2><p>Your workspace is encrypted and stored in this browser's private app storage (IndexedDB). iPhone does not expose a normal folder path for site data.</p><dl><div><dt>Storage</dt><dd>Encrypted local browser storage</dd></div><div><dt>Workspace ID</dt><dd className="mono">{workspace.workspaceId}</dd></div><div><dt>Portable backup</dt><dd>Encrypted <code>.utmb</code> file</dd></div></dl><p className="hint">Use Encrypted Transfer above to save a <code>.utmb</code> backup in Files, iCloud Drive or another cloud. Legacy <code>.utm</code> files are still accepted. The app validates the encrypted contents instead of trusting the filename.</p><div className="backup-notice"><strong>Backups are manual in this web app</strong><span>Browsers and iOS do not allow a PWA to silently write encrypted backups into a user-selected folder. Choose a folder in Files when exporting, then replace the previous backup there.</span></div><p className="hint">This release supports one local workspace owner. Separate user accounts and permissions are not enabled yet; adding names here would not create real security boundaries.</p><hr/><p className="eyebrow">APPLICATION</p><h2>{APP_NAME}</h2><dl><div><dt>Version</dt><dd>v{APP_VERSION}</dd></div><div><dt>Released</dt><dd><time dateTime={APP_RELEASED_AT}>{formatRussianDateTime(APP_RELEASED_AT)}</time></dd></div></dl><hr/><p className="eyebrow">WORKSPACE</p><h2>{workspace.name}</h2><dl><div><dt>Schema</dt><dd>{workspace.schemaVersion}</dd></div><div><dt>Items</dt><dd>{Object.keys(workspace.items).length}</dd></div><div><dt>Workspace ID</dt><dd className="mono">{workspace.workspaceId}</dd></div></dl></section></div>
    {field && <div className="modal-backdrop"><section className="dialog"><header><h2>Custom field</h2><button className="icon-button" onClick={() => setField(null)}>×</button></header><label>Label<input value={field.label} onChange={(event) => setField({ ...field, label: event.target.value, key: field.key || event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_') })} /></label><label>Key<input value={field.key} pattern="[a-z][a-z0-9_]*" onChange={(event) => setField({ ...field, key: event.target.value })} /></label><label>Type<select value={field.kind} onChange={(event) => setField({ ...field, kind: event.target.value as CustomFieldDefinition['kind'] })}>{['text', 'number', 'boolean', 'date', 'datetime', 'duration', 'enum', 'multi_enum', 'url', 'item_ref', 'formula'].map((kind) => <option key={kind}>{kind}</option>)}</select></label>{field.kind === 'formula' && <label>Formula DSL<input value={field.formula ?? ''} onChange={(event) => setField({ ...field, formula: event.target.value })} placeholder="custom.rate * custom.hours" /></label>}<footer><button className="danger" onClick={() => { commit('Delete custom field', (draft) => { delete draft.customFields[field.id]; }); setField(null); }}>Delete</button><span/><button className="primary" disabled={!field.label || !/^[a-z][a-z0-9_]*$/.test(field.key)} onClick={() => { if (field.formula) parseExpression(field.formula); commit('Save custom field', (draft) => { draft.customFields[field.id] = clean(field); }); setField(null); }}>Save field</button></footer></section></div>}
  </section>;
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
      const content = await exportContainer(session.document, password);
      const verification = await validateContainer(content, password);
      if (verification.workspaceId !== session.document.workspaceId) throw new Error('Backup verification returned a different workspace');
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
  return <div className="modal-backdrop"><section className="dialog"><header><h2>Encrypted backup & transfer</h2><button className="icon-button" onClick={onClose}>×</button></header><p>Every exported file is encrypted. Merge copies of the same workspace; restore a backup when setting up a new device. Older <code>.utm</code> files remain supported.</p><label>Workspace password<input type="password" minLength={10} value={password} onChange={(event) => { setPassword(event.target.value); setRestoreSource(null); }} /></label>{error && <p className="error">{error}</p>}<div className="transfer-actions"><button className="primary" disabled={password.length < 10 || busy} onClick={() => void download()}>Export encrypted .utmb</button><button className="secondary" disabled={password.length < 10 || busy} onClick={() => input.current?.click()}>{restoreSource ? 'Choose another backup' : 'Merge from backup'}</button><input ref={input} hidden type="file" accept=".utmb,.utm,application/octet-stream,text/plain" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); }} /></div>{restoreSource && <div className="restore-warning"><strong>Replace this device?</strong><p>This removes the current local workspace from this browser and restores the selected encrypted backup. The backup itself is not changed.</p><button className="danger" disabled={busy} onClick={() => void replaceFromBackup()}>Replace local workspace from backup</button></div>}<p className="hint">On iPhone, choose any backup file in Files. Its extension does not need to be recognized by iOS. Wrong passwords, unrelated files and modified containers are rejected before your local workspace changes.</p></section></div>;
}

export default function App() {
  const [boot, setBoot] = useState<'checking' | 'empty' | 'locked' | 'ready'>('checking');
  const [session, setSession] = useState<UnlockedWorkspace | null>(null);
  const [page, setPage] = useState<Page>('home');
  const [editor, setEditor] = useState<UniversalItem | null>(null);
  const [editorIsNew, setEditorIsNew] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [popupNoticeIds, setPopupNoticeIds] = useState<string[]>([]);
  const [noticeCenterOpen, setNoticeCenterOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [newViewRequest, setNewViewRequest] = useState(0);
  const [toast, setToast] = useState('');
  const [backupReminder, setBackupReminder] = useState(false);
  const [quick, setQuick] = useState('');
  const [celebratingIds, setCelebratingIds] = useState<Set<string>>(new Set());
  const [portableImportSource, setPortableImportSource] = useState<string | null>(null);
  const [clockTick, refreshClock] = useState(() => Date.now());
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const seenNoticeIds = useRef(new Set<string>());
  const noticeTimers = useRef(new Map<string, number>());
  const pushError = useRef('');
  const captureInputRef = useRef<HTMLInputElement>(null);
  const workspace = session?.document as WorkspaceDocument | undefined;
  const [diagnosticCount, setDiagnosticCount] = useState(() => readDiagnostics().length);

  useEffect(() => { void hasLocalWorkspace().then((exists) => setBoot(exists ? 'locked' : 'empty')); }, []);
  useEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
  }, []);
  useEffect(() => {
    if (boot !== 'ready') return;
    const resetInitialScroll = () => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };
    resetInitialScroll();
    const frame = window.requestAnimationFrame(resetInitialScroll);
    const timer = window.setTimeout(resetInitialScroll, 120);
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(timer); };
  }, [boot]);
  useEffect(() => {
    const capture = (kind: DiagnosticEntry['kind'], message: string, details?: string) => { recordDiagnostic({ kind, message, page, ...(details ? { details } : {}) }); setDiagnosticCount(readDiagnostics().length); };
    const onError = (event: ErrorEvent) => capture('error', event.message || 'Unknown error', event.error?.stack);
    const onRejection = (event: PromiseRejectionEvent) => capture('unhandledrejection', event.reason instanceof Error ? event.reason.message : String(event.reason));
    window.addEventListener('error', onError); window.addEventListener('unhandledrejection', onRejection);
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); };
  }, [page]);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const updateKeyboardOffset = () => {
      const captureFocused = document.activeElement === captureInputRef.current;
      const keyboardHeight = captureFocused ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
      document.documentElement.style.setProperty('--keyboard-offset', `${keyboardHeight}px`);
      document.documentElement.classList.toggle('capture-keyboard-open', captureFocused && keyboardHeight > 80);
    };
    const releasePage = () => {
      document.documentElement.classList.remove('capture-keyboard-open');
      document.documentElement.style.setProperty('--keyboard-offset', '0px');
    };
    const onFocusIn = (event: FocusEvent) => {
      if (event.target === captureInputRef.current) window.requestAnimationFrame(updateKeyboardOffset);
    };
    const onFocusOut = (event: FocusEvent) => {
      if (event.target === captureInputRef.current) releasePage();
    };
    // The quick-capture input mounts only after the workspace is unlocked.
    // Listen on the document so this remains reliable across lock/unlock and page changes.
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    updateKeyboardOffset();
    viewport.addEventListener('resize', updateKeyboardOffset);
    viewport.addEventListener('scroll', updateKeyboardOffset);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      viewport.removeEventListener('resize', updateKeyboardOffset);
      viewport.removeEventListener('scroll', updateKeyboardOffset);
      releasePage();
      document.documentElement.style.removeProperty('--keyboard-offset');
    };
  }, []);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 3500); return () => window.clearTimeout(timer); }, [toast]);
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
  useEffect(() => () => { noticeTimers.current.forEach((timer) => window.clearTimeout(timer)); }, []);

  const activate = async (unlocked: UnlockedWorkspace, selectedLanguage?: WorkspaceLanguage) => {
    let notifications: Array<{ title: string; body: string; itemId?: string; reminderIds?: string[] }> = [];
    const now = effectiveWorkspaceNow(unlocked.document as WorkspaceDocument);
    const migration = migrateWorkspace(clean(unlocked.document as WorkspaceDocument));
    const migratedDocument = Automerge.change(unlocked.document, 'Migrate workspace metadata and reminders', (draft) => {
      const workspace = draft as unknown as WorkspaceDocument;
      if (workspace.schemaVersion !== migration.value.schemaVersion || !workspace.calendarPreferences?.language) {
        const target = workspace as unknown as Record<string, unknown>;
        Object.keys(target).forEach((key) => { delete target[key]; });
        Object.entries(migration.value as unknown as Record<string, unknown>).forEach(([key, value]) => { target[key] = clean(value); });
      }
      // Choosing a language on the unlock screen is an explicit user preference;
      // persist it in the encrypted workspace so it travels with transfers.
      if (selectedLanguage) workspace.calendarPreferences.language = selectedLanguage;
      backfillItemCreationVersions(workspace);
      Object.values(workspace.items).forEach(removeDuplicateReminders);
      consolidateHabitOccurrences(workspace, now);
    });
    let reconciliation: ReconcileResult;
    let reconciliationWarning = '';
    try { reconciliation = await reconcileOffMainThread(migratedDocument as WorkspaceDocument, now); }
    catch (reason) {
      // Never make an encrypted workspace inaccessible because one malformed
      // or very large recurring series cannot be reconciled during unlock.
      // The normal foreground reconciler will retry after the workspace opens.
      reconciliation = { created: [], updated: [], autoClosed: [], removedIds: [], untouched: 0 };
      reconciliationWarning = reason instanceof Error ? reason.message : String(reason);
    }
    const updated = Automerge.change(migratedDocument, 'Unlock reconciliation', (draft) => {
      const workspace = draft as unknown as WorkspaceDocument;
      reconciliation.created.forEach((item) => { if (!workspace.items[item.id]) workspace.items[item.id] = clean(item); });
      reconciliation.updated.forEach((item) => { workspace.items[item.id] = clean(item); });
      reconciliation.autoClosed.forEach((item) => { workspace.items[item.id] = clean(item); });
      reconciliation.removedIds.forEach((id) => { workspace.tombstones[id] = now.toISOString(); delete workspace.items[id]; });
      const events: DomainEvent[] = reconciliation.created.map((item) => ({ id: createId(), type: 'occurrence.activated', at: now.toISOString(), itemId: item.id, after: clean(item), causationId: createId(), depth: 0 }));
      events.push(...collectScheduledEvents(workspace, now));
      notifications = runAutomationEvents(workspace, events, { now }).notifications;
    });
    const reminderGroups = new Map<string, { count: number; urgency: 'normal' | 'urgent' | 'critical'; reminderIds: string[] }>();
    const urgencyRank = { normal: 0, urgent: 1, critical: 2 } as const;
    for (const item of Object.values(updated.items)) {
      if (item.state !== 'open' || item.role === 'series_template') continue;
      if (item.schedule?.availableFrom && new Date(item.schedule.availableFrom) > now) continue;
      for (const reminder of item.reminders) {
        if (!reminder.acknowledgedAt && reminder.at && new Date(reminder.at) <= now) {
          const group = reminderGroups.get(item.id);
          if (!group) reminderGroups.set(item.id, { count: 1, urgency: reminder.urgency, reminderIds: [reminder.id] });
          else { group.count += 1; group.reminderIds.push(reminder.id); if (urgencyRank[reminder.urgency] > urgencyRank[group.urgency]) group.urgency = reminder.urgency; }
        }
      }
    }
    reminderGroups.forEach((group, itemId) => { const item = updated.items[itemId]; if (item) notifications.push({ title: item.title, body: `Reminder${group.count > 1 ? `s · ${group.count}` : ''} · ${group.urgency}`, itemId, reminderIds: group.reminderIds }); });
    await saveLocalWorkspace(updated, unlocked.dataKey);
    setSession({ ...unlocked, document: updated }); setBoot('ready');
    // A slow recurrence worker must never block or visually alarm the user on
    // unlock. The workspace is already open; the next lifecycle pass retries
    // reconciliation in the background. Keep unexpected errors visible, but
    // treat the normal mobile timeout as a quiet retry condition.
    if (reconciliationWarning && !/timed out/i.test(reconciliationWarning)) setToast(`Workspace opened. Recurrence sync will retry in the background (${reconciliationWarning}).`);
    setNotices(notifications.map((notice) => ({ id: createId(), title: notice.title, body: notice.body, at: now.toISOString(), ...(notice.itemId ? { itemId: notice.itemId } : {}), ...(notice.reminderIds?.length ? { reminderIds: notice.reminderIds } : {}) })));
    if (Notification.permission === 'granted') notifications.forEach((notice) => new Notification(notice.title, { body: notice.body, ...(notice.itemId ? { tag: `reminder:${notice.itemId}` } : {}) }));
  };

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
    const appearance = workspace?.calendarPreferences.appearance;
    const apply = () => {
      const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const mode = appearance?.mode ?? 'system';
      const theme = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode === 'scheduled' ? scheduledTheme(appearance?.lightAt ?? '07:00', appearance?.darkAt ?? '19:00') : mode;
      document.documentElement.dataset.theme = theme;
    };
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    apply(); media.addEventListener('change', apply);
    const timer = window.setInterval(apply, 30_000);
    return () => { media.removeEventListener('change', apply); window.clearInterval(timer); };
  }, [workspace?.calendarPreferences.appearance.mode, workspace?.calendarPreferences.appearance.lightAt, workspace?.calendarPreferences.appearance.darkAt, boot]);
  useEffect(() => {
    if (!workspace?.calendarPreferences.appearance.uiSound) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      const control = target?.closest('button,summary,select,input[type="checkbox"],input[type="radio"],[role="button"]') as HTMLElement | null;
      if (!control || (control as HTMLButtonElement).disabled || control.dataset.sound === 'none') return;
      const label = `${control.getAttribute('aria-label') ?? ''} ${control.textContent ?? ''}`.toLowerCase();
      const kind: UiSoundKind = /reset/.test(label) ? 'reset' : /delete|remove|cancel|close|dismiss|clear|lock/.test(label) ? 'dismiss' : /details|expand|collapse|section|recurrence/.test(label) ? 'expand' : /checkbox|toggle|sound|theme|language|select/.test(label) ? 'toggle' : /save|apply|add|create|enable|import|restore|backup|complete/.test(label) ? 'confirm' : 'click';
      playUiSound(kind);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [workspace?.calendarPreferences.appearance.uiSound]);
  useEffect(() => {
    const itemId = new URLSearchParams(window.location.search).get('item');
    if (!itemId || !workspace?.items[itemId]) return;
    setEditor(itemEditorSource(workspace, workspace.items[itemId]!));
    window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash}`);
  }, [workspace]);
  const commit = (message: string, mutation: (draft: WorkspaceDocument) => void): boolean => {
    if (!session) return false;
    const previous = session;
    let document: Automerge.Doc<WorkspaceDocument>;
    try {
      document = Automerge.change(session.document, message, (draft) => { mutation(draft as unknown as WorkspaceDocument); draft.updatedAt = new Date().toISOString(); });
    } catch (reason) {
      setToast(`Save failed; nothing was changed: ${reason instanceof Error ? reason.message : String(reason)}`);
      return false;
    }
    const next = { ...session, document };
    setSession(next);
    saveQueue.current = saveQueue.current.then(() => saveLocalWorkspace(document, session.dataKey)).catch((reason) => {
      setSession((current) => current?.document === document ? previous : current);
      setToast(`Save failed; the change was reverted: ${String(reason)}`);
    });
    return true;
  };

  // The accelerated test clock must reconcile while the app is open, not only
  // when the workspace is unlocked. This makes short test days (for example,
  // 30 seconds) exercise active ranges and recurrence just like real time.
  useEffect(() => {
    if (!workspace?.calendarPreferences.testClock?.enabled) return;
    let cancelled = false;
    const reconcile = () => {
      if (cancelled || !workspace) return;
      const now = effectiveWorkspaceNow(workspace);
      const result = reconcileRecurrences(clean(workspace), now);
      if (!result.created.length && !result.updated.length && !result.autoClosed.length && !result.removedIds.length) return;
      commit('Accelerated clock reconciliation', (draft) => {
        result.created.forEach((item) => { if (!draft.items[item.id]) draft.items[item.id] = clean(item); });
        [...result.updated, ...result.autoClosed].forEach((item) => { draft.items[item.id] = clean(item); });
        result.removedIds.forEach((id) => { draft.tombstones[id] = now.toISOString(); delete draft.items[id]; });
      });
    };
    const timer = window.setInterval(reconcile, 1_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [workspace?.calendarPreferences.testClock?.enabled, workspace?.updatedAt]);

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

  const changeItemState = (item: UniversalItem, state: UniversalItem['state']) => {
    if (state === 'done' && workspace?.calendarPreferences.appearance.tickSound) playTickSound();
    if (state === 'done') {
      setRecentlyDone(item.id, Date.now() + 10_000);
      setCelebratingIds((current) => new Set(current).add(item.id));
      window.setTimeout(() => setCelebratingIds((current) => { const next = new Set(current); next.delete(item.id); return next; }), 900);
    }
    else setRecentlyDone(item.id);
    commit('Change item state', (draft) => {
      let target = draft.items[item.id]; if (!target) return;
      if (item.habit || (item.occurrence?.seriesId && draft.items[item.occurrence.seriesId]?.habit)) {
        if (item.occurrence?.seriesId && draft.items[item.occurrence.seriesId]) target = draft.items[item.occurrence.seriesId]!;
        target.habit ??= { target: 1, unit: 'times', streakMode: 'manual_only', completedDates: [] };
        target.habit.completedDates ??= [];
        const date = (item.occurrence?.recurrenceId ?? new Date().toISOString()).slice(0, 10);
        if (state === 'done' && !target.habit.completedDates.includes(date)) target.habit.completedDates.push(date);
        if (state === 'open') {
          const index = target.habit.completedDates.indexOf(date);
          if (index >= 0) target.habit.completedDates.splice(index, 1);
        }
        target.state = 'open'; delete target.closure;
        target.updatedAt = new Date().toISOString(); target.revision += 1;
        return;
      }
      target.state = state; target.updatedAt = new Date().toISOString(); target.revision += 1;
      if (state === 'open') delete target.closure;
      else target.closure = { at: target.updatedAt, actor: 'user', reason: state === 'cancelled' ? 'cancelled' : 'manual' };
      if ((state === 'done' || state === 'cancelled') && target.occurrence && target.closure) advanceCompletionAnchoredSeries(draft, target, target.closure.at);
      const event = { id: createId(), type: 'status.changed' as const, at: target.updatedAt, itemId: target.id, before: clean(item), after: clean(target as unknown as UniversalItem), causationId: createId(), depth: 0 };
      const result = runAutomationEvents(draft, [event]);
      if (result.notifications.length) setNotices((current) => [...current, ...result.notifications.map((notice) => ({ ...notice, id: createId(), at: new Date().toISOString() }))]);
    });
    if (state !== 'open') setNotices((current) => current.filter((notice) => notice.itemId !== item.id));
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
      const acknowledgedAt = new Date().toISOString();
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

  if (boot === 'checking') return <main className="splash"><div className="brand-mark">U</div><p>Opening encrypted workspace…</p></main>;
  if (boot === 'empty' || boot === 'locked') return <LockScreen exists={boot === 'locked'} onReady={activate} />;
  if (!workspace || !session) return null;
  const allItemsView = allItemsViewFor(workspace);

  // Calendar and Automations are retained in the encrypted workspace, but archived from the daily UI until they are reliable enough to bring back.
  const nav: Array<[Page, LineIconName, string, boolean?]> = [['home', 'home', 'Home'], ['all', 'items', 'All items', true], ['settings', 'settings', 'Settings']];
  const openItems = new Set(Object.values(workspace.items).filter((item) => item.state === 'open' && !item.deletedAt && !isItemTemplate(item) && (item.role !== 'series_template' || item.habit)).map((item) => item.occurrence?.seriesId ?? item.id)).size;
  const restoreItem = (item: UniversalItem) => commit('Restore item from trash', (draft) => {
    const target = draft.items[item.id]; if (!target?.deletedAt) return;
    delete target.deletedAt; delete draft.tombstones[item.id];
    target.updatedAt = new Date().toISOString(); target.revision += 1;
    if (target.role === 'series_template') reconcileRecurrences(draft);
  });
  const clearTrash = () => commit('Clear trash', (draft) => {
    Object.values(draft.items).forEach((item) => { if (item.deletedAt) { delete draft.items[item.id]; delete draft.tombstones[item.id]; } });
  });
  const permanentlyDeleteItem = (item: UniversalItem) => commit('Permanently delete item', (draft) => {
    const target = draft.items[item.id]; if (!target?.deletedAt) return;
    delete draft.items[item.id]; delete draft.tombstones[item.id];
  });
  const captureQuickItem = () => {
    if (!quick.trim()) return;
    const item = createUiItem(quick.trim());
    commit('Quick capture', (draft) => { draft.items[item.id] = clean(item); runAutomationEvents(draft, [{ id: createId(), type: 'item.created', at: item.createdAt, itemId: item.id, after: clean(item), causationId: createId(), depth: 0 }]); });
    setQuick('');
    setEditorIsNew(true); setEditor(item);
  };
  const downloadDiagnostics = () => {
    const blob = new Blob([JSON.stringify(readDiagnostics(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'utm-diagnostics.json'; anchor.click(); URL.revokeObjectURL(url);
  };

  const wallClock = new Date(clockTick);
  const activeDateLabel = formatHeaderDate(wallClock, workspace.calendarPreferences.language);
  return <div className={`app-shell page-${page}`}>
    <aside className="sidebar"><div className="sidebar-brand"><div className="brand-mark small">U</div><span>Universal</span></div><nav>{nav.map(([target, icon, label, beta]) => <button key={target} className={page === target ? 'active' : ''} onClick={() => setPage(target)}><LineIcon name={icon}/><span>{label}</span>{beta && <em className="nav-beta" title="This area is still being tested and improved.">Beta</em>}{target === 'all' && <b title={`${openItems} active ${openItems === 1 ? 'item' : 'items'}`}>{openItems}</b>}</button>)}</nav><div className="sidebar-bottom"><button onClick={() => setTransfer(true)}><LineIcon name="transfer"/><span>Transfer</span></button><button onClick={() => { lock(session); setSession(null); setBoot('locked'); }}><LineIcon name="lock"/><span>Lock</span></button></div></aside>
    <main className="content">
      <header className="topbar"><div><span className="top-summary">{activeDateLabel}</span><span className="sync-state"><i /> Encrypted locally</span></div><div className="top-actions">{page === 'home' && <button className="views-add-button" aria-label="New view" title="New view" onClick={() => setNewViewRequest((value) => value + 1)}><LineIcon name="plus"/></button>}<button className="notice-button" aria-label="Notifications" aria-expanded={noticeCenterOpen} onClick={() => { setMobileNavOpen(false); setNoticeCenterOpen((open) => !open); setPopupNoticeIds([]); }} title="Notifications"><LineIcon name="bell"/>{notices.length > 0 && <b>{notices.length}</b>}</button><button className="mobile-menu-button" aria-label="Open navigation" aria-expanded={mobileNavOpen} onClick={() => { setNoticeCenterOpen(false); setMobileNavOpen((open) => !open); }}><LineIcon name="menu"/></button></div></header>
      {mobileNavOpen && <nav className="mobile-nav-menu" aria-label="Main navigation">{nav.map(([target, icon, label, beta]) => <button key={target} className={page === target ? 'active' : ''} onClick={() => { setPage(target); setMobileNavOpen(false); }}><LineIcon name={icon}/><span>{label}</span>{beta && <em className="nav-beta">Beta</em>}</button>)}</nav>}
      {!noticeCenterOpen && popupNoticeIds.length > 0 && <div className="notice-tray notice-popups" aria-live="polite">{popupNoticeIds.slice(-3).reverse().map((id) => notices.find((notice) => notice.id === id)).filter((notice): notice is Notice => Boolean(notice)).map((notice) => <article className="notice-card" key={notice.id}><button className="notice-content" onClick={() => openNoticeItem(notice)}><strong>{notice.title}</strong><span>{notice.body}</span></button><button type="button" className="notice-dismiss" aria-label="Close notification" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); dismissPopupNotice(notice.id); }} onClick={(event) => { event.preventDefault(); event.stopPropagation(); dismissPopupNotice(notice.id); }}><CloseIcon /></button></article>)}</div>}
      {noticeCenterOpen && <aside className="notification-center" aria-label="Notification center"><header><h2>Notifications</h2><button type="button" className="icon-button" aria-label="Close notification center" onClick={() => setNoticeCenterOpen(false)}><CloseIcon /></button></header><div className="notification-list">{notices.length ? notices.slice().reverse().map((notice) => <article className="notice-card" key={notice.id}><button className="notice-content" onClick={() => openNoticeItem(notice)}><strong>{notice.title}</strong><span>{notice.body}</span></button><button type="button" className="notice-dismiss" aria-label="Delete notification" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); deleteNotice(notice.id); }}><CloseIcon /></button></article>) : <p className="empty">No notifications</p>}</div></aside>}
      {page === 'home' && <><ViewsPage workspace={workspace} commit={commit} onEditItem={(item) => setEditor(itemEditorSource(workspace, item))} onState={changeItemState} celebratingIds={celebratingIds} createRequest={newViewRequest} onAddItem={(view) => { setEditorIsNew(true); setEditor(applyViewCreationDefaults(createUiItem('', 'task'), view)); }} onExportView={(view, mode, format, metadata) => exportSavedView(workspace, view, mode, format, metadata)} /></>}
      {page === 'calendar' && <CalendarPage workspace={workspace} commit={commit} onEditItem={(item) => setEditor(itemEditorSource(workspace, item))} />}
      {page === 'all' && <AllItemsPage workspace={workspace} view={allItemsView} onEdit={(item) => setEditor(itemEditorSource(workspace, item))} onState={changeItemState} onSaveView={(view) => commit('Customize all items view', (draft) => { draft.views[ALL_ITEMS_VIEW_ID] = clean(view); })} onRestore={restoreItem} onClearTrash={clearTrash} onDelete={permanentlyDeleteItem} />}
      {page === 'automations' && <AutomationsPage workspace={workspace} commit={commit} />}
      {page === 'settings' && <SettingsPage workspace={workspace} commit={commit} onTransfer={() => setTransfer(true)} onImportFile={(file) => { void portableFromFile(file, workspace).then(({ source, warnings }) => { if (warnings.length) setToast(warnings[0]!); setPortableImportSource(source); }).catch((error) => setToast(error instanceof Error ? error.message : String(error))); }} onNotify={() => void Notification.requestPermission().then((permission) => setToast(`Notification permission: ${permission}`))} onEnableBackground={() => void enableBackgroundNotifications()} onDisableBackground={() => void disableBackgroundNotifications()} onBackgroundContent={setBackgroundNotificationContent} />}
      {page === 'settings' && <section className="settings-card diagnostics-card"><p className="eyebrow">DIAGNOSTICS</p><h2>Usage and error log</h2><p>Anonymous local diagnostics help investigate failures and unusual behavior. Nothing is uploaded automatically.</p><div className="diagnostics-actions"><span>{diagnosticCount} recorded entries</span><button className="secondary" onClick={downloadDiagnostics} disabled={!diagnosticCount}>Download log</button><button className="secondary" onClick={() => { localStorage.removeItem(DIAGNOSTICS_KEY); setDiagnosticCount(0); }}>Clear log</button></div></section>}
    </main>
    <div className="capture-dock"><div className="quick-capture"><input ref={captureInputRef} enterKeyHint="done" value={quick} onChange={(event) => setQuick(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); captureQuickItem(); } }} placeholder="Add new task" aria-label="Add new task"/></div></div>
    {editor && <ItemEditor initial={editor} workspace={workspace} isNew={editorIsNew} onReadPortableFile={async (file) => (await portableFromFile(file, workspace)).source} onExportItem={(item, format, metadata) => exportPortable(workspace, packageForItems(workspace, [item], { type: 'single_item', itemId: item.id }), `${safeFilename(item.title)}.utm-items`, format, metadata)} onClose={() => { setEditorIsNew(false); setEditor(null); }} onToggleSubtask={(id) => { const subtask = workspace.items[id]; if (subtask) changeItemState(subtask, subtask.state === 'done' ? 'open' : 'done'); }} onCreateSubtask={(title, parentId) => { const subtask = createUiItem(title, 'task'); commit('Create subtask', (draft) => { draft.items[subtask.id] = clean(subtask); const parent = draft.items[parentId]; if (parent && !parent.relations.some((relation) => relation.type === 'parent' && relation.targetId === subtask.id)) parent.relations = [...parent.relations, { id: createId(), targetId: subtask.id, type: 'parent' }]; }); return subtask; }} onSave={(item) => { const isNew = !workspace.items[item.id]; let recurrenceError = ''; const saved = commit(isNew ? 'Create item' : 'Update item', (draft) => { const before = draft.items[item.id]; draft.items[item.id] = clean(item); if (before?.state === 'open' && (item.state === 'done' || item.state === 'cancelled') && item.occurrence && item.closure?.at) advanceCompletionAnchoredSeries(draft, item, item.closure.at); const event = { id: createId(), type: isNew ? 'item.created' as const : 'item.updated' as const, at: item.updatedAt, itemId: item.id, after: clean(item), causationId: createId(), depth: 0 }; runAutomationEvents(draft, [event]); if (item.role === 'series_template') { try { reconcileRecurrences(draft); } catch (reason) { recurrenceError = reason instanceof Error ? reason.message : String(reason); } } }); if (saved) { setEditorIsNew(false); setEditor(null); if (recurrenceError) setToast(`Series saved. Recurrence sync will retry in the background (${recurrenceError}).`); } }} onDelete={(item) => { const deleted = commit('Delete item', (draft) => { const target = draft.items[item.id]; if (target) { target.deletedAt = new Date().toISOString(); draft.tombstones[item.id] = target.deletedAt; } }); if (deleted) { setEditorIsNew(false); setEditor(null); } }} />}
    {transfer && <TransferDialog session={session} onClose={() => setTransfer(false)} onBackupExported={() => { commit('Record encrypted backup', (draft) => { draft.calendarPreferences.backupPreferences = { ...(draft.calendarPreferences.backupPreferences ?? { reminderDays: 7 }), lastBackupAt: new Date().toISOString() }; }); setBackupReminder(false); setToast('Encrypted backup saved. Choose its folder in Files.'); }} onMerged={(next, message) => { setSession(next); setToast(message); }} onReplaced={(next, message) => { lock(session); setSession(next); setToast(message); }} />}
    {portableImportSource && <PortableImportDialog workspace={workspace} source={portableImportSource} onClose={() => setPortableImportSource(null)} onApply={(preview) => { commit('Import portable JSON package', (draft) => { const result = applyPortableImport(draft, preview); setToast(`Imported ${result.addedItems + result.copiedItems} items and ${result.addedViews + result.copiedViews} views`); }); setPortableImportSource(null); }} />}
    {page === 'settings' && workspace && <section className="settings-card backup-controls"><p className="eyebrow">BACKUP SCHEDULE</p><h2>Backup reminders</h2><p>Choose how often the app should remind you to export an encrypted <code>.utmb</code> backup. The browser will not write to a folder by itself.</p><label>Remind every (days; 0 disables)<input type="number" min="0" step="1" value={workspace.calendarPreferences.backupPreferences?.reminderDays ?? 7} onChange={(event) => commit('Change backup reminder', (draft) => { draft.calendarPreferences.backupPreferences = { ...(draft.calendarPreferences.backupPreferences ?? { reminderDays: 7 }), reminderDays: Math.max(0, Number(event.target.value) || 0) }; })} /></label><label>Backup location note (optional)<input value={workspace.calendarPreferences.backupPreferences?.locationLabel ?? ''} placeholder="iCloud Drive / Universal" onChange={(event) => commit('Change backup location note', (draft) => { draft.calendarPreferences.backupPreferences = { ...(draft.calendarPreferences.backupPreferences ?? { reminderDays: 7 }), locationLabel: event.target.value }; })} /></label><button className="secondary" onClick={() => setTransfer(true)}>Create encrypted backup now</button>{workspace.calendarPreferences.backupPreferences?.lastBackupAt && <small>Last backup: {formatRussianDateTime(workspace.calendarPreferences.backupPreferences.lastBackupAt)}</small>}</section>}
    {backupReminder && !transfer && <div className="toast backup-reminder" role="alert"><span>It is time to create an encrypted backup.</span><button className="secondary" onClick={() => setTransfer(true)}>Back up now</button><button className="icon-button" aria-label="Dismiss backup reminder" onClick={() => setBackupReminder(false)}>×</button></div>}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}
