import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import * as Automerge from '@automerge/automerge';
import ReactMarkdown from 'react-markdown';
import {
  APP_NAME, APP_RELEASED_AT, APP_VERSION, applyPortableImport, backfillItemCreationVersions, buildPortableImportPreview,
  collectItemDependencies, collectScheduledEvents, compileQuery, compileSort, createId, createItem, createPortablePackage,
  evaluateFormulas, makeSeries, migrateItem, migrateView, migrateWorkspace, parseExpression, parsePortablePackage, parseSortSource,
  reconcileRecurrences, removeDuplicateReminders, runAutomationEvents, serializePortablePackage, serializeSortRules,
  type AutomationAction, type AutomationRule, type CustomFieldDefinition,
  type PortableImportPreview,
  type DomainEvent, type ItemPreset, type SavedView, type Schedule, type UniversalItem, type ViewSortRule, type WorkspaceDocument,
  type ReconcileResult,
} from '@utm/core';
import {
  createLocalWorkspace, exportContainer, hasLocalWorkspace, importAsLocalWorkspace, lock,
  mergeIntoLocalWorkspace, saveLocalWorkspace, unlockLocalWorkspace,
  type UnlockedWorkspace,
} from '@utm/sdk';

type Page = 'home' | 'all' | 'automations' | 'settings';
type Notice = { id: string; title: string; body: string; at: string; itemId?: string };

const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const dateInput = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromDateInput = (value: string) => value ? new Date(value).toISOString() : undefined;
const commaList = (value: string) => value.split(',').map((part) => part.trim()).filter(Boolean);
type FriendlyDurationUnit = 'minutes' | 'hours' | 'days' | 'weeks';
const parseFriendlyDuration = (value?: string): { amount: number; unit: FriendlyDurationUnit } => {
  const match = /^(?:P(\d+)([DW])|PT(\d+)([HM]))$/.exec(value ?? '');
  if (!match) return { amount: 7, unit: 'days' };
  const amount = Number(match[1] ?? match[3]);
  const code = match[2] ?? match[4];
  return { amount, unit: code === 'W' ? 'weeks' : code === 'H' ? 'hours' : code === 'M' ? 'minutes' : 'days' };
};
const toIsoDuration = (amount: number, unit: FriendlyDurationUnit) => unit === 'weeks' ? `P${amount}W` : unit === 'days' ? `P${amount}D` : unit === 'hours' ? `PT${amount}H` : `PT${amount}M`;
const createUiItem = (title = '', preset: ItemPreset = 'task', now = new Date()) => {
  const item = createItem(title, preset, now);
  item.schedule = { ...item.schedule, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, startAt: now.toISOString() };
  return item;
};
const safeFilename = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'universal';
const downloadText = (content: string, filename: string, type = 'application/json') => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
};
const confirmPlaintextDownload = (message = 'This JSON export is plaintext and may contain private item data. Download it now?') => window.confirm(message);

async function reconcileOffMainThread(workspace: WorkspaceDocument, now: Date): Promise<ReconcileResult> {
  if (typeof Worker === 'undefined') return reconcileRecurrences(clean(workspace), now);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./recurrence.worker.ts', import.meta.url), { type: 'module' });
    const timeout = window.setTimeout(() => { worker.terminate(); reject(new Error('Recurrence worker timed out')); }, 20_000);
    worker.onmessage = (event: MessageEvent<{ ok: true; result: ReconcileResult } | { ok: false; error: string }>) => {
      window.clearTimeout(timeout); worker.terminate();
      if (event.data.ok) resolve(event.data.result); else reject(new Error(event.data.error));
    };
    worker.onerror = () => { window.clearTimeout(timeout); worker.terminate(); reject(new Error('Recurrence worker failed')); };
    worker.postMessage({ workspace: clean(workspace), now: now.toISOString() });
  });
}

function Icon({ children }: { children: ReactNode }) { return <span className="icon" aria-hidden>{children}</span>; }
function CloseIcon() { return <svg className="close-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M4 4l12 12M16 4 4 16" /></svg>; }

