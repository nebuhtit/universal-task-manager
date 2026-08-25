import { useEffect, useRef, useState, type FormEvent } from 'react';
import * as XLSX from 'xlsx';
import { installDomLocalization, interfaceLanguages } from './i18n';
import { createPushPreferences, subscribeBackgroundPush, syncBackgroundPush, unsubscribeBackgroundPush } from './push';
import { CodeEditor } from './components/ui/CodeEditor';
import { CloseIcon, LineIcon } from './components/ui/icons';
import { SectionGuide } from './components/ui/SectionGuide';
import {
  AllItemsPage,
  ALL_ITEMS_VIEW_ID,
  allItemsViewFor,
  inferredPreset,
  isItemTemplate,
} from './features/items';
import { ItemEditor } from './features/items/editor/ItemEditor';
import { CalendarPage } from './features/calendar/CalendarPage';
import { AppShell, type AppNotice as Notice, type AppPage as Page } from './components/layout/AppShell';
import { useAppearance } from './hooks/useAppearance';
import { useToast } from './hooks/useToast';
import { useUiSounds } from './hooks/useUiSounds';
import { useViewport } from './hooks/useViewport';
import { useWorkspaceController } from './hooks/useWorkspaceController';
import {
  ViewsPage,
  selectViewItems,
  setRecentlyDone,
} from './features/views';
import { formatHeaderDate, formatRussianDateTime, formatSystemDateTime } from './utils/dates';
import {
  APP_NAME, APP_RELEASED_AT, APP_VERSION, applyPortableImport, buildPortableImportPreview,
  collectItemDependencies, createId, createItem, createPortablePackage,
  advanceCompletionAnchoredSeries, parseExpression, reconcileRecurrences,
  runAutomationEvents, serializePortablePackage,
  createWorkspace, fromICS, packageToTabular, parseCsv, tabularToPackage, toCsv, toICS,
  type AutomationAction, type AutomationRule, type CustomFieldDefinition,
  type ItemPreset, type PortableImportPreview, type PortableSelection, type SavedView, type UniversalItem, type WorkspaceDocument, type WorkspaceLanguage,
} from '@utm/core';
import {
  createLocalWorkspace, exportContainer, importAsLocalWorkspace,
  mergeIntoLocalWorkspace, restoreLocalWorkspace, unlockLocalWorkspace, validateContainer,
  type UnlockedWorkspace,
} from '@utm/sdk';

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
  const [quick, setQuick] = useState('');
  const [celebratingIds, setCelebratingIds] = useState<Set<string>>(new Set());
  const [portableImportSource, setPortableImportSource] = useState<string | null>(null);
  const [clockTick, refreshClock] = useState(() => Date.now());
  const seenNoticeIds = useRef(new Set<string>());
  const noticeTimers = useRef(new Map<string, number>());
  const pushError = useRef('');
  const captureInputRef = useRef<HTMLInputElement>(null);
  const [diagnosticCount, setDiagnosticCount] = useState(() => readDiagnostics().length);
  const { boot, session, workspace, activate, commit, lockWorkspace, adoptSession } = useWorkspaceController({ onToast: setToast, setNotices });
  useEffect(() => {
    const capture = (kind: DiagnosticEntry['kind'], message: string, details?: string) => { recordDiagnostic({ kind, message, page, ...(details ? { details } : {}) }); setDiagnosticCount(readDiagnostics().length); };
    const onError = (event: ErrorEvent) => capture('error', event.message || 'Unknown error', event.error?.stack);
    const onRejection = (event: PromiseRejectionEvent) => capture('unhandledrejection', event.reason instanceof Error ? event.reason.message : String(event.reason));
    window.addEventListener('error', onError); window.addEventListener('unhandledrejection', onRejection);
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); };
  }, [page]);
  useViewport(captureInputRef, boot === 'ready');
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
  useAppearance(workspace?.calendarPreferences.appearance, boot === 'ready');
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
  return <><AppShell page={page} onPage={setPage} activeDateLabel={activeDateLabel} openItems={openItems} notices={notices} popupNoticeIds={popupNoticeIds} noticeCenterOpen={noticeCenterOpen} mobileNavOpen={mobileNavOpen} onNewView={() => setNewViewRequest((value) => value + 1)} onToggleNotices={() => { setMobileNavOpen(false); setNoticeCenterOpen((open) => !open); setPopupNoticeIds([]); }} onToggleNavigation={() => { setNoticeCenterOpen(false); setMobileNavOpen((open) => !open); }} onCloseNavigation={() => setMobileNavOpen(false)} onDismissPopup={dismissPopupNotice} onDeleteNotice={deleteNotice} onOpenNotice={openNoticeItem} onTransfer={() => setTransfer(true)} onLock={lockWorkspace}>
      {page === 'home' && <><ViewsPage workspace={workspace} commit={commit} onEditItem={(item) => setEditor(itemEditorSource(workspace, item))} onState={changeItemState} celebratingIds={celebratingIds} createRequest={newViewRequest} onAddItem={(view) => { setEditorIsNew(true); setEditor(applyViewCreationDefaults(createUiItem('', 'task'), view)); }} onExportView={(view, mode, format, metadata) => exportSavedView(workspace, view, mode, format, metadata)} /></>}
      {page === 'calendar' && <CalendarPage workspace={workspace} commit={commit} createUiItem={createUiItem} onEditItem={(item) => setEditor(itemEditorSource(workspace, item))} />}
      {page === 'all' && <AllItemsPage workspace={workspace} view={allItemsView} onEdit={(item) => setEditor(itemEditorSource(workspace, item))} onState={changeItemState} onSaveView={(view) => commit('Customize all items view', (draft) => { draft.views[ALL_ITEMS_VIEW_ID] = clean(view); })} onRestore={restoreItem} onClearTrash={clearTrash} onDelete={permanentlyDeleteItem} />}
      {page === 'automations' && <AutomationsPage workspace={workspace} commit={commit} />}
      {page === 'settings' && <SettingsPage workspace={workspace} commit={commit} onTransfer={() => setTransfer(true)} onImportFile={(file) => { void portableFromFile(file, workspace).then(({ source, warnings }) => { if (warnings.length) setToast(warnings[0]!); setPortableImportSource(source); }).catch((error) => setToast(error instanceof Error ? error.message : String(error))); }} onNotify={() => void Notification.requestPermission().then((permission) => setToast(`Notification permission: ${permission}`))} onEnableBackground={() => void enableBackgroundNotifications()} onDisableBackground={() => void disableBackgroundNotifications()} onBackgroundContent={setBackgroundNotificationContent} />}
      {page === 'settings' && <section className="settings-card diagnostics-card"><p className="eyebrow">DIAGNOSTICS</p><h2>Usage and error log</h2><p>Anonymous local diagnostics help investigate failures and unusual behavior. Nothing is uploaded automatically.</p><div className="diagnostics-actions"><span>{diagnosticCount} recorded entries</span><button className="secondary" onClick={downloadDiagnostics} disabled={!diagnosticCount}>Download log</button><button className="secondary" onClick={() => { localStorage.removeItem(DIAGNOSTICS_KEY); setDiagnosticCount(0); }}>Clear log</button></div></section>}
    </AppShell>
    <div className="capture-dock"><div className="quick-capture"><input ref={captureInputRef} enterKeyHint="done" value={quick} onChange={(event) => setQuick(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); captureQuickItem(); } }} placeholder="Add new task" aria-label="Add new task"/></div></div>
    {editor && <ItemEditor initial={editor} workspace={workspace} isNew={editorIsNew} onReadPortableFile={async (file) => (await portableFromFile(file, workspace)).source} onExportItem={(item, format, metadata) => exportPortable(workspace, packageForItems(workspace, [item], { type: 'single_item', itemId: item.id }), `${safeFilename(item.title)}.utm-items`, format, metadata)} onClose={() => { setEditorIsNew(false); setEditor(null); }} onToggleSubtask={(id) => { const subtask = workspace.items[id]; if (subtask) changeItemState(subtask, subtask.state === 'done' ? 'open' : 'done'); }} onCreateSubtask={(title, parentId) => { const subtask = createUiItem(title, 'task'); commit('Create subtask', (draft) => { draft.items[subtask.id] = clean(subtask); const parent = draft.items[parentId]; if (parent && !parent.relations.some((relation) => relation.type === 'parent' && relation.targetId === subtask.id)) parent.relations = [...parent.relations, { id: createId(), targetId: subtask.id, type: 'parent' }]; }); return subtask; }} onSave={(item) => { const isNew = !workspace.items[item.id]; let recurrenceError = ''; const saved = commit(isNew ? 'Create item' : 'Update item', (draft) => { const before = draft.items[item.id]; draft.items[item.id] = clean(item); if (before?.state === 'open' && (item.state === 'done' || item.state === 'cancelled') && item.occurrence && item.closure?.at) advanceCompletionAnchoredSeries(draft, item, item.closure.at); const event = { id: createId(), type: isNew ? 'item.created' as const : 'item.updated' as const, at: item.updatedAt, itemId: item.id, after: clean(item), causationId: createId(), depth: 0 }; runAutomationEvents(draft, [event]); if (item.role === 'series_template') { try { reconcileRecurrences(draft); } catch (reason) { recurrenceError = reason instanceof Error ? reason.message : String(reason); } } }); if (saved) { setEditorIsNew(false); setEditor(null); if (recurrenceError) setToast(`Series saved. Recurrence sync will retry in the background (${recurrenceError}).`); } }} onDelete={(item) => { const deleted = commit('Delete item', (draft) => { const target = draft.items[item.id]; if (target) { target.deletedAt = new Date().toISOString(); draft.tombstones[item.id] = target.deletedAt; } }); if (deleted) { setEditorIsNew(false); setEditor(null); } }} />}
    {transfer && <TransferDialog session={session} onClose={() => setTransfer(false)} onBackupExported={() => { commit('Record encrypted backup', (draft) => { draft.calendarPreferences.backupPreferences = { ...(draft.calendarPreferences.backupPreferences ?? { reminderDays: 7 }), lastBackupAt: new Date().toISOString() }; }); setBackupReminder(false); setToast('Encrypted backup saved. Choose its folder in Files.'); }} onMerged={(next, message) => { adoptSession(next); setToast(message); }} onReplaced={(next, message) => { adoptSession(next, true); setToast(message); }} />}
    {portableImportSource && <PortableImportDialog workspace={workspace} source={portableImportSource} onClose={() => setPortableImportSource(null)} onApply={(preview) => { commit('Import portable JSON package', (draft) => { const result = applyPortableImport(draft, preview); setToast(`Imported ${result.addedItems + result.copiedItems} items and ${result.addedViews + result.copiedViews} views`); }); setPortableImportSource(null); }} />}
    {page === 'settings' && workspace && <section className="settings-card backup-controls"><p className="eyebrow">BACKUP SCHEDULE</p><h2>Backup reminders</h2><p>Choose how often the app should remind you to export an encrypted <code>.utmb</code> backup. The browser will not write to a folder by itself.</p><label>Remind every (days; 0 disables)<input type="number" min="0" step="1" value={workspace.calendarPreferences.backupPreferences?.reminderDays ?? 7} onChange={(event) => commit('Change backup reminder', (draft) => { draft.calendarPreferences.backupPreferences = { ...(draft.calendarPreferences.backupPreferences ?? { reminderDays: 7 }), reminderDays: Math.max(0, Number(event.target.value) || 0) }; })} /></label><label>Backup location note (optional)<input value={workspace.calendarPreferences.backupPreferences?.locationLabel ?? ''} placeholder="iCloud Drive / Universal" onChange={(event) => commit('Change backup location note', (draft) => { draft.calendarPreferences.backupPreferences = { ...(draft.calendarPreferences.backupPreferences ?? { reminderDays: 7 }), locationLabel: event.target.value }; })} /></label><button className="secondary" onClick={() => setTransfer(true)}>Create encrypted backup now</button>{workspace.calendarPreferences.backupPreferences?.lastBackupAt && <small>Last backup: {formatRussianDateTime(workspace.calendarPreferences.backupPreferences.lastBackupAt)}</small>}</section>}
    {backupReminder && !transfer && <div className="toast backup-reminder" role="alert"><span>It is time to create an encrypted backup.</span><button className="secondary" onClick={() => setTransfer(true)}>Back up now</button><button className="icon-button" aria-label="Dismiss backup reminder" onClick={() => setBackupReminder(false)}>×</button></div>}
    {toast && <div className="toast" role="status">{toast}</div>}
  </>;
}