type CodeLanguage = 'dsl' | 'json';
function highlightedCode(source: string, language: CodeLanguage): ReactNode[] {
  const pattern = language === 'json'
    ? /("(?:\\.|[^"\\])*")(?=\s*:)|("(?:\\.|[^"\\])*")|\b(true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|[{}[\],:]|\s+|[^\s{}[\],:]+/g
    : /("(?:\\.|[^"\\])*")|\b(true|false|null|in)\b|-?\b\d+(?:\.\d+)?\b|&&|\|\||==|!=|>=|<=|[><!+*/%-]|[()[\],.]|\s+|[A-Za-z_][\w.]*/g;
  const tokens = source.match(pattern) ?? [source];
  let cursor = 0;
  return tokens.map((token) => {
    const at = source.indexOf(token, cursor); cursor = at + token.length;
    const rest = source.slice(cursor);
    let kind = 'plain';
    if (/^\s+$/.test(token)) kind = 'space';
    else if (/^"/.test(token)) kind = language === 'json' && /^\s*:/.test(rest) ? 'key' : 'string';
    else if (/^(?:true|false|null|in)$/.test(token)) kind = 'keyword';
    else if (/^-?\d/.test(token)) kind = 'number';
    else if (/^(?:&&|\|\||==|!=|>=|<=|[><!+*/%\-]|[{}[\],:().])$/.test(token)) kind = 'operator';
    else if (language === 'dsl' && /^[A-Za-z_]/.test(token)) kind = rest.trimStart().startsWith('(') ? 'function' : 'identifier';
    return <span className={`syntax-${kind}`} key={`${cursor}-${token}`}>{token}</span>;
  });
}

function CodeEditor({ value, onChange, language, rows = 8, ariaLabel }: {
  value: string; onChange: (value: string) => void; language: CodeLanguage; rows?: number; ariaLabel?: string;
}) {
  const backdrop = useRef<HTMLPreElement>(null);
  return <div className={`syntax-editor syntax-${language}`}>
    <pre ref={backdrop} aria-hidden>{highlightedCode(value, language)}{value.endsWith('\n') ? ' ' : null}</pre>
    <textarea aria-label={ariaLabel} spellCheck={false} rows={rows} value={value} onChange={(event) => onChange(event.target.value)} onScroll={(event) => { if (backdrop.current) { backdrop.current.scrollTop = event.currentTarget.scrollTop; backdrop.current.scrollLeft = event.currentTarget.scrollLeft; } }} />
  </div>;
}

type LineIconName = 'home' | 'items' | 'views' | 'rules' | 'settings' | 'lock' | 'bell' | 'transfer';
function LineIcon({ name }: { name: LineIconName }) {
  const paths: Record<LineIconName, ReactNode> = {
    home: <><path d="M3 10.8 12 3l9 7.8"/><path d="M5.5 9.5V21h13V9.5M9.5 21v-7h5v7"/></>,
    items: <><path d="M9 6h12M9 12h12M9 18h12"/><path d="m3 6 1 1 2-2M3 12h3M3 18h3"/></>,
    views: <><rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="8" height="6" rx="1.5"/><rect x="15" y="14" width="6" height="6" rx="1.5"/></>,
    rules: <path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z"/>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
    transfer: <><path d="M7 7h11l-3-3M17 17H6l3 3"/><path d="m18 7-3 3M6 17l3-3"/></>,
  };
  return <svg className="line-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{paths[name]}</svg>;
}

function LockScreen({ exists, onReady }: { exists: boolean; onReady: (session: UnlockedWorkspace) => void }) {
  const [name, setName] = useState('My workspace');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      if (!exists && password !== confirm) throw new Error('Passwords do not match');
      onReady(exists ? await unlockLocalWorkspace(password) : await createLocalWorkspace(password, name));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };

  const importWorkspace = async (file: File) => {
    setBusy(true); setError('');
    try { onReady(await importAsLocalWorkspace(await file.text(), password)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  return <main className="lock-shell">
    <section className="lock-card">
      <div className="brand-mark">U</div>
      <p className="eyebrow">UNIVERSAL TASK MANAGER</p>
      <h1>{exists ? 'Unlock your workspace' : 'Build your own system'}</h1>
      <p className="muted">Your data stays on this device, encrypted. There is no account and no password recovery. Please remember your password.</p>
      <form onSubmit={submit}>
        {!exists && <label>Workspace name<input value={name} onChange={(event) => setName(event.target.value)} required /></label>}
        <label>Password<input type="password" minLength={10} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={exists ? 'current-password' : 'new-password'} required /></label>
        {!exists && <label>Confirm password<input type="password" minLength={10} value={confirm} onChange={(event) => setConfirm(event.target.value)} required /></label>}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary wide" disabled={busy}>{busy ? 'Working…' : exists ? 'Unlock' : 'Create encrypted workspace'}</button>
      </form>
      {!exists && <div className="import-lock">
        <span>Already have an encrypted workspace?</span>
        <button className="text-button" disabled={!password || busy} onClick={() => fileRef.current?.click()}>Import .utm</button>
        <input ref={fileRef} hidden type="file" accept=".utm,application/json" onChange={(event) => event.target.files?.[0] && void importWorkspace(event.target.files[0])} />
      </div>}
    </section>
  </main>;
}

const priorityNames: Record<NonNullable<UniversalItem['priority']>, string> = { 0: 'None', 1: 'Low', 2: 'Medium', 3: 'High', 4: 'Urgent' };
const stateNames: Record<UniversalItem['state'], string> = { open: 'Active', done: 'Completed', auto_closed: 'Auto closed', cancelled: 'Cancelled', archived: 'Archived' };

type ViewFieldOption = { path: string; label: string; group: string };
const builtInViewFields: ViewFieldOption[] = [
  { path: 'title', label: 'Title', group: 'Core' }, { path: 'bodyMarkdown', label: 'Description', group: 'Core' },
  { path: 'state', label: 'State', group: 'Core' }, { path: 'preset', label: 'Preset', group: 'Core' },
  { path: 'role', label: 'Role', group: 'Core' }, { path: 'priority', label: 'Priority', group: 'Core' },
  { path: 'tags', label: 'Tags', group: 'Core' }, { path: 'contexts', label: 'Contexts', group: 'Core' },
  { path: 'schedule.availableFrom', label: 'Available from', group: 'Schedule' }, { path: 'schedule.startAt', label: 'Start', group: 'Schedule' },
  { path: 'schedule.endAt', label: 'End', group: 'Schedule' }, { path: 'schedule.dueAt', label: 'Due', group: 'Schedule' },
  { path: 'schedule.estimatedDuration', label: 'Estimated duration', group: 'Schedule' }, { path: 'schedule.actualDuration', label: 'Actual duration', group: 'Schedule' },
  { path: 'schedule.timezone', label: 'Timezone', group: 'Schedule' }, { path: 'schedule.allDay', label: 'All day', group: 'Schedule' },
  { path: 'recurrence.rrule', label: 'RRULE', group: 'Recurrence' }, { path: 'recurrence.rdates', label: 'Additional dates', group: 'Recurrence' },
  { path: 'recurrence.exdates', label: 'Excluded dates', group: 'Recurrence' }, { path: 'recurrence.timezone', label: 'Recurrence timezone', group: 'Recurrence' },
  { path: 'recurrence.activationOffset', label: 'Activation offset', group: 'Recurrence' }, { path: 'recurrence.dueOffset', label: 'Due offset', group: 'Recurrence' },
  { path: 'recurrence.closeAt', label: 'Auto-close boundary', group: 'Recurrence' }, { path: 'recurrence.anchor', label: 'Next cycle anchor', group: 'Recurrence' },
  { path: 'recurrence.autoRenew', label: 'Auto-renew', group: 'Recurrence' },
  { path: 'progress.mode', label: 'Progress mode', group: 'Progress & habit' }, { path: 'progress.current', label: 'Progress current', group: 'Progress & habit' },
  { path: 'progress.target', label: 'Progress target', group: 'Progress & habit' }, { path: 'progress.unit', label: 'Progress unit', group: 'Progress & habit' },
  { path: 'habit.target', label: 'Habit target', group: 'Progress & habit' }, { path: 'habit.unit', label: 'Habit unit', group: 'Progress & habit' },
  { path: 'habit.streakMode', label: 'Habit streak mode', group: 'Progress & habit' },
  { path: 'reminders', label: 'Reminders', group: 'Connections' }, { path: 'relations', label: 'Relations', group: 'Connections' },
  { path: 'attachments', label: 'Links', group: 'Connections' },
  { path: 'closure.at', label: 'Closed at', group: 'History' }, { path: 'closure.actor', label: 'Closed by', group: 'History' },
  { path: 'closure.reason', label: 'Closure reason', group: 'History' }, { path: 'occurrence.seriesId', label: 'Series ID', group: 'History' },
  { path: 'occurrence.recurrenceId', label: 'Occurrence date', group: 'History' }, { path: 'occurrence.sequence', label: 'Occurrence sequence', group: 'History' },
  { path: 'createdAt', label: 'Created at', group: 'System' }, { path: 'updatedAt', label: 'Last modified', group: 'System' },
  { path: 'createdWithAppName', label: 'Created with app', group: 'System' }, { path: 'createdWithVersion', label: 'Created with version', group: 'System' },
  { path: 'createdWithAppId', label: 'Application ID', group: 'System' }, { path: 'schemaVersion', label: 'Schema version', group: 'System' },
  { path: 'revision', label: 'Revision', group: 'System' }, { path: 'id', label: 'Item ID', group: 'System' },
];

const viewFieldOptions = (workspace: WorkspaceDocument): ViewFieldOption[] => [
  ...builtInViewFields,
  ...Object.values(workspace.customFields).map((field) => ({ path: `custom.${field.key}`, label: field.label, group: 'Custom fields' })),
];
const viewFieldLabel = (workspace: WorkspaceDocument, path: string) => viewFieldOptions(workspace).find((field) => field.path === path)?.label ?? path;
const readItemField = (item: UniversalItem, field: string, workspace?: WorkspaceDocument): unknown => {
  if (field.startsWith('custom.') && workspace) {
    const key = field.slice(7);
    const definition = Object.values(workspace.customFields).find((candidate) => candidate.key === key);
    if (definition?.kind === 'formula') return evaluateFormulas(item, Object.values(workspace.customFields)).values[key];
  }
  return field.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, item);
};
const displayViewValue = (value: unknown, field: string): string => {
  if (value === undefined || value === null || value === '') return '—';
  if ((field.endsWith('At') || field.endsWith('Date') || field === 'createdAt' || field === 'updatedAt') && typeof value === 'string') {
    const date = new Date(value); if (!Number.isNaN(date.getTime())) return date.toLocaleString();
  }
  if (Array.isArray(value)) return value.length ? value.map((entry) => typeof entry === 'object' ? JSON.stringify(entry) : String(entry)).join(', ') : '—';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
};

function ItemCard({ item, onEdit, onState, fields, workspace }: { item: UniversalItem; onEdit: () => void; onState: (state: UniversalItem['state']) => void; fields?: string[]; workspace?: WorkspaceDocument }) {
  const due = item.schedule?.dueAt ?? item.schedule?.startAt;
  const customDisplay = fields !== undefined;
  const metadataFields = fields?.filter((field) => field !== 'title' && field !== 'priority') ?? [];
  return <article className={`item-card state-${item.state}`}>
    <button className="state-toggle" aria-label={item.state === 'open' ? 'Complete item' : 'Reopen item'} onClick={() => onState(item.state === 'open' ? 'done' : 'open')}>
      {item.state === 'open' ? '' : '✓'}
    </button>
    <button className="item-main" onClick={onEdit}>
      {(!customDisplay || fields?.includes('title')) && <span className="item-title">{item.title}</span>}
      {!customDisplay && <span className="item-meta"><span className={`preset ${item.preset}`}>{item.preset}</span>{due && <span>{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: item.schedule?.allDay ? undefined : '2-digit', minute: item.schedule?.allDay ? undefined : '2-digit' }).format(new Date(due))}</span>}{item.schedule?.estimatedDuration && <span>{item.schedule.estimatedDuration}</span>}{item.tags.slice(0, 2).map((tag) => <span key={tag}>#{tag}</span>)}{item.closure?.reason === 'auto_renew' && <span className="auto-pill">auto-closed</span>}</span>}
      {customDisplay && metadataFields.length > 0 && <span className="view-item-fields">{metadataFields.map((field) => <span key={field}><small>{viewFieldLabel(workspace!, field)}</small>{displayViewValue(readItemField(item, field, workspace), field)}</span>)}</span>}
    </button>
    {item.priority && (!customDisplay || fields?.includes('priority')) ? <button className={`priority p${item.priority}`} title={`Priority ${item.priority}: ${priorityNames[item.priority]}. Click to edit.`} aria-label={`Priority ${item.priority}: ${priorityNames[item.priority]}. Edit item`} onClick={onEdit}>{priorityNames[item.priority]}</button> : null}
  </article>;
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

function filteredItems(workspace: WorkspaceDocument, view?: SavedView): UniversalItem[] {
  // Series templates are recurrence configuration, not user-facing rows. Views
  // operate on logical items (standalone items and materialized occurrences),
  // just as a spreadsheet filter operates on each source row once.
  let items = Object.values(workspace.items).filter((item) => !item.deletedAt && item.role !== 'series_template');
  if (view) {
    try { const predicate = compileQuery(view.query.source || 'true'); items = items.filter((item) => predicate(item)); }
    catch { return []; }
    const sortSource = view.sortSource ?? (view.sort ?? []).map((sort) => `${sort.field} ${sort.direction} nulls ${sort.nulls ?? 'last'}`).join('\n');
    if (sortSource.trim()) items.sort(compileSort(sortSource));
  }
  return items;
}

function ItemEditor({ initial, workspace, onSave, onDelete, onClose }: {
  initial: UniversalItem; workspace: WorkspaceDocument; onSave: (item: UniversalItem) => void; onDelete: (item: UniversalItem) => void; onClose: () => void;
}) {
  const [item, setItem] = useState(() => clean(initial));
  const [tags, setTags] = useState(item.tags.join(', '));
  const [contexts, setContexts] = useState(item.contexts.join(', '));
  const [recurring, setRecurring] = useState(item.role === 'series_template');
  const [error, setError] = useState('');
  const [jsonDraft, setJsonDraft] = useState(() => JSON.stringify(initial, null, 2));
  const [jsonDirty, setJsonDirty] = useState(false);
  const importJsonRef = useRef<HTMLInputElement>(null);
  const definitions = Object.values(workspace.customFields);
  const formulas = evaluateFormulas(item, definitions);
  const patchItem = (patch: { [Key in keyof UniversalItem]?: UniversalItem[Key] | undefined }) => setItem((current) => {
    const next = { ...current } as Record<string, unknown>;
    Object.entries(patch).forEach(([key, value]) => { if (value === undefined) delete next[key]; else next[key] = value; });
    return next as unknown as UniversalItem;
  });
  const patchSchedule = (patch: { [Key in keyof Schedule]?: Schedule[Key] | undefined }) => setItem((current) => {
    const schedule = { timezone: current.schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, ...current.schedule } as Record<string, unknown>;
    Object.entries(patch).forEach(([key, value]) => { if (value === undefined) delete schedule[key]; else schedule[key] = value; });
    return { ...current, schedule: schedule as unknown as Schedule };
  });
  const patchRecurrence = (patch: Partial<NonNullable<UniversalItem['recurrence']>>) => setItem((current) => ({ ...current, recurrence: {
    rrule: current.recurrence?.rrule ?? 'FREQ=WEEKLY;INTERVAL=1', rdates: current.recurrence?.rdates ?? [], exdates: current.recurrence?.exdates ?? [],
    timezone: current.recurrence?.timezone ?? current.schedule?.timezone ?? 'UTC', activationOffset: current.recurrence?.activationOffset ?? 'P7D',
    closeAt: current.recurrence?.closeAt ?? 'next_activation', anchor: current.recurrence?.anchor ?? 'schedule', autoRenew: current.recurrence?.autoRenew ?? true, ...patch,
  } }));
  const rruleMap = () => new Map((item.recurrence?.rrule ?? 'FREQ=WEEKLY;INTERVAL=1').split(';').filter(Boolean).map((part) => { const [key, ...rest] = part.split('='); return [key!.toUpperCase(), rest.join('=')]; }));
  const updateRrule = (changes: Record<string, string | undefined>) => {
    const parts = rruleMap();
    Object.entries(changes).forEach(([key, value]) => { if (value) parts.set(key, value); else parts.delete(key); });
    patchRecurrence({ rrule: [...parts].map(([key, value]) => `${key}=${value}`).join(';') });
  };
  const repeatFrequency = rruleMap().get('FREQ') ?? 'WEEKLY';
  const repeatInterval = Number(rruleMap().get('INTERVAL') ?? 1);
  const repeatDays = (rruleMap().get('BYDAY') ?? '').split(',').filter(Boolean);
  const activation = parseFriendlyDuration(item.recurrence?.activationOffset);
  useEffect(() => { if (!jsonDirty) setJsonDraft(JSON.stringify(item, null, 2)); }, [item, jsonDirty]);

  const readImportedItem = (source: string): UniversalItem => {
    const parsed = JSON.parse(source) as unknown;
    if (parsed && typeof parsed === 'object' && (parsed as { format?: string }).format === 'utm-portable') {
      const portable = parsePortablePackage(source).package;
      if (!portable.items[0]) throw new Error('The package contains no items.');
      return portable.items[0];
    }
    return migrateItem(parsed, 'editor:json').value;
  };
  const applyJson = () => {
    setError('');
    try {
      const parsed = readImportedItem(jsonDraft);
      const existing = workspace.items[item.id];
      const next = clean(parsed);
      if (existing) {
        next.id = existing.id; next.schemaVersion = existing.schemaVersion;
        const mutable = next as UniversalItem & { createdWithAppId: string; createdWithAppName: string; createdWithVersion: string };
        mutable.createdWithAppId = existing.createdWithAppId; mutable.createdWithAppName = existing.createdWithAppName;
        mutable.createdWithVersion = existing.createdWithVersion; next.createdAt = existing.createdAt;
        next.updatedAt = existing.updatedAt; next.revision = existing.revision;
        if (existing.deletedAt) next.deletedAt = existing.deletedAt; else delete next.deletedAt;
        if (existing.role === 'occurrence') { next.role = existing.role; next.occurrence = clean(existing.occurrence!); }
      }
      setItem(next); setTags(next.tags.join(', ')); setContexts(next.contexts.join(', ')); setRecurring(next.role === 'series_template');
      setJsonDirty(false); setJsonDraft(JSON.stringify(next, null, 2));
    } catch (reason) { setError(`JSON was not applied: ${reason instanceof Error ? reason.message : String(reason)}`); }
  };
  const importAsNew = async (file: File) => {
    try {
      const imported = clean(readImportedItem(await file.text())); const now = new Date().toISOString();
      imported.id = createId(); imported.createdAt = now; imported.updatedAt = now; imported.revision = 1; delete imported.deletedAt;
      if (imported.role === 'occurrence') { imported.role = 'standalone'; delete imported.occurrence; }
      setItem(imported); setTags(imported.tags.join(', ')); setContexts(imported.contexts.join(', ')); setRecurring(imported.role === 'series_template'); setJsonDraft(JSON.stringify(imported, null, 2)); setJsonDirty(false); setError('');
    } catch (reason) { setError(`Could not import item: ${reason instanceof Error ? reason.message : String(reason)}`); }
    finally { if (importJsonRef.current) importJsonRef.current.value = ''; }
  };
  const exportItemJson = () => {
    if (!confirmPlaintextDownload()) return;
    const portable = createPortablePackage(workspace, { kind: 'items', items: collectItemDependencies(workspace, [item]), selection: { type: 'single_item', itemId: item.id } });
    downloadText(serializePortablePackage(portable), `${safeFilename(item.title)}.utm-items.json`);
  };

  const save = () => {
    setError('');
    try {
      if (!item.title.trim()) throw new Error('Add a title before saving.');
      let result = { ...item, title: item.title.trim(), tags: commaList(tags), contexts: commaList(contexts), updatedAt: new Date().toISOString(), revision: item.revision + (workspace.items[item.id] ? 1 : 0) };
      const existing = workspace.items[item.id];
      if (existing) {
        result.createdWithAppId = existing.createdWithAppId;
        result.createdWithAppName = existing.createdWithAppName;
        result.createdWithVersion = existing.createdWithVersion;
      }
      if (recurring) {
        const anchor = result.schedule?.startAt ?? result.schedule?.dueAt;
        if (!anchor) throw new Error('A recurring item needs a Start or Due date.');
        result = { ...result, schedule: { ...result.schedule!, startAt: anchor } };
        result = makeSeries(result, result.recurrence?.rrule ?? 'FREQ=WEEKLY;INTERVAL=1', {
          ...result.recurrence,
          activationOffset: result.recurrence?.activationOffset ?? 'P7D',
        });
      }
      if (!recurring) { result.role = 'standalone'; delete result.recurrence; }
      removeDuplicateReminders(result);
      onSave(clean(result));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="drawer" role="dialog" aria-modal="true" aria-label="Item editor">
      <header className="drawer-head"><div><p className="eyebrow">UNIVERSAL ITEM</p><h2>{workspace.items[item.id] ? 'Edit item' : 'New item'}</h2></div><button className="icon-button" aria-label="Close item editor" onClick={onClose}><CloseIcon /></button></header>
      <div className="editor-scroll">
        <label>Title<input autoFocus value={item.title} onChange={(event) => patchItem({ title: event.target.value })} /></label>
        <div className="segmented" aria-label="Preset">{(['task', 'event', 'habit', 'blank'] as ItemPreset[]).map((preset) => <button className={item.preset === preset ? 'active' : ''} key={preset} onClick={() => patchItem({ preset })}>{preset}</button>)}</div>
        <label>Description <span className="hint">Markdown</span><textarea rows={5} value={item.bodyMarkdown} onChange={(event) => patchItem({ bodyMarkdown: event.target.value })} placeholder="Context, links, checklists…" /></label>
        {item.bodyMarkdown && <details><summary>Markdown preview</summary><div className="markdown preview"><ReactMarkdown>{item.bodyMarkdown}</ReactMarkdown></div></details>}
        <div className="form-grid three">
          <label>Status<select value={item.state} onChange={(event) => patchItem({ state: event.target.value as UniversalItem['state'] })}>{['open', 'done', 'cancelled', 'auto_closed', 'archived'].map((state) => <option key={state}>{state}</option>)}</select></label>
          <label>Priority<select value={item.priority ?? 0} onChange={(event) => patchItem({ priority: Number(event.target.value) as NonNullable<UniversalItem['priority']> })}>{([0, 1, 2, 3, 4] as NonNullable<UniversalItem['priority']>[]).map((priority) => <option key={priority} value={priority}>{priority ? `${priority} — ${priorityNames[priority]}` : 'None'}</option>)}</select></label>
          <label>Estimate<input value={item.schedule?.estimatedDuration ?? ''} onChange={(event) => patchSchedule({ estimatedDuration: event.target.value })} placeholder="PT45M" /></label>
        </div>
        <label>Tags<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="work, deep-focus" /></label>
        <label>Contexts<input value={contexts} onChange={(event) => setContexts(event.target.value)} placeholder="office, laptop" /></label>

        <details open={item.preset === 'event'}><summary>Schedule & deadline</summary><div className="details-body">
          <div className="form-grid two">
            <label>Available from<input type="datetime-local" value={dateInput(item.schedule?.availableFrom)} onInput={(event) => patchSchedule({ availableFrom: fromDateInput(event.currentTarget.value) })} /></label>
            <label>Start<input type="datetime-local" value={dateInput(item.schedule?.startAt)} onInput={(event) => patchSchedule({ startAt: fromDateInput(event.currentTarget.value) })} /></label>
            <label>End<input type="datetime-local" value={dateInput(item.schedule?.endAt)} onInput={(event) => patchSchedule({ endAt: fromDateInput(event.currentTarget.value) })} /></label>
            <label>Due<input type="datetime-local" value={dateInput(item.schedule?.dueAt)} onInput={(event) => patchSchedule({ dueAt: fromDateInput(event.currentTarget.value) })} /></label>
          </div>
          <label>Timezone<input value={item.schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone} onChange={(event) => patchSchedule({ timezone: event.target.value })} /></label>
        </div></details>

        <details open={recurring}><summary>Recurrence & auto-renew</summary><div className="details-body">
          <label className="check"><input type="checkbox" checked={recurring} onChange={(event) => setRecurring(event.target.checked)} /> Make this a recurring series</label>
          {recurring && <>
            <div className="form-grid two"><label>Repeat<select aria-label="Repeat frequency" value={repeatFrequency} onChange={(event) => updateRrule({ FREQ: event.target.value, BYDAY: event.target.value === 'WEEKLY' ? (repeatDays.join(',') || undefined) : undefined })}><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option><option value="YEARLY">Yearly</option></select></label><label>Every<input type="number" min="1" aria-label="Repeat interval" value={repeatInterval} onChange={(event) => updateRrule({ INTERVAL: String(Math.max(1, Number(event.target.value) || 1)) })} /><span className="field-suffix">{repeatFrequency === 'DAILY' ? 'day(s)' : repeatFrequency === 'WEEKLY' ? 'week(s)' : repeatFrequency === 'MONTHLY' ? 'month(s)' : 'year(s)'}</span></label></div>
            {repeatFrequency === 'WEEKLY' && <div className="weekday-picker" aria-label="Repeat on weekdays">{[['MO', 'M'], ['TU', 'T'], ['WE', 'W'], ['TH', 'T'], ['FR', 'F'], ['SA', 'S'], ['SU', 'S']].map(([value, label]) => <button className={repeatDays.includes(value!) ? 'active' : ''} aria-label={`Repeat on ${value}`} key={value} onClick={() => { const days = repeatDays.includes(value!) ? repeatDays.filter((day) => day !== value) : [...repeatDays, value!]; updateRrule({ BYDAY: days.length ? days.join(',') : undefined }); }}>{label}</button>)}</div>}
            <div className="form-grid two"><label>Activate before<div className="duration-control"><input type="number" min="0" aria-label="Activation amount" value={activation.amount} onChange={(event) => patchRecurrence({ activationOffset: toIsoDuration(Math.max(0, Number(event.target.value) || 0), activation.unit) })} /><select aria-label="Activation unit" value={activation.unit} onChange={(event) => patchRecurrence({ activationOffset: toIsoDuration(activation.amount, event.target.value as FriendlyDurationUnit) })}><option value="minutes">Minutes</option><option value="hours">Hours</option><option value="days">Days</option><option value="weeks">Weeks</option></select></div></label>
            <label>Auto-close<select value={item.recurrence?.closeAt ?? 'next_activation'} onChange={(event) => patchRecurrence({ closeAt: event.target.value as NonNullable<UniversalItem['recurrence']>['closeAt'] })}><option value="next_activation">At next activation</option><option value="due">At due time</option><option value="never">Never</option></select></label></div>
            <label className="check"><input type="checkbox" checked={item.recurrence?.autoRenew ?? true} onChange={(event) => patchRecurrence({ autoRenew: event.target.checked })} /> Auto-close untouched cycles</label>
            <details className="advanced-recurrence"><summary>Advanced recurrence format</summary><div className="details-body"><label>Repeat rule <span className="hint">RRULE — Recurrence Rule</span><input className="mono" value={item.recurrence?.rrule ?? 'FREQ=WEEKLY;INTERVAL=1'} onChange={(event) => patchRecurrence({ rrule: event.target.value })} /></label><label>Activation duration <span className="hint">ISO 8601</span><input className="mono" value={item.recurrence?.activationOffset ?? 'P7D'} onChange={(event) => patchRecurrence({ activationOffset: event.target.value })} /></label></div></details>
          </>}
        </div></details>

        <details open={item.preset === 'habit'}><summary>Progress & habit</summary><div className="details-body">
          <div className="form-grid three"><label>Mode<select value={item.progress?.mode ?? 'counter'} onChange={(event) => patchItem({ progress: { mode: event.target.value as 'counter', current: item.progress?.current ?? 0, target: item.progress?.target ?? 1 } })}><option>boolean</option><option>percent</option><option>counter</option></select></label>
          <label>Current<input type="number" value={item.progress?.current ?? 0} onChange={(event) => patchItem({ progress: { mode: item.progress?.mode ?? 'counter', current: Number(event.target.value), target: item.progress?.target ?? 1 } })} /></label>
          <label>Target<input type="number" value={item.progress?.target ?? 1} onChange={(event) => patchItem({ progress: { mode: item.progress?.mode ?? 'counter', current: item.progress?.current ?? 0, target: Number(event.target.value) } })} /></label></div>
          <label className="check"><input type="checkbox" checked={Boolean(item.habit)} onChange={(event) => patchItem({ habit: event.target.checked ? { target: item.progress?.target ?? 1, unit: 'times', streakMode: 'manual_only' } : undefined })} /> Track as a habit</label>
        </div></details>

        <details><summary>Reminders</summary><div className="details-body">
          {item.reminders.map((reminder, index) => <div className="inline-row" key={reminder.id}><input type="datetime-local" value={dateInput(reminder.at)} onInput={(event) => patchItem({ reminders: item.reminders.map((entry, at) => { if (at !== index) return entry; const next = { ...entry }; const value = fromDateInput(event.currentTarget.value); if (value) next.at = value; else delete next.at; return next; }) })} /><select value={reminder.urgency} onChange={(event) => patchItem({ reminders: item.reminders.map((entry, at) => at === index ? { ...entry, urgency: event.target.value as typeof entry.urgency } : entry) })}><option>normal</option><option>urgent</option><option>critical</option></select><button aria-label="Remove reminder" onClick={() => patchItem({ reminders: item.reminders.filter((_, at) => at !== index) })}><CloseIcon /></button></div>)}
          <button className="secondary" onClick={() => patchItem({ reminders: [...item.reminders, { id: createId(), mode: 'absolute', at: new Date(Date.now() + 3_600_000).toISOString(), urgency: 'normal', repeatUntilAcknowledged: false }] })}>+ Add reminder</button>
        </div></details>

        <details><summary>Relations & links</summary><div className="details-body">
          {item.relations.map((relation) => <div className="chip" key={relation.id}>{relation.type}: {workspace.items[relation.targetId]?.title ?? relation.targetId}<button aria-label="Remove relation" onClick={() => patchItem({ relations: item.relations.filter((entry) => entry.id !== relation.id) })}><CloseIcon /></button></div>)}
          <div className="inline-row"><select id="relation-target" defaultValue=""><option value="">Choose related item…</option>{Object.values(workspace.items).filter((candidate) => candidate.id !== item.id && !candidate.deletedAt).map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.title}</option>)}</select><button className="secondary" onClick={() => { const select = document.getElementById('relation-target') as HTMLSelectElement; if (select.value) patchItem({ relations: [...item.relations, { id: createId(), targetId: select.value, type: 'related' }] }); }}>Link</button></div>
          {item.attachments.map((attachment) => <div className="chip" key={attachment.id}><a href={attachment.url} target="_blank" rel="noreferrer">{attachment.title ?? attachment.url}</a><button aria-label="Remove link" onClick={() => patchItem({ attachments: item.attachments.filter((entry) => entry.id !== attachment.id) })}><CloseIcon /></button></div>)}
          <button className="secondary" onClick={() => { const url = window.prompt('Link URL'); if (url) patchItem({ attachments: [...item.attachments, { id: createId(), url }] }); }}>+ Add link</button>
        </div></details>

        {definitions.length > 0 && <details><summary>Custom fields</summary><div className="details-body">{definitions.map((field) => <label key={field.id}>{field.label}{field.kind === 'formula' ? <output className="formula-output">{String(formulas.values[field.key] ?? formulas.errors[field.key] ?? '—')}</output> : <input value={String(item.custom[field.key] ?? '')} onChange={(event) => patchItem({ custom: { ...item.custom, [field.key]: field.kind === 'number' ? Number(event.target.value) : field.kind === 'boolean' ? event.target.value === 'true' : event.target.value } })} />}</label>)}</div></details>}
        <details><summary>Item JSON</summary><div className="details-body json-editor"><p className="hint">Edit the same item draft as the form. Protected identity, provenance, timestamps and occurrence fields are preserved when updating an existing item.</p><CodeEditor language="json" ariaLabel="Item JSON" rows={18} value={jsonDraft} onChange={(value) => { setJsonDraft(value); setJsonDirty(true); }} /><div className="builder-actions"><button className="secondary compact-action" onClick={() => { setJsonDraft(JSON.stringify(item, null, 2)); setJsonDirty(false); }}>Refresh from form</button><button className="secondary compact-action" onClick={applyJson}>Apply JSON to form</button><button className="secondary compact-action" onClick={exportItemJson}>Export JSON</button><button className="secondary compact-action" onClick={() => importJsonRef.current?.click()}>Import JSON as new item</button><input ref={importJsonRef} hidden type="file" accept=".json,application/json" onChange={(event) => event.target.files?.[0] && void importAsNew(event.target.files[0])} /></div></div></details>
        <details><summary>System metadata</summary><div className="details-body metadata-grid"><div><span>Created at</span><output><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></output></div><div><span>Last modified</span><output><time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString()}</time></output></div><div><span>Created by application</span><output>{item.createdWithAppName} v{item.createdWithVersion}</output></div><div><span>Application ID</span><output className="mono">{item.createdWithAppId}</output></div><div><span>Item schema</span><output>{item.schemaVersion}</output></div><div><span>Item ID</span><output>{item.id}</output></div></div></details>
      </div>
      {error && <p className="editor-error error" role="alert">{error}</p>}
      <footer className="drawer-actions">{workspace.items[item.id] && <button className="danger" onClick={() => onDelete(item)}>Delete</button>}<span /><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" onClick={save}>Save item</button></footer>
    </section>
  </div>;
}

function ViewResults({ view, workspace, onEdit, onState }: {
  view: SavedView; workspace: WorkspaceDocument; onEdit: (item: UniversalItem) => void;
  onState: (item: UniversalItem, state: UniversalItem['state']) => void;
}) {
  const items = filteredItems(workspace, view);
  const visibleFields = view.fields ?? [];
  const fieldContent = (item: UniversalItem, omit: string[] = []) => <span className="renderer-fields">{visibleFields.filter((field) => !omit.includes(field)).map((field) => field === 'title' ? <strong key={field}>{item.title}</strong> : <span key={field}><small>{viewFieldLabel(workspace, field)}</small>{displayViewValue(readItemField(item, field, workspace), field)}</span>)}</span>;
  if (!items.length) return <p className="empty">No items match this view.</p>;
  if (view.renderer === 'calendar') {
    const dated = items.filter((item) => item.schedule?.startAt || item.schedule?.dueAt);
    return dated.length ? <div className="calendar-strip">{dated.map((item) => <article className={`calendar-item state-${item.state}`} key={item.id}><button className="state-toggle" aria-label={item.state === 'open' ? `Complete ${item.title}` : `Reopen ${item.title}`} onClick={() => onState(item, item.state === 'open' ? 'done' : 'open')}>{item.state === 'open' ? '' : '✓'}</button><button className="calendar-main" onClick={() => onEdit(item)}><time>{new Date(item.schedule?.startAt ?? item.schedule!.dueAt!).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</time>{fieldContent(item, ['schedule.startAt', 'schedule.dueAt'])}</button></article>)}</div> : <p className="empty">Matching items have no dates.</p>;
  }
  if (view.renderer === 'board') {
    return <div className="mini-board">{(['open', 'done', 'auto_closed', 'cancelled', 'archived'] as const).map((state) => <section key={state}><h4>{state.replace('_', ' ')}</h4>{items.filter((item) => item.state === state).map((item) => <article className={`board-item state-${item.state}`} key={item.id}><button className="state-toggle" aria-label={item.state === 'open' ? `Complete ${item.title}` : `Reopen ${item.title}`} onClick={() => onState(item, item.state === 'open' ? 'done' : 'open')}>{item.state === 'open' ? '' : '✓'}</button><button className="board-item-main" onClick={() => onEdit(item)}>{fieldContent(item, ['state'])}</button></article>)}</section>)}</div>;
  }
  if (view.renderer === 'table') {
    const fields = visibleFields.length ? visibleFields : ['title', 'state', 'schedule.dueAt', 'priority'];
    return <div className="table-wrap"><table><thead><tr><th className="state-column"><span className="sr-only">Complete</span></th>{fields.map((field) => <th key={field}>{viewFieldLabel(workspace, field)}</th>)}</tr></thead><tbody>{items.map((item) => <tr className={`state-${item.state}`} key={item.id} onClick={() => onEdit(item)}><td className="state-column"><button className="state-toggle" aria-label={item.state === 'open' ? `Complete ${item.title}` : `Reopen ${item.title}`} onClick={(event) => { event.stopPropagation(); onState(item, item.state === 'open' ? 'done' : 'open'); }}>{item.state === 'open' ? '' : '✓'}</button></td>{fields.map((field) => <td key={field}>{displayViewValue(readItemField(item, field, workspace), field)}</td>)}</tr>)}</tbody></table></div>;
  }
  return <div className="item-list">{items.map((item) => <ItemCard key={item.id} item={item} fields={visibleFields} workspace={workspace} onEdit={() => onEdit(item)} onState={(state) => onState(item, state)} />)}</div>;
}

function SavedViewSection({ view, workspace, onEditView, onEditItem, onState, onExport }: {
  view: SavedView; workspace: WorkspaceDocument; onEditView: () => void; onEditItem: (item: UniversalItem) => void;
  onState: (item: UniversalItem, state: UniversalItem['state']) => void;
  onExport: (mode: 'definition' | 'results' | 'bundle') => void;
}) {
  const [open, setOpen] = useState(true);
  return <details className="view-section" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="view-section-summary"><div><span className="view-renderer">{view.renderer}</span><h2>{view.name}</h2><code>{view.query.source.trim() || 'All items'}</code>{(view.sortSource || view.sort?.length) && <code className="sort-preview">Sort: {view.sortSource ?? view.sort.map((sort) => `${sort.field} ${sort.direction}`).join(' · ')}</code>}<p>{filteredItems(workspace, view).length} matching items</p></div><button className="secondary" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onEditView(); }}>Edit view</button></summary>
    <div className="view-section-body"><div className="view-export-actions"><span>Export</span><button onClick={() => onExport('definition')}>Definition</button><button onClick={() => onExport('results')}>Results</button><button onClick={() => onExport('bundle')}>Definition + results</button></div><ViewResults view={view} workspace={workspace} onEdit={onEditItem} onState={onState} /></div>
  </details>;
}

function ViewsPage({ workspace, commit, onEditItem, onState }: {
  workspace: WorkspaceDocument; commit: (message: string, mutation: (draft: WorkspaceDocument) => void) => void;
  onEditItem: (item: UniversalItem) => void; onState: (item: UniversalItem, state: UniversalItem['state']) => void;
}) {
  const [editing, setEditing] = useState<SavedView | null>(null);
  const [error, setError] = useState('');
  const [visualField, setVisualField] = useState('state');
  const [visualOperator, setVisualOperator] = useState('==');
  const [visualValue, setVisualValue] = useState('open');
  const [visualDirty, setVisualDirty] = useState(false);
  const [sortRules, setSortRules] = useState<ViewSortRule[]>([]);
  const [sortSource, setSortSource] = useState('');
  const [manualField, setManualField] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [viewJson, setViewJson] = useState('');
  const viewJsonRef = useRef<HTMLInputElement>(null);

  const literal = (value: string) => ['true', 'false', 'null'].includes(value) || (!Number.isNaN(Number(value)) && value.trim() !== '') ? value : JSON.stringify(value);
  const visualClause = () => `${visualField} ${visualOperator} ${literal(visualValue)}`;
  const visualOptions: Record<string, string[]> = {
    state: ['open', 'done', 'auto_closed', 'cancelled', 'archived'], preset: ['task', 'event', 'habit', 'blank'],
    role: ['standalone', 'series_template', 'occurrence'], priority: ['0', '1', '2', '3', '4'],
  };
  const beginEditing = (view: SavedView) => {
    const copy = clean(view);
    copy.fields ??= [];
    copy.sort ??= [];
    const source = copy.sortSource ?? serializeSortRules(copy.sort.map((sort) => ({ expression: sort.field, direction: sort.direction, nulls: sort.nulls ?? 'last' })));
    const firstClause = /^\s*([\w.]+)\s*(==|!=|>=|<=|>|<|in)\s*("(?:[^"\\]|\\.)*"|true|false|null|-?\d+(?:\.\d+)?)/.exec(copy.query.source);
    setEditing(copy);
    setVisualField(firstClause?.[1] ?? 'state');
    setVisualOperator(firstClause?.[2] ?? '==');
    if (firstClause?.[3]) {
      try { setVisualValue(String(JSON.parse(firstClause[3]))); }
      catch { setVisualValue(firstClause[3]); }
    } else setVisualValue('open');
    setVisualDirty(false);
    setSortSource(source);
    try { setSortRules(parseSortSource(source)); } catch { setSortRules([]); }
    setManualField('');
    setConfirmDelete(false);
    setViewJson(JSON.stringify(copy, null, 2));
    setError('');
  };
  const changeVisual = (part: 'field' | 'operator' | 'value', value: string) => {
    if (part === 'field') { setVisualField(value); if (visualOptions[value]?.length) setVisualValue(visualOptions[value]![0]!); }
    if (part === 'operator') setVisualOperator(value);
    if (part === 'value') setVisualValue(value);
    setVisualDirty(true);
  };
  const applyVisual = (join: 'replace' | 'and' | 'or') => {
    if (!editing) return;
    const clause = visualClause();
    const connector = join === 'and' ? '&&' : '||';
    setEditing({ ...editing, query: { source: join !== 'replace' && editing.query.source ? `${editing.query.source} ${connector} ${clause}` : clause } });
    setVisualDirty(false);
  };
  const updateSortRules = (next: ViewSortRule[]) => {
    setSortRules(next);
    setSortSource(serializeSortRules(next));
  };
  const updateSortRule = (index: number, patch: Partial<ViewSortRule>) => updateSortRules(sortRules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule));
  const moveSortRule = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= sortRules.length) return;
    const next = [...sortRules];
    [next[index], next[target]] = [next[target]!, next[index]!];
    updateSortRules(next);
  };
  const toggleField = (path: string) => {
    if (!editing) return;
    setEditing({ ...editing, fields: editing.fields.includes(path) ? editing.fields.filter((field) => field !== path) : [...editing.fields, path] });
  };
  const moveField = (index: number, offset: number) => {
    if (!editing) return;
    const target = index + offset;
    if (target < 0 || target >= editing.fields.length) return;
    const fields = [...editing.fields];
    [fields[index], fields[target]] = [fields[target]!, fields[index]!];
    setEditing({ ...editing, fields });
  };
  const save = () => {
    if (!editing) return;
    const result = visualDirty ? { ...editing, query: { source: visualClause() } } : editing;
    try {
      parseExpression(result.query.source.trim() || 'true');
      const parsedSort = parseSortSource(sortSource);
      compileSort(sortSource);
      const saved = { ...result, sortSource: serializeSortRules(parsedSort), sort: parsedSort.map((rule) => ({ field: rule.expression, direction: rule.direction, nulls: rule.nulls })) };
      commit('Save view', (draft) => { draft.views[result.id] = clean(saved); });
      setEditing(null);
      setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const newView = () => beginEditing({ id: createId(), name: 'New view', query: { source: 'state == "open"' }, renderer: 'list', sort: [{ field: 'updatedAt', direction: 'desc' }], fields: ['title', 'state'] });
  const applyViewJson = (source = viewJson) => {
    if (!editing) return;
    try {
      const raw = JSON.parse(source) as unknown;
      const imported = migrateView(raw && typeof raw === 'object' && (raw as { format?: string }).format === 'utm-portable' ? parsePortablePackage(source).package.views[0] : raw, 'editor:view-json').value;
      const next = { ...imported, id: editing.id };
      beginEditing(next); setViewJson(JSON.stringify(next, null, 2)); setError('');
    } catch (reason) { setError(`View JSON was not applied: ${reason instanceof Error ? reason.message : String(reason)}`); }
  };
  const importViewTemplate = async (file: File) => { try { const source = await file.text(); setViewJson(source); applyViewJson(source); } finally { if (viewJsonRef.current) viewJsonRef.current.value = ''; } };
  const exportView = (view: SavedView, mode: 'definition' | 'results' | 'bundle') => {
    if (!confirmPlaintextDownload()) return;
    const results = filteredItems(workspace, view); const dependencies = collectItemDependencies(workspace, results);
    const portable = createPortablePackage(workspace, {
      kind: mode === 'definition' ? 'views' : mode === 'results' ? 'items' : 'view_bundle',
      views: mode === 'results' ? [] : [view], items: mode === 'definition' ? [] : dependencies,
      selection: mode === 'definition' ? { type: 'view_definition', viewId: view.id, viewName: view.name } : { type: 'view_results', viewId: view.id, viewName: view.name },
      dependencyItemIds: dependencies.filter((item) => !results.some((result) => result.id === item.id)).map((item) => item.id),
    });
    downloadText(serializePortablePackage(portable), `${safeFilename(view.name)}-${mode}.json`);
  };

  return <section className="page-section">
    <div className="page-title"><div><p className="eyebrow">PROGRAMMABLE LISTS</p><h1>Views</h1><p>Every section below is a live result of its visual clauses or DSL expression.</p></div><button className="primary" onClick={newView}>+ New view</button></div>
    <div className="views-stack">{Object.values(workspace.views).map((view) => <SavedViewSection key={view.id} view={view} workspace={workspace} onEditView={() => beginEditing(view)} onEditItem={onEditItem} onState={onState} onExport={(mode) => exportView(view, mode)} />)}</div>
    {editing && <div className="modal-backdrop"><section className="dialog view-editor">
      <header><div><p className="dialog-kicker">SAVED VIEW</p><h2>Edit view</h2></div><button className="icon-button" aria-label="Close view editor" onClick={() => setEditing(null)}><CloseIcon /></button></header>
      <label>Name<input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label>
      <fieldset className="query-builder"><legend>Visual condition</legend>
        <div className="form-grid three">
          <label>Field<select value={visualField} onChange={(event) => changeVisual('field', event.target.value)}><option>state</option><option>preset</option><option>role</option><option>priority</option><option>schedule.dueAt</option><option>title</option></select></label>
          <label>Operator<select value={visualOperator} onChange={(event) => changeVisual('operator', event.target.value)}><option>==</option><option>!=</option><option>&gt;</option><option>&gt;=</option><option>&lt;</option><option>&lt;=</option><option>in</option></select></label>
          <label>Value{visualOptions[visualField] ? <select value={visualValue} onChange={(event) => changeVisual('value', event.target.value)}>{visualOptions[visualField]!.map((value) => <option key={value}>{value}</option>)}</select> : <input type={visualField === 'schedule.dueAt' ? 'datetime-local' : 'text'} list={visualField === 'title' ? 'view-title-values' : undefined} value={visualValue} onChange={(event) => changeVisual('value', event.target.value)} />}</label>
        </div>
        <datalist id="view-title-values">{[...new Set(Object.values(workspace.items).map((entry) => entry.title))].map((title) => <option value={title} key={title} />)}</datalist>
        <p className="builder-status">{visualDirty ? 'This condition will replace the DSL expression when you save.' : 'Visual condition and DSL are synchronized.'}</p>
        <div className="builder-actions"><button className="secondary compact-action" onClick={() => applyVisual('replace')}>Apply condition</button><button className="secondary compact-action" onClick={() => applyVisual('and')}>+ Add AND condition</button><button className="secondary compact-action" onClick={() => applyVisual('or')}>+ Add OR condition</button></div>
      </fieldset>
      <label className="dsl-field">DSL expression<span className="hint">Safe typed expression</span><CodeEditor language="dsl" ariaLabel="DSL expression" rows={5} value={editing.query.source} onChange={(value) => { setEditing({ ...editing, query: { source: value } }); setVisualDirty(false); }} /></label>
      <label>Renderer<select value={editing.renderer} onChange={(event) => setEditing({ ...editing, renderer: event.target.value as SavedView['renderer'] })}><option>list</option><option>table</option><option>calendar</option><option>board</option></select></label>
      <fieldset className="query-builder fields-builder"><legend>Displayed fields</legend>
        <p className="builder-status">Choose any item properties. Their order below is also their display order.</p>
        <div className="builder-actions"><button className="secondary compact-action" onClick={() => setEditing({ ...editing, fields: viewFieldOptions(workspace).map((field) => field.path) })}>Select all</button><button className="secondary compact-action" onClick={() => setEditing({ ...editing, fields: [] })}>Hide all</button></div>
        <div className="field-groups">{[...new Set(viewFieldOptions(workspace).map((field) => field.group))].map((group) => <details key={group}><summary>{group}</summary><div className="field-options">{viewFieldOptions(workspace).filter((field) => field.group === group).map((field) => <label className="check" key={field.path}><input type="checkbox" checked={editing.fields.includes(field.path)} onChange={() => toggleField(field.path)} />{field.label}<small>{field.path}</small></label>)}</div></details>)}</div>
        <div className="manual-field"><input aria-label="Custom field path" placeholder="Any path, e.g. custom.client" value={manualField} onChange={(event) => setManualField(event.target.value)} /><button className="secondary compact-action" disabled={!manualField.trim() || editing.fields.includes(manualField.trim())} onClick={() => { const path = manualField.trim(); setEditing({ ...editing, fields: [...editing.fields, path] }); setManualField(''); }}>+ Add path</button></div>
        {editing.fields.length > 0 && <div className="selected-fields"><span className="selected-fields-title">Display order</span>{editing.fields.map((field, index) => <div key={field}><code>{field}</code><div><button aria-label={`Move ${field} up`} disabled={index === 0} onClick={() => moveField(index, -1)}>↑</button><button aria-label={`Move ${field} down`} disabled={index === editing.fields.length - 1} onClick={() => moveField(index, 1)}>↓</button><button aria-label={`Hide ${field}`} onClick={() => toggleField(field)}><CloseIcon /></button></div></div>)}</div>}
      </fieldset>
      <fieldset className="query-builder sort-builder"><legend>Sorting</legend>
        <p className="builder-status">Rules run from top to bottom. Later rules break ties from earlier ones.</p>
        <datalist id="view-sort-fields">{viewFieldOptions(workspace).map((field) => <option value={field.path} key={field.path}>{field.label}</option>)}</datalist>
        <div className="sort-rules">{sortRules.map((rule, index) => <div className="sort-rule" key={`${index}-${rule.expression}`}>
          <label>Expression<input list="view-sort-fields" aria-label={`Sort expression ${index + 1}`} value={rule.expression} onChange={(event) => updateSortRule(index, { expression: event.target.value })} /></label>
          <label>Direction<select aria-label={`Sort direction ${index + 1}`} value={rule.direction} onChange={(event) => updateSortRule(index, { direction: event.target.value as ViewSortRule['direction'] })}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
          <label>Empty values<select aria-label={`Empty values ${index + 1}`} value={rule.nulls} onChange={(event) => updateSortRule(index, { nulls: event.target.value as ViewSortRule['nulls'] })}><option value="last">Last</option><option value="first">First</option></select></label>
          <div className="rule-order"><button className="secondary compact-action" aria-label={`Move sort ${index + 1} up`} disabled={index === 0} onClick={() => moveSortRule(index, -1)}>↑</button><button className="secondary compact-action" aria-label={`Move sort ${index + 1} down`} disabled={index === sortRules.length - 1} onClick={() => moveSortRule(index, 1)}>↓</button><button className="secondary compact-action" aria-label={`Remove sort ${index + 1}`} onClick={() => updateSortRules(sortRules.filter((_rule, ruleIndex) => ruleIndex !== index))}><CloseIcon /></button></div>
        </div>)}</div>
        <button className="secondary compact-action" onClick={() => updateSortRules([...sortRules, { expression: 'updatedAt', direction: 'desc', nulls: 'last' }])}>+ Add sort rule</button>
        <label className="dsl-field sort-dsl">Sort DSL<span className="hint">One rule per line. Expressions can use safe functions, for example: lower(title) asc nulls last</span><CodeEditor language="dsl" ariaLabel="Sort DSL" rows={4} value={sortSource} onChange={(source) => { setSortSource(source); try { setSortRules(parseSortSource(source)); } catch { /* Keep the text editable until save reports the exact error. */ } }} /></label>
      </fieldset>
      <fieldset className="query-builder json-editor"><legend>View JSON</legend><p className="builder-status">This is the complete SavedView draft. Imported JSON is applied as a template and keeps this view ID.</p><CodeEditor language="json" ariaLabel="View JSON" rows={16} value={viewJson} onChange={setViewJson} /><div className="builder-actions"><button className="secondary compact-action" onClick={() => setViewJson(JSON.stringify({ ...editing, sortSource, sort: sortRules.map((rule) => ({ field: rule.expression, direction: rule.direction, nulls: rule.nulls })) }, null, 2))}>Refresh from visual editor</button><button className="secondary compact-action" onClick={() => applyViewJson()}>Apply JSON</button><button className="secondary compact-action" onClick={() => viewJsonRef.current?.click()}>Import as template</button><input ref={viewJsonRef} hidden type="file" accept=".json,application/json" onChange={(event) => event.target.files?.[0] && void importViewTemplate(event.target.files[0])} /></div></fieldset>
      {error && <p className="error">{error}</p>}
      <footer><button className="danger" onClick={() => { if (!confirmDelete) { setConfirmDelete(true); return; } commit('Delete view', (draft) => { delete draft.views[editing.id]; Object.values(draft.dashboards).forEach((dashboard) => { for (let index = dashboard.widgets.length - 1; index >= 0; index -= 1) if (dashboard.widgets[index]?.viewId === editing.id) dashboard.widgets.splice(index, 1); }); }); setEditing(null); setConfirmDelete(false); }}>{confirmDelete ? 'Confirm delete' : 'Delete view'}</button><span /><button className="secondary" onClick={() => setEditing(null)}>Cancel</button><button className="primary" onClick={save}>Save view</button></footer>
    </section></div>}
  </section>;
}

function AutomationsPage({ workspace, commit }: { workspace: WorkspaceDocument; commit: (message: string, mutation: (draft: WorkspaceDocument) => void) => void }) {
  const [editing, setEditing] = useState<AutomationRule | null>(null);
  const [actions, setActions] = useState('[]');
  const [error, setError] = useState('');
  const edit = (rule: AutomationRule) => { setEditing(clean(rule)); setActions(JSON.stringify(rule.actions, null, 2)); };
  return <section className="page-section"><div className="page-title"><div><p className="eyebrow">IF → THEN, LOCALLY</p><h1>Automations</h1><p>Rules can change your workspace, but cannot run code or access the network.</p></div><button className="primary" onClick={() => edit({ id: createId(), name: 'New automation', enabled: true, trigger: { type: 'item.created' }, condition: { source: 'true' }, actions: [{ type: 'notify', title: 'Created', body: 'A new item was created' }], missedPolicy: 'run_each', maxDepth: 5, cooldownMs: 0 })}>+ New automation</button></div>
    <div className="automation-layout"><div className="rule-list">{Object.values(workspace.automations).map((rule) => <article className="rule-card" key={rule.id}><div><span className={`status-dot ${rule.enabled ? 'on' : ''}`} /><strong>{rule.name}</strong><small>{rule.trigger.type}</small></div><code>{rule.condition.source}</code>{rule.disabledReason && <p className="error">{rule.disabledReason}</p>}<footer><button className="secondary" onClick={() => commit('Toggle rule', (draft) => { draft.automations[rule.id]!.enabled = !draft.automations[rule.id]!.enabled; delete draft.automations[rule.id]!.disabledReason; })}>{rule.enabled ? 'Disable' : 'Enable'}</button><button className="secondary" onClick={() => edit(rule)}>Edit</button></footer></article>)}{!Object.keys(workspace.automations).length && <div className="empty-panel"><svg className="automation-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 2 4.5 13.2h7.3L11 22l8.5-11.2h-7.3L13 2Z" /></svg><h3>No automations yet</h3><p>Create a safe rule for repetitive work.</p></div>}</div><aside className="log-panel"><h3>Execution log</h3>{workspace.automationLog.slice(-20).reverse().map((entry) => <div className="log-line" key={entry.id}><span className={`status-dot ${entry.outcome === 'success' ? 'on' : entry.outcome === 'failed' ? 'bad' : ''}`} /><div><strong>{workspace.automations[entry.ruleId]?.name ?? 'Deleted rule'}</strong><small>{entry.outcome} · {new Date(entry.finishedAt).toLocaleString()}</small></div></div>)}{!workspace.automationLog.length && <p className="empty">Runs will appear here.</p>}</aside></div>
    {editing && <div className="modal-backdrop"><section className="dialog wide-dialog"><header><h2>Automation rule</h2><button className="icon-button" onClick={() => setEditing(null)}>×</button></header><label>Name<input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label><div className="form-grid two"><label>Trigger<select value={editing.trigger.type} onChange={(event) => setEditing({ ...editing, trigger: { type: event.target.value as AutomationRule['trigger']['type'] } })}>{['item.created', 'item.updated', 'status.changed', 'occurrence.activated', 'occurrence.boundary', 'reminder.due', 'time.schedule'].map((trigger) => <option key={trigger}>{trigger}</option>)}</select></label><label>Missed runs<select value={editing.missedPolicy} onChange={(event) => setEditing({ ...editing, missedPolicy: event.target.value as AutomationRule['missedPolicy'] })}><option value="run_each">Run each</option><option value="run_once">Run once</option><option value="skip">Skip</option></select></label></div>{editing.trigger.type === 'time.schedule' && <label>Schedule RRULE<input value={editing.trigger.rrule ?? 'FREQ=DAILY;BYHOUR=9'} onChange={(event) => setEditing({ ...editing, trigger: { ...editing.trigger, rrule: event.target.value } })} /></label>}<label>Condition DSL<input value={editing.condition.source} onChange={(event) => setEditing({ ...editing, condition: { source: event.target.value } })} /></label><label>Actions <span className="hint">allowlisted JSON</span><textarea className="code-area" rows={11} value={actions} onChange={(event) => setActions(event.target.value)} /></label><p className="hint">Actions: set_field, close, archive, create_item, add_relation, set_progress, add_reminder, notify.</p>{error && <p className="error">{error}</p>}<footer><button className="danger" onClick={() => { commit('Delete automation', (draft) => { delete draft.automations[editing.id]; }); setEditing(null); }}>Delete</button><span /><button className="secondary" onClick={() => setEditing(null)}>Cancel</button><button className="primary" onClick={() => { try { parseExpression(editing.condition.source || 'true'); const parsed = JSON.parse(actions) as AutomationAction[]; if (!Array.isArray(parsed)) throw new Error('Actions must be an array'); commit('Save automation', (draft) => { draft.automations[editing.id] = clean({ ...editing, actions: parsed }); }); setEditing(null); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } }}>Save rule</button></footer></section></div>}
  </section>;
}

function SettingsPage({ workspace, commit, onNotify, onTransfer, onImportJson }: {
  workspace: WorkspaceDocument; commit: (message: string, mutation: (draft: WorkspaceDocument) => void) => void;
  onNotify: () => void; onTransfer: () => void; onImportJson: (source: string) => void;
}) {
  const [field, setField] = useState<CustomFieldDefinition | null>(null);
  const jsonInput = useRef<HTMLInputElement>(null);
  const exportAll = () => {
    if (!confirmPlaintextDownload('This export contains every non-deleted item in readable plaintext JSON. Download it now?')) return;
    const items = Object.values(workspace.items).filter((item) => !item.deletedAt);
    downloadText(serializePortablePackage(createPortablePackage(workspace, { kind: 'items', items, selection: { type: 'all_items' } })), `${safeFilename(workspace.name)}-all-items.json`);
  };
  return <section className="page-section"><div className="page-title"><div><p className="eyebrow">SHAPE YOUR SYSTEM</p><h1>Settings</h1><p>Fields and capabilities belong to you, not to a hard-coded task type.</p></div></div>
    <div className="settings-columns"><section className="settings-card"><header><div><p className="eyebrow">DATA MODEL</p><h2>Custom fields</h2></div><button className="secondary" onClick={() => setField({ id: createId(), key: '', label: '', kind: 'text', required: false })}>+ Add</button></header>{Object.values(workspace.customFields).map((entry) => <button className="setting-row" key={entry.id} onClick={() => setField(clean(entry))}><span><strong>{entry.label}</strong><small>custom.{entry.key}</small></span><span>{entry.kind}</span></button>)}{!Object.keys(workspace.customFields).length && <p className="empty">No custom fields yet.</p>}</section>
    <section className="settings-card"><p className="eyebrow">PORTABILITY</p><h2>Move your data</h2><p>Encrypted Transfer is safe for complete workspace merge. Portable JSON is readable and supports add/copy import with preview.</p><div className="settings-actions"><button className="secondary" onClick={onTransfer}><LineIcon name="transfer"/> Encrypted Transfer</button><button className="secondary" onClick={exportAll}>Export all items JSON</button><button className="secondary" onClick={() => jsonInput.current?.click()}>Import items or views JSON</button><input ref={jsonInput} hidden type="file" accept=".json,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then(onImportJson); event.currentTarget.value = ''; }} /></div><hr/><p className="eyebrow">DEVICE</p><h2>Notifications</h2><p>While this local-only PWA is open, due reminders can use system notifications. Closed-app delivery is not guaranteed.</p><button className="secondary" onClick={onNotify}>Request permission</button><hr/><p className="eyebrow">APPLICATION</p><h2>{APP_NAME}</h2><dl><div><dt>Version</dt><dd>v{APP_VERSION}</dd></div><div><dt>Released</dt><dd><time dateTime={APP_RELEASED_AT}>{new Date(APP_RELEASED_AT).toLocaleString()}</time></dd></div></dl><hr/><p className="eyebrow">WORKSPACE</p><h2>{workspace.name}</h2><dl><div><dt>Schema</dt><dd>{workspace.schemaVersion}</dd></div><div><dt>Items</dt><dd>{Object.keys(workspace.items).length}</dd></div><div><dt>Workspace ID</dt><dd className="mono">{workspace.workspaceId}</dd></div></dl></section></div>
    {field && <div className="modal-backdrop"><section className="dialog"><header><h2>Custom field</h2><button className="icon-button" onClick={() => setField(null)}>×</button></header><label>Label<input value={field.label} onChange={(event) => setField({ ...field, label: event.target.value, key: field.key || event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_') })} /></label><label>Key<input value={field.key} pattern="[a-z][a-z0-9_]*" onChange={(event) => setField({ ...field, key: event.target.value })} /></label><label>Type<select value={field.kind} onChange={(event) => setField({ ...field, kind: event.target.value as CustomFieldDefinition['kind'] })}>{['text', 'number', 'boolean', 'date', 'datetime', 'duration', 'enum', 'multi_enum', 'url', 'item_ref', 'formula'].map((kind) => <option key={kind}>{kind}</option>)}</select></label>{field.kind === 'formula' && <label>Formula DSL<input value={field.formula ?? ''} onChange={(event) => setField({ ...field, formula: event.target.value })} placeholder="custom.rate * custom.hours" /></label>}<footer><button className="danger" onClick={() => { commit('Delete custom field', (draft) => { delete draft.customFields[field.id]; }); setField(null); }}>Delete</button><span/><button className="primary" disabled={!field.label || !/^[a-z][a-z0-9_]*$/.test(field.key)} onClick={() => { if (field.formula) parseExpression(field.formula); commit('Save custom field', (draft) => { draft.customFields[field.id] = clean(field); }); setField(null); }}>Save field</button></footer></section></div>}
  </section>;
}

function TransferDialog({ session, onMerged, onClose }: { session: UnlockedWorkspace; onMerged: (session: UnlockedWorkspace, message: string) => void; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const download = async () => {
    setBusy(true); setError('');
    try {
      const content = await exportContainer(session.document, password);
      const url = URL.createObjectURL(new Blob([content], { type: 'application/x-utm' }));
      const link = document.createElement('a'); link.href = url; link.download = `${session.document.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'workspace'}.utm`; link.click(); URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const importFile = async (file: File) => {
    setBusy(true); setError('');
    try { const result = await mergeIntoLocalWorkspace(session, await file.text(), password); onMerged(result.unlocked, `Merged ${result.changedItems} changed items`); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  return <div className="modal-backdrop"><section className="dialog"><header><h2>Encrypted transfer</h2><button className="icon-button" onClick={onClose}>×</button></header><p>Every exported file is encrypted. Use the same workspace password when merging on another device.</p><label>Workspace password<input type="password" minLength={10} value={password} onChange={(event) => setPassword(event.target.value)} /></label>{error && <p className="error">{error}</p>}<div className="transfer-actions"><button className="primary" disabled={password.length < 10 || busy} onClick={() => void download()}>Export encrypted .utm</button><button className="secondary" disabled={password.length < 10 || busy} onClick={() => input.current?.click()}>Merge from .utm</button><input ref={input} hidden type="file" accept=".utm,application/json" onChange={(event) => event.target.files?.[0] && void importFile(event.target.files[0])} /></div><p className="hint">Wrong passwords and modified containers are rejected before your local workspace changes.</p></section></div>;
}

export default function App() {
  const [boot, setBoot] = useState<'checking' | 'empty' | 'locked' | 'ready'>('checking');
  const [session, setSession] = useState<UnlockedWorkspace | null>(null);
  const [page, setPage] = useState<Page>('home');
  const [editor, setEditor] = useState<UniversalItem | null>(null);
  const [transfer, setTransfer] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [popupNoticeIds, setPopupNoticeIds] = useState<string[]>([]);
  const [noticeCenterOpen, setNoticeCenterOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [quick, setQuick] = useState('');
  const [portableImportSource, setPortableImportSource] = useState<string | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const seenNoticeIds = useRef(new Set<string>());
  const noticeTimers = useRef(new Map<string, number>());

  useEffect(() => { void hasLocalWorkspace().then((exists) => setBoot(exists ? 'locked' : 'empty')); }, []);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 3500); return () => window.clearTimeout(timer); }, [toast]);
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

  const activate = async (unlocked: UnlockedWorkspace) => {
    let notifications: Array<{ title: string; body: string; itemId?: string }> = [];
    const now = new Date();
    const migration = migrateWorkspace(clean(unlocked.document as WorkspaceDocument));
    const migratedDocument = Automerge.change(unlocked.document, 'Migrate workspace metadata and reminders', (draft) => {
      const workspace = draft as unknown as WorkspaceDocument;
      if (workspace.schemaVersion !== migration.value.schemaVersion) {
        const target = workspace as unknown as Record<string, unknown>;
        Object.keys(target).forEach((key) => { delete target[key]; });
        Object.entries(migration.value as unknown as Record<string, unknown>).forEach(([key, value]) => { target[key] = clean(value); });
      }
      backfillItemCreationVersions(workspace);
      Object.values(workspace.items).forEach(removeDuplicateReminders);
    });
    let reconciliation: ReconcileResult;
    try { reconciliation = await reconcileOffMainThread(migratedDocument as WorkspaceDocument, now); }
    catch { reconciliation = reconcileRecurrences(clean(migratedDocument as WorkspaceDocument), now); }
    const updated = Automerge.change(migratedDocument, 'Unlock reconciliation', (draft) => {
      const workspace = draft as unknown as WorkspaceDocument;
      reconciliation.created.forEach((item) => { if (!workspace.items[item.id]) workspace.items[item.id] = clean(item); });
      reconciliation.autoClosed.forEach((item) => { workspace.items[item.id] = clean(item); });
      const events: DomainEvent[] = reconciliation.created.map((item) => ({ id: createId(), type: 'occurrence.activated', at: now.toISOString(), itemId: item.id, after: clean(item), causationId: createId(), depth: 0 }));
      events.push(...collectScheduledEvents(workspace, now));
      notifications = runAutomationEvents(workspace, events, { now }).notifications;
    });
    const reminderGroups = new Map<string, { count: number; urgency: 'normal' | 'urgent' | 'critical' }>();
    const urgencyRank = { normal: 0, urgent: 1, critical: 2 } as const;
    for (const item of Object.values(updated.items)) {
      for (const reminder of item.reminders) {
        if (!reminder.acknowledgedAt && reminder.at && new Date(reminder.at) <= now) {
          const group = reminderGroups.get(item.id);
          if (!group) reminderGroups.set(item.id, { count: 1, urgency: reminder.urgency });
          else { group.count += 1; if (urgencyRank[reminder.urgency] > urgencyRank[group.urgency]) group.urgency = reminder.urgency; }
        }
      }
    }
    reminderGroups.forEach((group, itemId) => { const item = updated.items[itemId]; if (item) notifications.push({ title: item.title, body: `Reminder${group.count > 1 ? `s · ${group.count}` : ''} · ${group.urgency}`, itemId }); });
    await saveLocalWorkspace(updated, unlocked.dataKey);
    setSession({ ...unlocked, document: updated }); setBoot('ready');
    setNotices(notifications.map((notice) => ({ id: createId(), title: notice.title, body: notice.body, at: now.toISOString(), ...(notice.itemId ? { itemId: notice.itemId } : {}) })));
    if (Notification.permission === 'granted') notifications.forEach((notice) => new Notification(notice.title, { body: notice.body, ...(notice.itemId ? { tag: `reminder:${notice.itemId}` } : {}) }));
  };

  const workspace = session?.document as WorkspaceDocument | undefined;
  const commit = (message: string, mutation: (draft: WorkspaceDocument) => void) => {
    if (!session) return;
    const document = Automerge.change(session.document, message, (draft) => { mutation(draft as unknown as WorkspaceDocument); draft.updatedAt = new Date().toISOString(); });
    const next = { ...session, document };
    setSession(next);
    saveQueue.current = saveQueue.current.then(() => saveLocalWorkspace(document, session.dataKey)).catch((reason) => { setToast(`Save failed: ${String(reason)}`); });
  };

  const changeItemState = (item: UniversalItem, state: UniversalItem['state']) => commit('Change item state', (draft) => {
    const target = draft.items[item.id]; if (!target) return;
    target.state = state; target.updatedAt = new Date().toISOString(); target.revision += 1;
    if (state === 'open') delete target.closure;
    else target.closure = { at: target.updatedAt, actor: 'user', reason: state === 'cancelled' ? 'cancelled' : 'manual' };
    const event = { id: createId(), type: 'status.changed' as const, at: target.updatedAt, itemId: target.id, before: clean(item), after: clean(target as unknown as UniversalItem), causationId: createId(), depth: 0 };
    const result = runAutomationEvents(draft, [event]);
    if (result.notifications.length) setNotices((current) => [...current, ...result.notifications.map((notice) => ({ ...notice, id: createId(), at: new Date().toISOString() }))]);
  });
  const dismissPopupNotice = (id: string) => {
    const timer = noticeTimers.current.get(id);
    if (timer) window.clearTimeout(timer);
    noticeTimers.current.delete(id);
    setPopupNoticeIds((current) => current.filter((candidate) => candidate !== id));
  };
  const deleteNotice = (id: string) => {
    dismissPopupNotice(id);
    setNotices((current) => current.filter((notice) => notice.id !== id));
  };
  const openNoticeItem = (notice: Notice) => {
    const item = notice.itemId ? workspace?.items[notice.itemId] : Object.values(workspace?.items ?? {}).find((candidate) => candidate.title === notice.title);
    if (item) setEditor(item);
  };

  if (boot === 'checking') return <main className="splash"><div className="brand-mark">U</div><p>Opening encrypted workspace…</p></main>;
  if (boot === 'empty' || boot === 'locked') return <LockScreen exists={boot === 'locked'} onReady={(readySession) => void activate(readySession)} />;
  if (!workspace || !session) return null;

  const nav: Array<[Page, LineIconName, string]> = [['home', 'home', 'Home'], ['all', 'items', 'All items'], ['automations', 'rules', 'Automations'], ['settings', 'settings', 'Settings']];
  const openItems = Object.values(workspace.items).filter((item) => item.state === 'open' && item.role !== 'series_template' && !item.deletedAt).length;
  const captureQuickItem = () => {
    if (!quick.trim()) return;
    const item = createUiItem(quick.trim());
    commit('Quick capture', (draft) => { draft.items[item.id] = clean(item); runAutomationEvents(draft, [{ id: createId(), type: 'item.created', at: item.createdAt, itemId: item.id, after: clean(item), causationId: createId(), depth: 0 }]); });
    setQuick('');
  };

  return <div className="app-shell">
    <aside className="sidebar"><div className="sidebar-brand"><div className="brand-mark small">U</div><span>Universal</span></div><nav>{nav.map(([target, icon, label]) => <button key={target} className={page === target ? 'active' : ''} onClick={() => setPage(target)}><LineIcon name={icon}/><span>{label}</span>{target === 'all' && <b title={`${openItems} active ${openItems === 1 ? 'item' : 'items'}`}>{openItems}</b>}</button>)}</nav><div className="sidebar-bottom"><button onClick={() => setTransfer(true)}><LineIcon name="transfer"/><span>Transfer</span></button><button onClick={() => { lock(session); setSession(null); setBoot('locked'); }}><LineIcon name="lock"/><span>Lock</span></button></div></aside>
    <main className="content">
      <header className="topbar"><div><span className="mobile-brand">Universal</span><span className="sync-state"><i /> Encrypted locally</span></div><div className="top-actions"><button className="mobile-only-lock" aria-label="Lock" onClick={() => { lock(session); setSession(null); setBoot('locked'); }}><LineIcon name="lock"/></button><button className="notice-button" aria-label="Notifications" aria-expanded={noticeCenterOpen} onClick={() => { setNoticeCenterOpen((open) => !open); setPopupNoticeIds([]); }} title="Notifications"><LineIcon name="bell"/>{notices.length > 0 && <b>{notices.length}</b>}</button></div></header>
      {!noticeCenterOpen && popupNoticeIds.length > 0 && <div className="notice-tray notice-popups">{popupNoticeIds.slice(-3).reverse().map((id) => notices.find((notice) => notice.id === id)).filter((notice): notice is Notice => Boolean(notice)).map((notice) => <article className="notice-card" key={notice.id}><button className="notice-content" onClick={() => openNoticeItem(notice)}><strong>{notice.title}</strong><span>{notice.body}</span></button><button className="notice-dismiss" aria-label="Close notification" onClick={() => dismissPopupNotice(notice.id)}><CloseIcon /></button></article>)}</div>}
      {noticeCenterOpen && <aside className="notification-center" aria-label="Notification center"><header><h2>Notifications</h2><button className="icon-button" aria-label="Close notification center" onClick={() => setNoticeCenterOpen(false)}><CloseIcon /></button></header><div className="notification-list">{notices.length ? notices.slice().reverse().map((notice) => <article className="notice-card" key={notice.id}><button className="notice-content" onClick={() => openNoticeItem(notice)}><strong>{notice.title}</strong><span>{notice.body}</span></button><button className="notice-dismiss" aria-label="Delete notification" onClick={() => deleteNotice(notice.id)}><CloseIcon /></button></article>) : <p className="empty">No notifications</p>}</div></aside>}
      {page === 'home' && <><section className="page-section home-summary"><div className="home-hero"><div><p className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}</p><h1>{openItems ? `${openItems} active ${openItems === 1 ? 'item' : 'items'}` : 'Everything is clear'}</h1><p>Active means not completed, cancelled, archived, or automatically closed.</p></div></div></section><ViewsPage workspace={workspace} commit={commit} onEditItem={setEditor} onState={changeItemState} /></>}
      {page === 'all' && (() => { const recurringItems = Object.values(workspace.items).filter((item) => item.role === 'series_template' && !item.deletedAt); return <section className="page-section"><div className="page-title"><div><p className="eyebrow">EVERYTHING, WITHOUT SILOS</p><h1>All items</h1><p>Tasks, events and habits share one universal shape.</p></div><button className="primary" onClick={() => setEditor(createUiItem('', 'blank'))}>+ New item</button></div><div className="all-sections">{(['open', 'done', 'auto_closed', 'cancelled', 'archived'] as const).map((state) => { const items = Object.values(workspace.items).filter((item) => item.state === state && item.role !== 'series_template' && !item.deletedAt); return <details key={state} open={state === 'open' || state === 'auto_closed'}><summary><span>{stateNames[state]}</span><b>{items.length}</b></summary><div className="item-list">{items.map((item) => <ItemCard key={item.id} item={item} onEdit={() => setEditor(item)} onState={(nextState) => changeItemState(item, nextState)} />)}</div></details>; })}<details open={recurringItems.length > 0} className="recurring-items"><summary><span>Recurring items</span><b>{recurringItems.length}</b></summary><p className="section-help">These are the repeating source items. Each scheduled cycle appears separately in the status sections above.</p><div className="item-list">{recurringItems.length ? recurringItems.map((item) => <ItemCard key={item.id} item={item} onEdit={() => setEditor(item)} onState={(nextState) => changeItemState(item, nextState)} />) : <p className="empty">No recurring items yet.</p>}</div></details></div></section>; })()}
      {page === 'automations' && <AutomationsPage workspace={workspace} commit={commit} />}
      {page === 'settings' && <SettingsPage workspace={workspace} commit={commit} onTransfer={() => setTransfer(true)} onImportJson={setPortableImportSource} onNotify={() => void Notification.requestPermission().then((permission) => setToast(`Notification permission: ${permission}`))} />}
    </main>
    <div className="capture-dock"><div className="quick-capture"><input value={quick} onChange={(event) => setQuick(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && captureQuickItem()} placeholder="Add new task" aria-label="Add new task"/><button aria-label="Add task" disabled={!quick.trim()} onClick={captureQuickItem}>↵</button></div></div>
    <nav className="bottom-nav">{nav.map(([target, icon, label]) => <button aria-label={label} key={target} className={page === target ? 'active' : ''} onClick={() => setPage(target)}><LineIcon name={icon}/><span>{label === 'Automations' ? 'Rules' : label}</span></button>)}</nav>
    {editor && <ItemEditor initial={editor} workspace={workspace} onClose={() => setEditor(null)} onSave={(item) => { const isNew = !workspace.items[item.id]; commit(isNew ? 'Create item' : 'Update item', (draft) => { draft.items[item.id] = clean(item); const event = { id: createId(), type: isNew ? 'item.created' as const : 'item.updated' as const, at: item.updatedAt, itemId: item.id, after: clean(item), causationId: createId(), depth: 0 }; runAutomationEvents(draft, [event]); if (item.role === 'series_template') reconcileRecurrences(draft); }); setEditor(null); }} onDelete={(item) => { commit('Delete item', (draft) => { const target = draft.items[item.id]; if (target) { target.deletedAt = new Date().toISOString(); draft.tombstones[item.id] = target.deletedAt; } }); setEditor(null); }} />}
    {transfer && <TransferDialog session={session} onClose={() => setTransfer(false)} onMerged={(next, message) => { setSession(next); setToast(message); }} />}
    {portableImportSource && <PortableImportDialog workspace={workspace} source={portableImportSource} onClose={() => setPortableImportSource(null)} onApply={(preview) => { commit('Import portable JSON package', (draft) => { const result = applyPortableImport(draft, preview); setToast(`Imported ${result.addedItems + result.copiedItems} items and ${result.addedViews + result.copiedViews} views`); }); setPortableImportSource(null); }} />}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}
