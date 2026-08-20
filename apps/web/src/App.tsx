import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
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
import {
  APP_NAME, APP_RELEASED_AT, APP_VERSION, applyPortableImport, backfillItemCreationVersions, buildPortableImportPreview,
  collectItemDependencies, collectScheduledEvents, compileQuery, compileSort, createId, createItem, createPortablePackage,
  consolidateHabitOccurrences, evaluateFormulas, makeSeries, materializeProjectedOccurrence, migrateItem, migrateView, migrateWorkspace, moveCalendarItems,
  advanceCompletionAnchoredSeries, moveRecurringOccurrence, parseExpression, parsePortablePackage, parseSortSource, projectOccurrences, reconcileRecurrences,
  removeDuplicateReminders, resizeCalendarItem, restoreCalendarSchedules, runAutomationEvents, serializePortablePackage, serializeSortRules,
  createWorkspace, fromICS, packageToTabular, parseCsv, tabularToPackage, toCsv, toICS,
  type AutomationAction, type AutomationRule, type CustomFieldDefinition,
  type CalendarViewMode, type PortableImportPreview, type ProjectedOccurrence, type RecurrenceEditScope,
  type DomainEvent, type ItemPreset, type PortableSelection, type SavedView, type Schedule, type UniversalItem, type ViewSortRule, type WorkspaceDocument, type WorkspaceLanguage,
  type ReconcileResult,
} from '@utm/core';
import {
  createLocalWorkspace, exportContainer, hasLocalWorkspace, importAsLocalWorkspace, lock,
  mergeIntoLocalWorkspace, saveLocalWorkspace, unlockLocalWorkspace,
  type UnlockedWorkspace,
} from '@utm/sdk';

type Page = 'home' | 'calendar' | 'all' | 'automations' | 'settings';
type Notice = { id: string; title: string; body: string; at: string; itemId?: string; reminderIds?: string[] };

const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const dateInput = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromDateInput = (value: string) => (value ? new Date(value).toISOString() : undefined) as string;
const clockMinutes = (value: string) => { const [hours = 0, minutes = 0] = value.split(':').map(Number); return hours * 60 + minutes; };
const scheduledTheme = (lightAt: string, darkAt: string, now = new Date()) => {
  const minute = now.getHours() * 60 + now.getMinutes(); const light = clockMinutes(lightAt); const dark = clockMinutes(darkAt);
  if (light === dark) return 'light';
  return light < dark ? (minute >= light && minute < dark ? 'light' : 'dark') : (minute >= light || minute < dark ? 'light' : 'dark');
};
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
const isSleepTime = (date: Date, schedule: WorkspaceDocument['calendarPreferences']['sleepSchedule']) => {
  const minute = date.getHours() * 60 + date.getMinutes(); const wake = clockMinutes(schedule.wake); const sleep = clockMinutes(schedule.sleep);
  if (wake === sleep) return false;
  return sleep < wake ? minute >= sleep && minute < wake : minute >= sleep || minute < wake;
};
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
const parseEstimateDuration = (value?: string): { amount: number; unit: FriendlyDurationUnit } => {
  const timed = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(value ?? '');
  if (timed && (timed[1] || timed[2])) {
    const minutes = Number(timed[1] ?? 0) * 60 + Number(timed[2] ?? 0);
    return minutes % 60 === 0 ? { amount: minutes / 60, unit: 'hours' } : { amount: minutes, unit: 'minutes' };
  }
  return parseFriendlyDuration(value);
};
const createUiItem = (title = '', preset: ItemPreset = 'task', now = new Date()) => {
  const item = createItem(title, preset, now);
  item.schedule = { ...item.schedule, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, startAt: now.toISOString() };
  return item;
};
/** A preset is a display shortcut inferred from enabled item properties. */
function inferredPreset(item: UniversalItem): ItemPreset {
  if (item.habit) return 'habit';
  if (item.schedule?.startAt && (item.schedule.endAt || item.schedule.allDay)) return 'event';
  if (!item.title.trim() && !item.bodyMarkdown.trim() && !item.schedule?.startAt && !item.schedule?.dueAt && !item.tags.length && !item.contexts.length) return 'blank';
  return 'task';
}
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
  if (format === 'csv') { const data = packageToTabular(portable); const columns = [...new Set(data.items.flatMap((row) => Object.keys(row)).filter((column) => column !== 'utm_item_json'))]; downloadText(toCsv(data.items, columns), `${filename}.csv`, 'text/csv;charset=utf-8'); return; }
  if (format === 'xlsx') {
    const data = packageToTabular(portable); const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(data.items.map(({ utm_item_json: _metadata, ...row }) => row)), 'Items');
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

function SectionGuide({ title, children }: { title: string; children: ReactNode }) {
  return <details className="section-guide"><summary>{title}</summary><div>{children}</div></details>;
}

type LineIconName = 'home' | 'calendar' | 'items' | 'views' | 'rules' | 'settings' | 'lock' | 'bell' | 'transfer';
function LineIcon({ name }: { name: LineIconName }) {
  const paths: Record<LineIconName, ReactNode> = {
    home: <path d="m4.5 11.5 7.5-6 7.5 6V19h-15v-7.5Z"/>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></>,
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

function LockScreen({ exists, onReady }: { exists: boolean; onReady: (session: UnlockedWorkspace, language: WorkspaceLanguage) => Promise<void> }) {
  const [name, setName] = useState('My workspace');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [language, setLanguage] = useState<WorkspaceLanguage>(() => {
    const saved = window.localStorage.getItem('utm-interface-language') as WorkspaceLanguage | null;
    if (saved && interfaceLanguages.some((option) => option.value === saved)) return saved;
    const browserLanguage = navigator.language.slice(0, 2) as WorkspaceLanguage;
    return interfaceLanguages.some((option) => option.value === browserLanguage) ? browserLanguage : 'en';
  });
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { installDomLocalization(language); window.localStorage.setItem('utm-interface-language', language); }, [language]);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      if (!exists && password !== confirm) throw new Error('Passwords do not match');
      await onReady(exists ? await unlockLocalWorkspace(password) : await createLocalWorkspace(password, name, language), language);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };

  const importWorkspace = async (file: File) => {
    setBusy(true); setError('');
    try { await onReady(await importAsLocalWorkspace(await file.text(), password), language); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  return <main className="lock-shell">
    <section className="lock-card">
      <div className="brand-mark">U</div>
      <p className="eyebrow">UNIVERSAL TASK MANAGER</p>
      <h1>{exists ? 'Unlock your workspace' : 'Build your own system'}</h1>
      <p className="muted">Your data stays on this device, encrypted. There is no account and no password recovery. Please remember your password.</p>
      <label className="language-picker">Language<select value={language} onChange={(event) => setLanguage(event.target.value as WorkspaceLanguage)}>{interfaceLanguages.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
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
      <details className="install-guide">
        <summary>Install on your phone</summary>
        <div>
          <p><strong>iPhone or iPad:</strong> open this page in Safari, tap Share, then choose <em>Add to Home Screen</em>.</p>
          <p><strong>Android:</strong> open it in Chrome, tap the menu, then choose <em>Install app</em> or <em>Add to Home screen</em>.</p>
          <p>Each device has its own encrypted workspace. Use an encrypted <code>.utm</code> transfer file to move or merge your data between devices.</p>
          <hr />
          <p><strong>Background notifications on iPhone:</strong> first add Universal to the Home Screen and open it from there. In Settings, tap <em>Allow local notifications</em> if iOS has not granted permission yet. Then tap <em>Enable background delivery</em> and enter the notification access code supplied by the workspace owner. This second step is optional: without it, reminders remain local to the device.</p>
          <p>Background delivery is checked about every 15 minutes on the free service, so it is not an exact alarm. GitHub only hosts the app files; it does not receive your workspace or notification list. When detailed lock-screen content is selected, the push service temporarily receives the task title, Start, Deadline and reminder urgency needed to send the notification.</p>
        </div>
      </details>
    </section>
  </main>;
}

const priorityNames: Record<NonNullable<UniversalItem['priority']>, string> = { 0: 'None', 1: 'Low', 2: 'Medium', 3: 'High', 4: 'Urgent' };
const stateNames: Record<UniversalItem['state'], string> = { open: 'Active', done: 'Completed', auto_closed: 'Auto closed', cancelled: 'Cancelled', archived: 'Archived' };
const recentlyDoneUntil = new Map<string, number>();

type ViewFieldOption = { path: string; label: string; group: string };
const defaultBoardStates = ['open', 'done', 'auto_closed', 'cancelled', 'archived'] as const;
type BoardSettings = { states: Array<(typeof defaultBoardStates)[number]>; showEmpty: boolean; groupBy: 'status' | 'tag' };
const boardSettingsFor = (view: SavedView): BoardSettings => {
  const raw = view.extensions?.['utm:board'];
  const candidate = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const states = Array.isArray(candidate.states) ? candidate.states.filter((state): state is BoardSettings['states'][number] => typeof state === 'string' && defaultBoardStates.includes(state as BoardSettings['states'][number])) : [];
  return { states: states.length ? states : [...defaultBoardStates], showEmpty: candidate.showEmpty === true, groupBy: candidate.groupBy === 'tag' ? 'tag' : 'status' };
};
const builtInViewFields: ViewFieldOption[] = [
  { path: 'title', label: 'Title', group: 'Core' }, { path: 'bodyMarkdown', label: 'Description', group: 'Core' },
  { path: 'state', label: 'State', group: 'Core' }, { path: 'preset', label: 'Preset', group: 'Core' },
  { path: 'role', label: 'Role', group: 'Core' }, { path: 'priority', label: 'Priority', group: 'Core' },
  { path: 'tags', label: 'Tags', group: 'Core' }, { path: 'contexts', label: 'Contexts', group: 'Core' },
  { path: 'schedule.availableFrom', label: 'Available to work from', group: 'Schedule' }, { path: 'schedule.startAt', label: 'Event opens', group: 'Schedule' },
  { path: 'schedule.endAt', label: 'Event ends', group: 'Schedule' }, { path: 'schedule.dueAt', label: 'Due / Active range ends', group: 'Schedule' },
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
  { path: 'habit.streakMode', label: 'Habit streak mode', group: 'Progress & habit' }, { path: 'habit.completedDates', label: 'Habit completed dates', group: 'Progress & habit' },
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
const exampleViewFieldValue = (path: string): string => {
  if (path.startsWith('custom.')) return 'Example value';
  return ({
    title: 'Prepare quarterly review', bodyMarkdown: 'Outline, research and final draft', state: 'Active', preset: 'Task', role: 'Standalone', priority: 'High',
    tags: 'work, writing', contexts: 'office, laptop', 'schedule.availableFrom': 'Aug 24, 09:00', 'schedule.startAt': 'Aug 24, 10:00',
    'schedule.endAt': 'Aug 24, 11:30', 'schedule.dueAt': 'Aug 28, 18:00', 'schedule.estimatedDuration': '1 hour 30 min',
    'schedule.actualDuration': '1 hour 20 min', 'schedule.timezone': 'Europe/Moscow', 'schedule.allDay': 'No',
    'recurrence.rrule': 'Every week on Monday', 'recurrence.rdates': 'Sep 1, 10:00', 'recurrence.exdates': 'Sep 8, 10:00',
    'recurrence.timezone': 'Europe/Moscow', 'recurrence.activationOffset': '7 days before', 'recurrence.dueOffset': '8 hours after start',
    'recurrence.closeAt': 'Next activation', 'recurrence.anchor': 'Scheduled time', 'recurrence.autoRenew': 'Yes',
    'progress.mode': 'Counter', 'progress.current': '2', 'progress.target': '4', 'progress.unit': 'chapters',
    'habit.target': '1', 'habit.unit': 'time', 'habit.streakMode': 'Manual only', 'habit.completedDates': 'Aug 18, Aug 19',
    reminders: 'Mon 09:00 · Thu 17:00', relations: 'Related: Project brief', attachments: 'Research link',
    'closure.at': 'Aug 28, 17:42', 'closure.actor': 'You', 'closure.reason': 'Completed', 'occurrence.seriesId': 'Weekly review',
    'occurrence.recurrenceId': 'Aug 24, 10:00', 'occurrence.sequence': '12', createdAt: 'Aug 12, 14:20', updatedAt: 'Today, 09:45',
    createdWithAppName: 'Universal Task Manager', createdWithVersion: APP_VERSION, createdWithAppId: 'dev.universal-task-manager',
    schemaVersion: '1.6.0', revision: '7', id: 'itm_example_20260824',
  } as Record<string, string>)[path] ?? 'Example value';
};
const readItemField = (item: UniversalItem, field: string, workspace?: WorkspaceDocument): unknown => {
  if (field.startsWith('custom.') && workspace) {
    const key = field.slice(7);
    const definition = Object.values(workspace.customFields).find((candidate) => candidate.key === key);
    if (definition?.kind === 'formula') return evaluateFormulas(item, Object.values(workspace.customFields)).values[key];
  }
  return field.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, item);
};
const displayViewValue = (value: unknown, field: string): string => {
  if (value === undefined || value === null || value === '') return '';
  if ((field.endsWith('At') || field.endsWith('Date') || field === 'createdAt' || field === 'updatedAt') && typeof value === 'string') {
    const date = new Date(value); if (!Number.isNaN(date.getTime())) return date.toLocaleString();
  }
  if (Array.isArray(value)) return value.length ? value.map((entry) => typeof entry === 'object' ? JSON.stringify(entry) : String(entry)).join(', ') : '';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
};

function ItemCard({ item, onEdit, onState, fields, workspace }: { item: UniversalItem; onEdit: () => void; onState: (state: UniversalItem['state']) => void; fields?: string[]; workspace?: WorkspaceDocument }) {
  const due = item.schedule?.dueAt ?? item.schedule?.startAt;
  const today = new Date().toISOString().slice(0, 10);
  const isHabit = Boolean(item.habit);
  const habitCompletedToday = isHabit && Boolean(item.habit?.completedDates?.includes(today));
  const visiblyClosed = isHabit ? habitCompletedToday : item.state !== 'open';
  const customDisplay = fields !== undefined;
  const metadataFields = (fields?.filter((field) => field !== 'title' && field !== 'priority') ?? [])
    .map((field) => ({ field, value: displayViewValue(readItemField(item, field, workspace), field) }));
  return <article className={`item-card state-${item.state}`}>
    <button className="state-toggle" aria-label={isHabit ? (habitCompletedToday ? 'Undo habit completion today' : 'Complete habit today') : item.state === 'open' ? 'Complete item' : 'Reopen item'} onClick={() => onState(visiblyClosed ? 'open' : 'done')}>
      {visiblyClosed ? '✓' : ''}
    </button>
    <button className="item-main" onClick={onEdit}>
      {(!customDisplay || fields?.includes('title')) && <span className="item-title">{item.title}</span>}
      {!customDisplay && <span className="item-meta"><span className={`preset ${inferredPreset(item)}`}>{inferredPreset(item)}</span>{due && <span>{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: item.schedule?.allDay ? undefined : '2-digit', minute: item.schedule?.allDay ? undefined : '2-digit' }).format(new Date(due))}</span>}{item.schedule?.estimatedDuration && <span>{item.schedule.estimatedDuration}</span>}{item.tags.slice(0, 2).map((tag) => <span key={tag}>#{tag}</span>)}{item.closure?.reason === 'auto_renew' && <span className="auto-pill">auto-closed</span>}</span>}
      {customDisplay && metadataFields.length > 0 && <span className="view-item-fields">{metadataFields.map(({ field, value }) => <span key={field}>{value && <small>{viewFieldLabel(workspace!, field)}</small>}{value}</span>)}</span>}
    </button>
    {item.priority && (!customDisplay || fields?.includes('priority')) ? <button className={`priority p${item.priority}`} title={`Priority ${item.priority}: ${priorityNames[item.priority]}. Click to edit.`} aria-label={`Priority ${item.priority}: ${priorityNames[item.priority]}. Edit item`} onClick={onEdit}>{priorityNames[item.priority]}</button> : null}
  </article>;
}

function DeletedItemsList({ items, onRestore }: { items: UniversalItem[]; onRestore: (item: UniversalItem) => void }) {
  const sorted = [...items].sort((left, right) => new Date(right.deletedAt!).getTime() - new Date(left.deletedAt!).getTime());
  return <details className="trash-section" open={sorted.length > 0}>
    <summary><span>Trash</span><b>{sorted.length}</b></summary>
    <p className="section-help">Deleted items stay here until you restore them.</p>
    <div className="trash-list">{sorted.length ? sorted.map((item) => <article className="trash-item" key={item.id}>
      <div><span className="trash-title">{item.title || 'Untitled'}</span><span className="item-meta"><span className={`preset ${item.preset}`}>{item.preset}</span><span>{stateNames[item.state]}</span><span>Deleted {new Date(item.deletedAt!).toLocaleString()}</span></span></div>
      <button className="secondary compact-action" aria-label={`Restore ${item.title || 'Untitled'}`} onClick={() => onRestore(item)}>Restore</button>
    </article>) : <p className="empty">Trash is empty.</p>}</div>
  </details>;
}

/** Extra system collections. They are intentionally read-only for now; Views will make them configurable later. */
function AllItemsCollections({ items, onEdit, onState }: { items: UniversalItem[]; onEdit: (item: UniversalItem) => void; onState: (item: UniversalItem, state: UniversalItem['state']) => void }) {
  const now = Date.now();
  const collections = [
    { name: 'Overdue', help: 'Open items whose deadline has passed.', items: items.filter((item) => item.state === 'open' && item.schedule?.dueAt && new Date(item.schedule.dueAt).getTime() < now) },
    { name: 'Unscheduled', help: 'Open items without a scheduled time or deadline.', items: items.filter((item) => item.state === 'open' && !item.schedule?.startAt && !item.schedule?.dueAt) },
    { name: 'With reminders', help: 'Items that still have at least one active reminder.', items: items.filter((item) => item.reminders.some((reminder) => !reminder.acknowledgedAt)) },
  ];
  return <details className="all-item-collections">
    <summary><span>Planning &amp; attention</span><b>{collections.reduce((total, collection) => total + collection.items.length, 0)}</b></summary>
    <p className="section-help">Useful system collections. An item can appear here and in its status section; custom categories will come later through Views.</p>
    {collections.map((collection) => <details key={collection.name} open={collection.name === 'Overdue' && collection.items.length > 0}>
      <summary><span>{collection.name}</span><b>{collection.items.length}</b></summary>
      <p className="section-help">{collection.help}</p>
      <div className="item-list">{collection.items.length ? collection.items.map((item) => <ItemCard key={item.id} item={item} onEdit={() => onEdit(item)} onState={(state) => onState(item, state)} />) : <p className="empty">None.</p>}</div>
    </details>)}
  </details>;
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

function filteredItems(workspace: WorkspaceDocument, view?: SavedView, now = new Date()): UniversalItem[] {
  const templateFilterRequested = Boolean(view && /\bisTemplate\b/.test(view.query.source));
  const available = Object.values(workspace.items).filter((item) => !item.deletedAt && (templateFilterRequested || !isItemTemplate(item)) && !(item.role === 'occurrence' && item.occurrence?.seriesId && workspace.items[item.occurrence.seriesId]?.habit));
  let items: UniversalItem[];
  if (view) {
    try {
      const predicate = compileQuery(view.query.source || 'true', (item) => relationContext(workspace, item));
      const matchingRows = available.filter((item) => {
        const visibleByQuery = item.role !== 'series_template' ? predicate(item, now) : Boolean(item.habit) && predicate({ ...item, role: 'standalone' }, now);
        const grace = item.state === 'done' && (recentlyDoneUntil.get(item.id) ?? 0) > now.getTime();
        return visibleByQuery || grace;
      });
      const matchingSeries = available.filter((item) => item.role === 'series_template' && !item.habit && predicate(item, now));
      const standalone = matchingRows.filter((item) => item.role !== 'occurrence');
      const occurrencesBySeries = new Map<string, UniversalItem[]>();
      matchingRows.filter((item) => item.role === 'occurrence').forEach((item) => {
        const seriesId = item.occurrence?.seriesId ?? item.id;
        occurrencesBySeries.set(seriesId, [...(occurrencesBySeries.get(seriesId) ?? []), item]);
      });
      const logicalOccurrences = [...occurrencesBySeries.values()].map((occurrences) => [...occurrences].sort((left, right) => {
        if (left.state === 'open' && right.state !== 'open') return -1;
        if (right.state === 'open' && left.state !== 'open') return 1;
        return new Date(right.occurrence?.recurrenceId ?? right.updatedAt).getTime() - new Date(left.occurrence?.recurrenceId ?? left.updatedAt).getTime();
      })[0]!);
      // A recurring series and one of its occurrences are two storage records
      // for one logical item. Prefer the matching occurrence; use the series
      // itself only when no occurrence satisfies this view.
      items = [...standalone, ...logicalOccurrences, ...matchingSeries.filter((series) => !logicalOccurrences.some((item) => item.occurrence?.seriesId === series.id))];
    }
    catch { return []; }
    const sortSource = view.sortSource ?? (view.sort ?? []).map((sort) => `${sort.field} ${sort.direction} nulls ${sort.nulls ?? 'last'}`).join('\n');
    if (sortSource.trim()) items.sort((left, right) => compileSort(sortSource)(left, right, now));
  } else items = available.filter((item) => item.role !== 'series_template');
  return items;
}

function isHabitOccurrence(workspace: WorkspaceDocument, item: UniversalItem): boolean {
  return item.role === 'occurrence' && Boolean(item.occurrence?.seriesId && workspace.items[item.occurrence.seriesId]?.habit);
}
function isItemTemplate(item: UniversalItem): boolean { return item.extensions?.['utm:template'] === true; }
function relationContext(workspace: WorkspaceDocument, item: UniversalItem) {
  const parents = new Map<string, string[]>();
  Object.values(workspace.items).forEach((candidate) => candidate.relations.filter((relation) => relation.type === 'parent').forEach((relation) => parents.set(relation.targetId, [...(parents.get(relation.targetId) ?? []), candidate.id])));
  const children = (id: string) => Object.values(workspace.items).filter((candidate) => candidate.relations.some((relation) => relation.type === 'parent' && relation.targetId === id)).map((candidate) => candidate.id);
  const distance = (start: string, next: (id: string) => string[]) => { const seen = new Set([start]); let frontier = [start]; for (let depth = 1; depth <= 3; depth += 1) { frontier = frontier.flatMap(next).filter((id) => !seen.has(id)); frontier.forEach((id) => seen.add(id)); if (frontier.length) return depth; } return 0; };
  const parentDepth = distance(item.id, (id) => parents.get(id) ?? []); const childDepth = distance(item.id, children);
  return { isSubtask: parentDepth > 0, isParent: childDepth > 0, parentDepth, childDepth };
}
function withoutTemplateMarker(item: UniversalItem): UniversalItem {
  const next = clean(item);
  if (next.extensions) {
    delete next.extensions['utm:template'];
    if (Object.keys(next.extensions).length === 0) delete next.extensions;
  }
  return next;
}

function ItemEditor({ initial, workspace, isNew = false, onSave, onDelete, onCreateSubtask, onToggleSubtask, onClose }: {
  initial: UniversalItem; workspace: WorkspaceDocument; isNew?: boolean; onSave: (item: UniversalItem) => void; onDelete: (item: UniversalItem) => void; onCreateSubtask: (title: string) => UniversalItem; onToggleSubtask: (id: string) => void; onClose: () => void;
}) {
  const [item, setItem] = useState(() => clean(initial));
  const [tags, setTags] = useState(item.tags.join(', '));
  const [contexts, setContexts] = useState(item.contexts.join(', '));
  const [recurring, setRecurring] = useState(item.role === 'series_template');
  const [timezoneOpen, setTimezoneOpen] = useState(false);
  const [error, setError] = useState('');
  const [jsonDraft, setJsonDraft] = useState(() => JSON.stringify(initial, null, 2));
  const [jsonDirty, setJsonDirty] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [isTemplate, setIsTemplate] = useState(Boolean(item.extensions?.['utm:template']));
  const templates = Object.values(workspace.items).filter((candidate) => !candidate.deletedAt && candidate.extensions?.['utm:template'] === true && candidate.id !== item.id);
  const applyTemplate = (template: UniversalItem) => {
    const identity = { id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt, revision: item.revision, createdWithAppId: item.createdWithAppId, createdWithAppName: item.createdWithAppName, createdWithVersion: item.createdWithVersion };
    const next = clean({ ...template, ...identity, state: 'open' as const, role: 'standalone' as const, extensions: { ...template.extensions } });
    const cleanNext = withoutTemplateMarker(next);
    setItem(cleanNext); setTags(cleanNext.tags.join(', ')); setContexts(cleanNext.contexts.join(', ')); setRecurring(false); setIsTemplate(false); setJsonDraft(JSON.stringify(cleanNext, null, 2)); setJsonDirty(false);
  };
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
  const activeRange = recurring && Boolean(item.recurrence?.autoRenew) && item.recurrence?.closeAt === 'due' && activation.amount === 0;
  const estimate = item.schedule?.estimatedDuration ? parseEstimateDuration(item.schedule.estimatedDuration) : { amount: 45, unit: 'minutes' as FriendlyDurationUnit };
  const knownTags = [...new Set(Object.values(workspace.items).flatMap((entry) => entry.tags))].sort((left, right) => left.localeCompare(right));
  const collectedTags = [...new Set([...knownTags, ...commaList(tags)])];
  const toggleTag = (tag: string) => setTags((current) => {
    const values = commaList(current);
    return (values.includes(tag) ? values.filter((value) => value !== tag) : [...values, tag]).join(', ');
  });
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
      const converted = await portableFromFile(file, workspace);
      const imported = clean(readImportedItem(converted.source)); const now = new Date().toISOString();
      imported.id = createId(); imported.createdAt = now; imported.updatedAt = now; imported.revision = 1; delete imported.deletedAt;
      if (imported.role === 'occurrence') { imported.role = 'standalone'; delete imported.occurrence; }
      setItem(imported); setTags(imported.tags.join(', ')); setContexts(imported.contexts.join(', ')); setRecurring(imported.role === 'series_template'); setJsonDraft(JSON.stringify(imported, null, 2)); setJsonDirty(false); setError('');
    } catch (reason) { setError(`Could not import item: ${reason instanceof Error ? reason.message : String(reason)}`); }
    finally { if (importJsonRef.current) importJsonRef.current.value = ''; }
  };
  const exportItemJson = () => {
    exportPortable(workspace, packageForItems(workspace, [item], { type: 'single_item', itemId: item.id }), `${safeFilename(item.title)}.utm-items`, 'json');
  };
  const exportItem = (format: PortableFormat, metadata = false) => exportPortable(workspace, packageForItems(workspace, [item], { type: 'single_item', itemId: item.id }), `${safeFilename(item.title)}.utm-items`, format, metadata);

  const save = () => {
    setError('');
    try {
      if (!item.title.trim()) throw new Error('Add a title before saving.');
      let result = { ...item, title: item.title.trim(), tags: commaList(tags), contexts: commaList(contexts), updatedAt: new Date().toISOString(), revision: item.revision + (workspace.items[item.id] ? 1 : 0) };
      result = withoutTemplateMarker(result);
      result.extensions = { ...result.extensions };
      if (isTemplate) result.extensions['utm:template'] = true; else delete result.extensions['utm:template'];
      const existing = workspace.items[item.id];
      if (existing) {
        result.createdWithAppId = existing.createdWithAppId;
        result.createdWithAppName = existing.createdWithAppName;
        result.createdWithVersion = existing.createdWithVersion;
      }
      if (recurring) {
        const anchor = result.schedule?.startAt ?? result.schedule?.dueAt;
        if (!anchor) throw new Error('A recurring item needs a Scheduled start or Deadline.');
        if (activeRange && (!result.schedule?.startAt || !result.schedule?.dueAt)) throw new Error('Active range needs both Event opens and Due / Active range ends.');
        if (activeRange && result.recurrence?.rrule) result.recurrence = { ...result.recurrence, rrule: result.recurrence.rrule.replace(/;BYDAY=[^;]*/i, '') };
        result = { ...result, schedule: { ...result.schedule!, startAt: anchor } };
        result = makeSeries(result, result.recurrence?.rrule ?? 'FREQ=WEEKLY;INTERVAL=1', {
          ...result.recurrence,
          activationOffset: result.recurrence?.activationOffset ?? 'P7D',
        });
      }
      if (!recurring) { result.role = 'standalone'; delete result.recurrence; }
      if (result.state === 'done' || result.state === 'cancelled') {
        result.closure = { at: result.closure?.at ?? new Date().toISOString(), actor: result.closure?.actor ?? 'user', reason: result.state === 'cancelled' ? 'cancelled' : 'manual' };
      } else if (result.state === 'open') delete result.closure;
      if (result.habit) result.habit = { target: result.habit.target ?? result.progress?.target ?? 1, unit: result.habit.unit ?? 'times', streakMode: result.habit.streakMode ?? 'manual_only', completedDates: result.habit.completedDates ?? [] };
      result.preset = inferredPreset(result);
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
        <label className="item-title-field">Title<input autoFocus value={item.title} onChange={(event) => patchItem({ title: event.target.value })} placeholder="What needs to happen?" /></label>
        {isNew && templates.length > 0 && <details className="template-picker"><summary>Choose a saved template <span>Optional</span></summary><div className="details-body"><p className="schedule-explainer">Pick a template to prefill this new item. Nothing changes until you select one, and you can edit every field before saving.</p>{templates.map((template) => <button type="button" className="template-option" key={template.id} onClick={() => applyTemplate(template)}>{template.title || 'Untitled template'}</button>)}</div></details>}
        <label className="check template-toggle"><input type="checkbox" checked={isTemplate} onChange={(event) => setIsTemplate(event.target.checked)} /> Save this item as a template</label>
        <label>Description <span className="hint">Markdown</span><textarea rows={5} value={item.bodyMarkdown} onChange={(event) => patchItem({ bodyMarkdown: event.target.value })} placeholder="Context, links, checklists…" /></label>
        {item.bodyMarkdown && <details open><summary>Markdown preview</summary><div className="markdown preview"><ReactMarkdown>{item.bodyMarkdown}</ReactMarkdown></div></details>}
        <details open={item.relations.some((relation) => relation.type === 'parent')}><summary>Subtasks</summary><div className="details-body">
          <p className="schedule-explainer">Add existing items as steps of this item. Subtasks remain independent universal items and can be completed or edited on their own.</p>
          {item.relations.filter((relation) => relation.type === 'parent').map((relation) => { const subtask = workspace.items[relation.targetId]; const completed = subtask?.state === 'done'; return <div className={`subtask-row${completed ? ' completed' : ''}`} key={relation.id}><button type="button" className={`subtask-check${completed ? ' checked' : ''}`} aria-label={`${completed ? 'Reopen' : 'Complete'} subtask ${subtask?.title ?? relation.targetId}`} onClick={() => onToggleSubtask(relation.targetId)}>{completed ? '✓' : ''}</button><span>{subtask?.title ?? relation.targetId}</span><button type="button" aria-label="Remove subtask" onClick={() => patchItem({ relations: item.relations.filter((entry) => entry.id !== relation.id) })}><CloseIcon /></button></div>; })}
          <div className="inline-row"><input aria-label="New subtask title" value={newSubtaskTitle} onChange={(event) => setNewSubtaskTitle(event.target.value)} placeholder="New subtask title" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); const title = newSubtaskTitle.trim(); if (!title) return; const subtask = onCreateSubtask(title); patchItem({ relations: [...item.relations, { id: createId(), targetId: subtask.id, type: 'parent' }] }); setNewSubtaskTitle(''); } }} /><button className="secondary" onClick={() => { const title = newSubtaskTitle.trim(); if (!title) return; const subtask = onCreateSubtask(title); patchItem({ relations: [...item.relations, { id: createId(), targetId: subtask.id, type: 'parent' }] }); setNewSubtaskTitle(''); }}>Add subtask</button></div>
        </div></details>
        <details open><summary>Dates &amp; time</summary><div className="details-body">
          <p className="schedule-explainer">Scheduled time reserves a calendar block. A deadline is the latest completion time. Availability only says how early work may begin.</p>
          <SectionGuide title="Which date should I use?"><ul><li><strong>Event opens</strong> is when the item becomes active and starts its calendar block.</li><li><strong>Event ends</strong> is only the end of the calendar block.</li><li><strong>Due / Active range ends</strong> is the latest completion time and can close the active range.</li><li><strong>Available to work from</strong> is optional; it keeps reminders quiet before that time.</li></ul></SectionGuide>
          <details className="optional-field"><summary>Available to work from <span>Optional</span></summary><div className="details-body"><label><input aria-label="Available to work from" type="datetime-local" value={dateInput(item.schedule?.availableFrom)} onInput={(event) => patchSchedule({ availableFrom: fromDateInput(event.currentTarget.value) })} /><small>Earliest intended time to begin; not a deadline.</small></label></div></details>
          <div className="form-grid two schedule-grid">
            <label><span>Event opens</span><input aria-label="Event opens" type="datetime-local" value={dateInput(item.schedule?.startAt)} onInput={(event) => patchSchedule({ startAt: fromDateInput(event.currentTarget.value) })} /><small>When it begins and appears in the calendar.</small></label>
            <label><span>Event ends</span><input aria-label="Event ends" type="datetime-local" value={dateInput(item.schedule?.endAt)} onInput={(event) => patchSchedule({ endAt: fromDateInput(event.currentTarget.value) })} /><small>When the calendar block ends. Use with Event opens.</small></label>
            <label><span>Due / Active range ends</span><input aria-label="Due / Active range ends" type="datetime-local" value={dateInput(item.schedule?.dueAt)} onInput={(event) => patchSchedule({ dueAt: fromDateInput(event.currentTarget.value) })} /><small>Latest acceptable completion time.</small></label>
          </div>
          <div className="schedule-tools"><button className="timezone-button" aria-expanded={timezoneOpen} onClick={() => setTimezoneOpen((current) => !current)}><span>Timezone</span><strong>{item.schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}</strong><i aria-hidden>{timezoneOpen ? '−' : '+'}</i></button></div>
          {timezoneOpen && <div className="timezone-panel"><label>Timezone<input autoFocus list="iana-timezones" value={item.schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone} onChange={(event) => patchSchedule({ timezone: event.target.value })} /></label><small>Used for recurrence and daylight-saving calculations.</small><datalist id="iana-timezones">{typeof Intl.supportedValuesOf === 'function' && Intl.supportedValuesOf('timeZone').map((timezone) => <option value={timezone} key={timezone} />)}</datalist></div>}
        </div></details>

        <details open><summary>Reminders</summary><div className="details-body">
          <p className="schedule-explainer">Notifications can happen before or at any important moment, independently of the scheduled time and deadline.</p>
          <SectionGuide title="How reminders behave"><p>Use more than one reminder when needed. Due reminders for the same item are shown as one card with a count. Closing the pop-up only hides it; deleting it from Notifications confirms those reminders so they do not return after the next unlock.</p></SectionGuide>
          {item.reminders.map((reminder, index) => <div className="inline-row" key={reminder.id}><input aria-label={`Reminder ${index + 1} time`} type="datetime-local" value={dateInput(reminder.at)} onInput={(event) => patchItem({ reminders: item.reminders.map((entry, at) => { if (at !== index) return entry; const next = { ...entry }; const value = fromDateInput(event.currentTarget.value); if (value) next.at = value; else delete next.at; return next; }) })} /><select aria-label={`Reminder ${index + 1} urgency`} value={reminder.urgency} onChange={(event) => patchItem({ reminders: item.reminders.map((entry, at) => at === index ? { ...entry, urgency: event.target.value as typeof entry.urgency } : entry) })}><option>normal</option><option>urgent</option><option>critical</option></select><button aria-label="Remove reminder" onClick={() => patchItem({ reminders: item.reminders.filter((_, at) => at !== index) })}><CloseIcon /></button></div>)}
          <button className="secondary" onClick={() => patchItem({ reminders: [...item.reminders, { id: createId(), mode: 'absolute', at: item.schedule?.startAt ?? new Date().toISOString(), urgency: 'normal', repeatUntilAcknowledged: false }] })}>+ Add reminder</button>
        </div></details>

        <div className="form-grid two">
          <label>Priority<select value={item.priority ?? 0} onChange={(event) => patchItem({ priority: Number(event.target.value) as NonNullable<UniversalItem['priority']> })}>{([0, 1, 2, 3, 4] as NonNullable<UniversalItem['priority']>[]).map((priority) => <option key={priority} value={priority}>{priority ? `${priority} — ${priorityNames[priority]}` : 'None'}</option>)}</select></label>
          <label>Estimated duration<div className="duration-control"><input type="number" min="0" aria-label="Estimated duration amount" value={item.schedule?.estimatedDuration ? estimate.amount : ''} onChange={(event) => patchSchedule({ estimatedDuration: event.target.value ? toIsoDuration(Math.max(0, Number(event.target.value) || 0), estimate.unit) : undefined })} placeholder="45" /><select aria-label="Estimated duration unit" value={estimate.unit} onChange={(event) => patchSchedule({ estimatedDuration: toIsoDuration(estimate.amount, event.target.value as FriendlyDurationUnit) })}><option value="minutes">Minutes</option><option value="hours">Hours</option><option value="days">Days</option><option value="weeks">Weeks</option></select></div><small>How much time you expect this item to take.</small></label>
        </div>
        <label>Tags<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Add tags separated by commas" /></label>
        {collectedTags.length > 0 && <div className="tag-collection" aria-label="Available tags">{collectedTags.map((tag) => <button className={commaList(tags).includes(tag) ? 'active' : ''} key={tag} onClick={() => toggleTag(tag)}>#{tag}</button>)}</div>}
        <details open={item.state !== 'open'}><summary>Status</summary><div className="details-body"><label>Item status<select value={item.state} onChange={(event) => { const state = event.target.value as UniversalItem['state']; patchItem({ state, closure: state === 'open' ? undefined : { at: item.closure?.at ?? new Date().toISOString(), actor: item.closure?.actor ?? 'user', reason: state === 'cancelled' ? 'cancelled' : 'manual' } }); }}>{['open', 'done', 'cancelled', 'auto_closed', 'archived'].map((state) => <option key={state} value={state}>{stateNames[state as UniversalItem['state']]}</option>)}</select><small>Status normally changes through completion, cancellation, auto-renew or archiving.</small></label>{(item.state === 'done' || item.state === 'cancelled') && <label>Actually {item.state === 'done' ? 'completed' : 'cancelled'} at<input type="datetime-local" value={dateInput(item.closure?.at)} onInput={(event) => { const at = fromDateInput(event.currentTarget.value); if (at) patchItem({ closure: { at, actor: item.closure?.actor ?? 'user', reason: item.state === 'cancelled' ? 'cancelled' : 'manual' } }); }} /><small>Defaults to now. Change this when you are recording the item after it happened. For a completion-anchored series, the next cycle uses this time when this cycle is first closed.</small></label>}</div></details>
        <details open={commaList(contexts).length > 0}><summary>Contexts</summary><div className="details-body"><label>Contexts<input value={contexts} onChange={(event) => setContexts(event.target.value)} placeholder="office, laptop" /></label></div></details>

        <details open={recurring}><summary>Recurrence & auto-renew</summary><div className="details-body">
          <label className="check"><input type="checkbox" checked={recurring} onChange={(event) => setRecurring(event.target.checked)} /> Make this a recurring series</label>
          {recurring && <>
            <SectionGuide title="How recurring items work"><ul><li>A series is one source item; each cycle has its own history.</li><li><strong>Only show during the active range</strong> uses Event opens and Due: complete once during that period, then the next cycle waits until it opens.</li><li>Most weekly tasks only need Repeat and, optionally, the active range. Advanced settings are for unusual activation and auto-close rules.</li></ul></SectionGuide>
            <div className="form-grid two"><label>Repeat<select aria-label="Repeat frequency" value={repeatFrequency} onChange={(event) => updateRrule({ FREQ: event.target.value, BYDAY: event.target.value === 'WEEKLY' ? (repeatDays.join(',') || undefined) : undefined })}><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option><option value="YEARLY">Yearly</option></select></label><label>Every<input type="number" min="1" aria-label="Repeat interval" value={repeatInterval} onChange={(event) => updateRrule({ INTERVAL: String(Math.max(1, Number(event.target.value) || 1)) })} /><span className="field-suffix">{repeatFrequency === 'DAILY' ? 'day(s)' : repeatFrequency === 'WEEKLY' ? 'week(s)' : repeatFrequency === 'MONTHLY' ? 'month(s)' : 'year(s)'}</span></label></div>
            {!activeRange && repeatFrequency === 'WEEKLY' && <div className="weekday-picker" aria-label="Repeat on weekdays"><span className="field-hint">Choose days for regular repeating tasks or habits.</span>{[['MO', 'M'], ['TU', 'T'], ['WE', 'W'], ['TH', 'T'], ['FR', 'F'], ['SA', 'S'], ['SU', 'S']].map(([value, label]) => <button className={repeatDays.includes(value!) ? 'active' : ''} aria-label={`Repeat on ${value}`} key={value} onClick={() => { const days = repeatDays.includes(value!) ? repeatDays.filter((day) => day !== value) : [...repeatDays, value!]; updateRrule({ BYDAY: days.length ? days.join(',') : undefined }); }}>{label}</button>)}</div>}
            <label className="active-window-toggle"><input type="checkbox" checked={activeRange} onChange={(event) => { if (event.target.checked) updateRrule({ BYDAY: undefined }); patchRecurrence(event.target.checked ? { activationOffset: 'PT0M', closeAt: 'due', autoRenew: true } : { closeAt: 'next_activation' }); }} /><span><strong>Only show during the active range</strong><small>Complete once between Event opens and Due / Active range ends. Outside that range, no active item is shown. The opening date supplies the weekly cycle day.</small></span></label>
            {activeRange && <div className={`active-window-summary ${item.schedule?.startAt && item.schedule?.dueAt ? '' : 'incomplete'}`}><span><small>Event opens</small>{item.schedule?.startAt ? new Date(item.schedule.startAt).toLocaleString() : 'Set Event opens'}</span><span><small>Active range ends</small>{item.schedule?.dueAt ? new Date(item.schedule.dueAt).toLocaleString() : 'Set Due'}</span></div>}
            <details className="advanced-recurrence"><summary>Advanced recurrence behavior</summary><div className="details-body"><div className="form-grid two"><label>Activate before<div className="duration-control"><input type="number" min="0" aria-label="Activation amount" value={activation.amount} onChange={(event) => patchRecurrence({ activationOffset: toIsoDuration(Math.max(0, Number(event.target.value) || 0), activation.unit) })} /><select aria-label="Activation unit" value={activation.unit} onChange={(event) => patchRecurrence({ activationOffset: toIsoDuration(activation.amount, event.target.value as FriendlyDurationUnit) })}><option value="minutes">Minutes</option><option value="hours">Hours</option><option value="days">Days</option><option value="weeks">Weeks</option></select></div></label><label>Auto-close<select value={item.recurrence?.closeAt ?? 'next_activation'} onChange={(event) => patchRecurrence({ closeAt: event.target.value as NonNullable<UniversalItem['recurrence']>['closeAt'] })}><option value="next_activation">At next activation</option><option value="due">At due time</option><option value="never">Never</option></select></label></div><label>Next cycle starts from<select value={item.recurrence?.anchor ?? 'schedule'} onChange={(event) => patchRecurrence({ anchor: event.target.value as NonNullable<UniversalItem['recurrence']>['anchor'] })}><option value="schedule">Scheduled time</option><option value="completion">Actual completion or cancellation</option></select><small>Choose actual completion when the next interval should be counted from the time you finished, rather than the original schedule.</small></label><label className="check"><input type="checkbox" checked={item.recurrence?.autoRenew ?? true} onChange={(event) => patchRecurrence({ autoRenew: event.target.checked })} /> Auto-close untouched cycles</label><label>Repeat rule <span className="hint">RRULE — Recurrence Rule</span><input className="mono" value={item.recurrence?.rrule ?? 'FREQ=WEEKLY;INTERVAL=1'} onChange={(event) => patchRecurrence({ rrule: event.target.value })} /></label><label>Activation duration <span className="hint">ISO 8601</span><input className="mono" value={item.recurrence?.activationOffset ?? 'P7D'} onChange={(event) => patchRecurrence({ activationOffset: event.target.value })} /></label></div></details>
          </>}
        </div></details>

        <details open={Boolean(item.progress) || Boolean(item.habit)}><summary>Progress & habit</summary><div className="details-body">
          <SectionGuide title="Progress versus habit"><p>Progress describes the current item. A habit stays one item and records completed calendar dates instead of creating a duplicate item for every day.</p></SectionGuide>
          <div className="form-grid three"><label>Mode<select value={item.progress?.mode ?? 'counter'} onChange={(event) => patchItem({ progress: { mode: event.target.value as 'counter', current: item.progress?.current ?? 0, target: item.progress?.target ?? 1 } })}><option>boolean</option><option>percent</option><option>counter</option></select></label>
          <label>Current<input type="number" value={item.progress?.current ?? 0} onChange={(event) => patchItem({ progress: { mode: item.progress?.mode ?? 'counter', current: Number(event.target.value), target: item.progress?.target ?? 1 } })} /></label>
          <label>Target<input type="number" value={item.progress?.target ?? 1} onChange={(event) => patchItem({ progress: { mode: item.progress?.mode ?? 'counter', current: item.progress?.current ?? 0, target: Number(event.target.value) } })} /></label></div>
          <label className="check"><input type="checkbox" checked={Boolean(item.habit)} onChange={(event) => patchItem({ habit: event.target.checked ? { target: item.progress?.target ?? 1, unit: 'times', streakMode: 'manual_only', completedDates: item.habit?.completedDates ?? [] } : undefined })} /> Track as a habit</label>
        </div></details>

        <details open={item.relations.length > 0 || item.attachments.length > 0}><summary>Relations & links</summary><div className="details-body">
          <SectionGuide title="Linking items"><p>Relations connect two items without making either one a subtask. Links are URL references only; files are not stored in this workspace.</p></SectionGuide>
          {item.relations.map((relation) => <div className="chip" key={relation.id}>{relation.type}: {workspace.items[relation.targetId]?.title ?? relation.targetId}<button aria-label="Remove relation" onClick={() => patchItem({ relations: item.relations.filter((entry) => entry.id !== relation.id) })}><CloseIcon /></button></div>)}
          <div className="inline-row"><select id="relation-target" defaultValue=""><option value="">Choose related item…</option>{Object.values(workspace.items).filter((candidate) => candidate.id !== item.id && !candidate.deletedAt).map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.title}</option>)}</select><button className="secondary" onClick={() => { const select = document.getElementById('relation-target') as HTMLSelectElement; if (select.value) patchItem({ relations: [...item.relations, { id: createId(), targetId: select.value, type: 'related' }] }); }}>Link</button></div>
          {item.attachments.map((attachment) => <div className="chip" key={attachment.id}><a href={attachment.url} target="_blank" rel="noreferrer">{attachment.title ?? attachment.url}</a><button aria-label="Remove link" onClick={() => patchItem({ attachments: item.attachments.filter((entry) => entry.id !== attachment.id) })}><CloseIcon /></button></div>)}
          <button className="secondary" onClick={() => { const url = window.prompt('Link URL'); if (url) patchItem({ attachments: [...item.attachments, { id: createId(), url }] }); }}>+ Add link</button>
        </div></details>

        {definitions.length > 0 && <details open={Object.keys(item.custom).length > 0}><summary>Custom fields</summary><div className="details-body">{definitions.map((field) => <label key={field.id}>{field.label}{field.kind === 'formula' ? <output className="formula-output">{String(formulas.values[field.key] ?? formulas.errors[field.key] ?? '—')}</output> : <input value={String(item.custom[field.key] ?? '')} onChange={(event) => patchItem({ custom: { ...item.custom, [field.key]: field.kind === 'number' ? Number(event.target.value) : field.kind === 'boolean' ? event.target.value === 'true' : event.target.value } })} />}</label>)}</div></details>}
        <details open={jsonDirty}><summary>Item JSON</summary><div className="details-body json-editor"><p className="hint">Edit the same item draft as the form. Protected identity, provenance, timestamps and occurrence fields are preserved when updating an existing item.</p><SectionGuide title="JSON safety"><p>Apply JSON updates the form first; only Save item writes it to the workspace. Import as new item always creates a separate copy. Exported data is readable, so do not share it accidentally.</p></SectionGuide><CodeEditor language="json" ariaLabel="Item JSON" rows={18} value={jsonDraft} onChange={(value) => { setJsonDraft(value); setJsonDirty(true); }} /><div className="builder-actions"><button className="secondary compact-action" onClick={() => { setJsonDraft(JSON.stringify(item, null, 2)); setJsonDirty(false); }}>Refresh from form</button><button className="secondary compact-action" onClick={applyJson}>Apply JSON to form</button><details className="inline-menu"><summary>Export…</summary><div><button onClick={exportItemJson}>JSON</button><button onClick={() => exportItem('csv')}>CSV</button><button onClick={() => exportItem('xlsx')}>Excel</button><button onClick={() => exportItem('ics')}>iCalendar</button><button onClick={() => exportItem('ics', true)}>iCalendar + UTM metadata</button></div></details><button className="secondary compact-action" onClick={() => importJsonRef.current?.click()}>Import as new item</button><input ref={importJsonRef} hidden type="file" accept=".json,.csv,.xlsx,.ics,application/json,text/csv,text/calendar,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => event.target.files?.[0] && void importAsNew(event.target.files[0])} /></div></div></details>
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
  const fieldContent = (item: UniversalItem, omit: string[] = []) => <span className="renderer-fields">{visibleFields.filter((field) => !omit.includes(field)).map((field) => {
    if (field === 'title') return <strong key={field}>{item.title}</strong>;
    const value = displayViewValue(readItemField(item, field, workspace), field);
    return value ? <span key={field}><small>{viewFieldLabel(workspace, field)}</small>{value}</span> : null;
  })}</span>;
  if (!items.length) return <p className="empty">No items match this view.</p>;
  if (view.renderer === 'calendar') {
    const dated = items.flatMap((item) => {
      const date = item.schedule?.startAt ?? item.schedule?.dueAt;
      return date ? [{ item, date }] : [];
    });
    return dated.length ? <div className="calendar-strip">{dated.map(({ item, date }) => <article className={`calendar-item state-${item.state}`} key={item.id}><button className="state-toggle" aria-label={item.state === 'open' ? `Complete ${item.title}` : `Reopen ${item.title}`} onClick={() => onState(item, item.state === 'open' ? 'done' : 'open')}>{item.state === 'open' ? '' : '✓'}</button><button className="calendar-main" onClick={() => onEdit(item)}><time dateTime={date}>{new Date(date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</time>{fieldContent(item, ['schedule.startAt', 'schedule.dueAt'])}</button></article>)}</div> : <p className="empty">Matching items have no dates.</p>;
  }
  if (view.renderer === 'board') {
    const settings = boardSettingsFor(view);
    const columns = settings.groupBy === 'tag'
      ? [...new Set(items.flatMap((item) => item.tags))].sort((a, b) => a.localeCompare(b)).map((tag) => ({ key: tag, label: `#${tag}`, items: items.filter((item) => item.tags.includes(tag)) })).concat([{ key: '__untagged__', label: 'No tags', items: items.filter((item) => item.tags.length === 0) }])
      : settings.states.map((state) => ({ key: state, label: stateNames[state], items: items.filter((item) => item.state === state) }));
    const visibleColumns = columns.filter((column) => settings.showEmpty || column.items.length > 0);
    return visibleColumns.length ? <div className="mini-board">{visibleColumns.map(({ key, label, items: columnItems }) => <section key={key}><h4>{label}</h4>{columnItems.map((item) => <article className={`board-item state-${item.state}`} key={item.id}><button className="state-toggle" aria-label={item.state === 'open' ? `Complete ${item.title}` : `Reopen ${item.title}`} onClick={() => onState(item, item.state === 'open' ? 'done' : 'open')}>{item.state === 'open' ? '' : '✓'}</button><button className="board-item-main" onClick={() => onEdit(item)}>{fieldContent(item, ['state'])}</button></article>)}</section>)}</div> : <p className="empty">No items match this board.</p>;
  }
  if (view.renderer === 'table') {
    const fields = visibleFields.length ? visibleFields : ['title', 'state', 'schedule.dueAt', 'priority'];
    return <div className="table-wrap"><table><thead><tr><th className="state-column"><span className="sr-only">Complete</span></th>{fields.map((field) => <th key={field}>{viewFieldLabel(workspace, field)}</th>)}</tr></thead><tbody>{items.map((item) => <tr className={`state-${item.state}`} key={item.id} onClick={() => onEdit(item)}><td className="state-column"><button className="state-toggle" aria-label={item.state === 'open' ? `Complete ${item.title}` : `Reopen ${item.title}`} onClick={(event) => { event.stopPropagation(); onState(item, item.state === 'open' ? 'done' : 'open'); }}>{item.state === 'open' ? '' : '✓'}</button></td>{fields.map((field) => <td key={field}>{displayViewValue(readItemField(item, field, workspace), field)}</td>)}</tr>)}</tbody></table></div>;
  }
  return <div className="item-list">{items.map((item) => <ItemCard key={item.id} item={item} fields={visibleFields} workspace={workspace} onEdit={() => onEdit(item)} onState={(state) => onState(item, state)} />)}</div>;
}

function SavedViewSection({ view, workspace, onEditView, onEditItem, onState, onRendererChange }: {
  view: SavedView; workspace: WorkspaceDocument; onEditView: () => void; onEditItem: (item: UniversalItem) => void;
  onState: (item: UniversalItem, state: UniversalItem['state']) => void; onRendererChange: (renderer: SavedView['renderer']) => void;
}) {
  const [open, setOpen] = useState(true);
  const matchingItems = filteredItems(workspace, view).length;
  return <section className="view-section">
    <header className="view-section-summary"><div><select className="view-renderer view-renderer-select" aria-label={`Renderer for ${view.name}`} value={view.renderer} onChange={(event) => onRendererChange(event.target.value as SavedView['renderer'])}><option value="list">List</option><option value="table">Table</option><option value="calendar">Calendar</option><option value="board">Board</option></select><h2>{view.name}</h2></div><div className="view-section-actions"><button type="button" className="secondary" onClick={onEditView}>Edit view</button><button type="button" className="view-collapse-button" aria-label={`${open ? 'Collapse' : 'Expand'} ${view.name}`} aria-expanded={open} onClick={() => setOpen((current) => !current)}>{open ? '−' : '+'}</button></div></header>
    {open && <div className="view-section-body"><details className="view-query-details"><summary>View details</summary><div className="view-query-details-body"><code>{view.query.source.trim() || 'All items'}</code>{(view.sortSource || view.sort?.length) && <code className="sort-preview">Sort: {view.sortSource ?? view.sort.map((sort) => `${sort.field} ${sort.direction}`).join(' · ')}</code>}<p>{matchingItems} matching items</p></div></details><ViewResults view={view} workspace={workspace} onEdit={onEditItem} onState={onState} /></div>}
  </section>;
}

function toSqlExpression(source: string): string {
  const trimmed = source.trim();
  if (!trimmed) return 'TRUE';
  return trimmed
    .replace(/\bactiveRange\b/g, 'active_range')
    .replace(/\bstate\b/g, 'state')
    .replace(/==/g, '=')
    .replace(/!=/g, '<>')
    .replace(/&&/g, ' AND ')
    .replace(/\|\|/g, ' OR ')
    .replace(/\btrue\b/gi, 'TRUE')
    .replace(/\bfalse\b/gi, 'FALSE')
    .replace(/\bnull\b/gi, 'NULL')
    .replace(/includes\(([^,]+),\s*([^\)]+)\)/g, '$2 = ANY($1)')
    .replace(/\s+/g, ' ')
    .trim();
}

function toSqlSort(source: string): string {
  const rules = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return rules.length ? `ORDER BY ${rules.map((line) => line.replace(/\s+(asc|desc)(?:\s+nulls\s+(first|last))?$/i, (_m, direction: string, nulls?: string) => ` ${direction.toUpperCase()}${nulls ? ` NULLS ${nulls.toUpperCase()}` : ''}`)).join(', ')}` : 'ORDER BY updatedAt DESC NULLS LAST';
}

function ViewsPage({ workspace, commit, onEditItem, onState, onOpenCalendar }: {
  workspace: WorkspaceDocument; commit: (message: string, mutation: (draft: WorkspaceDocument) => void) => void;
  onEditItem: (item: UniversalItem) => void; onState: (item: UniversalItem, state: UniversalItem['state']) => void;
  onOpenCalendar?: (viewId: string) => void;
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
  const [draggedField, setDraggedField] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [viewJson, setViewJson] = useState('');
  const viewJsonRef = useRef<HTMLInputElement>(null);

  const literal = (value: string) => ['true', 'false', 'null'].includes(value) || (!Number.isNaN(Number(value)) && value.trim() !== '') ? value : JSON.stringify(value);
  const visualOptions: Record<string, string[]> = {
    state: ['open', 'done', 'auto_closed', 'cancelled', 'archived'], preset: ['task', 'event', 'habit', 'blank'],
    isHabit: ['true', 'false'], isTemplate: ['true', 'false'], isSubtask: ['true', 'false'], isParent: ['true', 'false'], activeRange: ['true', 'false'], role: ['standalone', 'series_template', 'occurrence'], priority: ['0', '1', '2', '3', '4'],
  };
  const visualFieldKinds: Record<string, 'enum' | 'boolean' | 'number' | 'date' | 'text' | 'multi'> = {
    state: 'enum', preset: 'enum', role: 'enum', isHabit: 'boolean', activeRange: 'boolean', priority: 'number',
    'schedule.startAt': 'date', 'schedule.endAt': 'date', 'schedule.dueAt': 'date', 'schedule.availableFrom': 'date',
    title: 'text', description: 'text', tags: 'multi', contexts: 'multi',
  };
  const visualOperators = (field: string): string[] => {
    const kind = visualFieldKinds[field] ?? 'text';
    if (kind === 'number' || kind === 'date') return ['==', '!=', '>', '>=', '<', '<='];
    if (kind === 'boolean' || kind === 'enum') return ['==', '!=', 'in'];
    if (kind === 'multi') return ['has any', 'has all', 'has none'];
    return ['==', '!=', 'contains'];
  };
  const visualClause = () => {
    if (visualField === 'tags' || visualField === 'contexts') {
      const values = commaList(visualValue);
      if (!values.length) return 'true';
      const checks = values.map((value) => `includes(${visualField}, ${JSON.stringify(value)})`);
      if (visualOperator === 'has all') return checks.join(' && ');
      if (visualOperator === 'has none') return `!(${checks.join(' || ')})`;
      return `(${checks.join(' || ')})`;
    }
    return `${visualField} ${visualOperator === 'contains' ? 'in' : visualOperator} ${literal(visualValue)}`;
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
    } else setVisualValue(firstClause?.[1] === 'activeRange' ? 'true' : 'open');
    setVisualDirty(false);
    setSortSource(source);
    try { setSortRules(parseSortSource(source)); } catch { setSortRules([]); }
    setManualField('');
    setConfirmDelete(false);
    setViewJson(JSON.stringify(copy, null, 2));
    setError('');
  };
  const changeVisual = (part: 'field' | 'operator' | 'value', value: string) => {
    if (part === 'field') { setVisualField(value); const options = visualOperators(value); setVisualOperator(options[0]!); if (visualOptions[value]?.length) setVisualValue(visualOptions[value]![0]!); else setVisualValue(''); }
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
  const moveFieldTo = (field: string, targetField: string) => {
    if (!editing || field === targetField) return;
    const fields = editing.fields.filter((entry) => entry !== field);
    fields.splice(fields.indexOf(targetField), 0, field);
    setEditing({ ...editing, fields });
  };
  const updateBoardSettings = (patch: Partial<BoardSettings>) => {
    if (!editing) return;
    const current = boardSettingsFor(editing);
    setEditing({ ...editing, extensions: { ...editing.extensions, 'utm:board': { ...current, ...patch } } });
  };
  const moveBoardState = (index: number, offset: number) => {
    if (!editing) return;
    const settings = boardSettingsFor(editing); const target = index + offset;
    if (target < 0 || target >= settings.states.length) return;
    const states = [...settings.states]; [states[index], states[target]] = [states[target]!, states[index]!]; updateBoardSettings({ states });
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
  const newView = () => beginEditing({ id: createId(), name: 'New view', query: { source: '(state == "open" || state == "done") && role != "series_template" && isTemplate != true' }, renderer: 'table', sort: [{ field: 'updatedAt', direction: 'desc' }], fields: ['title', 'state'] });
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
  const exportView = (view: SavedView, mode: 'definition' | 'results' | 'bundle', format: PortableFormat = 'json', metadata = false) => {
    const results = filteredItems(workspace, view); const dependencies = collectItemDependencies(workspace, results);
    const portable = createPortablePackage(workspace, {
      kind: mode === 'definition' ? 'views' : mode === 'results' ? 'items' : 'view_bundle',
      views: mode === 'results' ? [] : [view], items: mode === 'definition' ? [] : dependencies,
      selection: mode === 'definition' ? { type: 'view_definition', viewId: view.id, viewName: view.name } : { type: 'view_results', viewId: view.id, viewName: view.name },
      dependencyItemIds: dependencies.filter((item) => !results.some((result) => result.id === item.id)).map((item) => item.id),
    });
    exportPortable(workspace, portable, `${safeFilename(view.name)}-${mode}`, format, metadata);
  };

  return <section className="page-section views-page">
    <div className="views-toolbar"><button className="primary compact" onClick={newView}>+ New view</button></div>
    <div className="views-stack">{Object.values(workspace.views).map((view) => <div key={view.id}>{view.renderer === 'calendar' && onOpenCalendar && <button className="open-calendar-button" onClick={() => onOpenCalendar(view.id)}>Open {view.name} in Calendar</button>}<SavedViewSection view={view} workspace={workspace} onEditView={() => beginEditing(view)} onEditItem={onEditItem} onState={onState} onRendererChange={(renderer) => commit('Change view renderer', (draft) => { const target = draft.views[view.id]; if (target) target.renderer = renderer; })} /></div>)}</div>
    {editing && <div className="modal-backdrop"><section className="dialog view-editor">
      <header><div><p className="dialog-kicker">SAVED VIEW</p><h2>Edit view</h2></div><button className="icon-button" aria-label="Close view editor" onClick={() => setEditing(null)}><CloseIcon /></button></header>
      <label>Name<input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label>
      <SectionGuide title="How views work"><ul><li>A view is a saved, live list; it never copies items.</li><li>Use the visual condition for simple choices. Use DSL for combinations such as <code>priority &gt;= 3 &amp;&amp; state == "open"</code>.</li><li>An empty DSL means all items except recurring source templates.</li><li>Displayed fields control what is visible; sorting only controls order.</li></ul></SectionGuide>
      <fieldset className="query-builder"><legend>Visual condition</legend>
        <p className="builder-status">Choose a field and only the operators that make sense for its type. Active range uses Event opens through Due.</p>
        <div className="form-grid three">
          <label>Field<select value={visualField} onChange={(event) => changeVisual('field', event.target.value)}><option>state</option><option>preset</option><option value="isHabit">Habit tracking</option><option value="isTemplate">Template</option><option>activeRange</option><option>role</option><option>priority</option><option>schedule.startAt</option><option>schedule.endAt</option><option>schedule.dueAt</option><option>schedule.availableFrom</option><option>title</option><option>description</option><option>tags</option><option>contexts</option><option>reminders</option></select></label>
          <label>Operator<select value={visualOperator} onChange={(event) => changeVisual('operator', event.target.value)}>{visualOperators(visualField).map((operator) => <option key={operator} value={operator}>{operator}</option>)}</select></label>
          <label>Value{visualOptions[visualField] ? <select value={visualValue} onChange={(event) => changeVisual('value', event.target.value)}>{visualOptions[visualField]!.map((value) => <option key={value} value={value}>{visualField === 'state' ? stateNames[value as UniversalItem['state']] ?? value : value}</option>)}</select> : <input type={visualField.startsWith('schedule.') ? 'datetime-local' : 'text'} list={visualField === 'title' ? 'view-title-values' : visualField === 'tags' || visualField === 'contexts' ? 'view-tag-values' : undefined} placeholder={visualField === 'tags' || visualField === 'contexts' ? 'Choose or type comma-separated values' : undefined} value={visualValue} onChange={(event) => changeVisual('value', event.target.value)} />}</label>
        </div>
        <datalist id="view-title-values">{[...new Set(Object.values(workspace.items).map((entry) => entry.title))].map((title) => <option value={title} key={title} />)}</datalist>
        <datalist id="view-tag-values">{[...new Set(Object.values(workspace.items).flatMap((entry) => [...entry.tags, ...entry.contexts]))].sort().map((tag) => <option value={tag} key={tag} />)}</datalist>
        <p className="condition-readable">Showing items where <strong>{visualField === 'activeRange' ? 'Active range' : visualField}</strong> {visualOperator} <strong>{visualValue || 'any value'}</strong>.</p>
        <p className="builder-status">{visualDirty ? 'This condition will replace the DSL expression when you save.' : 'Visual condition and DSL are synchronized.'}</p>
        <div className="builder-actions"><button className="secondary compact-action" onClick={() => applyVisual('replace')}>Apply condition</button><button className="secondary compact-action" onClick={() => applyVisual('and')}>+ Add AND condition</button><button className="secondary compact-action" onClick={() => applyVisual('or')}>+ Add OR condition</button></div>
      </fieldset>
      <label className="dsl-field">SQL-like filter<span className="hint">Safe typed expression; SQL preview: {toSqlExpression(editing.query.source)}</span><CodeEditor language="dsl" ariaLabel="DSL expression" rows={5} value={editing.query.source} onChange={(value) => { setEditing({ ...editing, query: { source: value } }); setVisualDirty(false); }} /></label>
      <label>Renderer<select value={editing.renderer} onChange={(event) => setEditing({ ...editing, renderer: event.target.value as SavedView['renderer'] })}><option>list</option><option>table</option><option>calendar</option><option>board</option></select></label>
      {editing.renderer === 'board' && <fieldset className="query-builder board-builder"><legend>Board columns</legend><p className="builder-status">Group items by status or by tag. Empty columns are hidden by default.</p><label>Group columns by<select value={boardSettingsFor(editing).groupBy} onChange={(event) => updateBoardSettings({ groupBy: event.target.value as BoardSettings['groupBy'] })}><option value="status">Status</option><option value="tag">Tags</option></select></label><label className="check"><input type="checkbox" checked={boardSettingsFor(editing).showEmpty} onChange={(event) => updateBoardSettings({ showEmpty: event.target.checked })} />Show empty columns</label>{boardSettingsFor(editing).groupBy === 'status' ? <><div className="board-column-settings">{boardSettingsFor(editing).states.map((state, index) => <div key={state}><label className="check"><input type="checkbox" checked onChange={() => updateBoardSettings({ states: boardSettingsFor(editing).states.filter((entry) => entry !== state) })} />{stateNames[state]}</label><div><button className="secondary compact-action" aria-label={`Move ${stateNames[state]} left`} disabled={index === 0} onClick={() => moveBoardState(index, -1)}>←</button><button className="secondary compact-action" aria-label={`Move ${stateNames[state]} right`} disabled={index === boardSettingsFor(editing).states.length - 1} onClick={() => moveBoardState(index, 1)}>→</button></div></div>)}</div><div className="builder-actions">{defaultBoardStates.filter((state) => !boardSettingsFor(editing).states.includes(state)).map((state) => <button className="secondary compact-action" key={state} onClick={() => updateBoardSettings({ states: [...boardSettingsFor(editing).states, state] })}>+ {stateNames[state]}</button>)}</div></> : <p className="builder-status">Each existing tag becomes a column automatically. Items without tags appear in “No tags”. Add or remove tags on items to change the columns.</p>}</fieldset>}
      <fieldset className="query-builder fields-builder"><legend>Displayed fields</legend>
        <p className="builder-status">Choose any item properties. Their order below is also their display order.</p>
        <details className="display-fields-example"><summary>Preview with a fully filled example item</summary><p className="display-fields-help">Drag a field to change its order, or hide it with ×.</p><div>{editing.fields.length ? editing.fields.map((field) => <span key={field} draggable onDragStart={() => setDraggedField(field)} onDragEnd={() => setDraggedField(null)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (draggedField) moveFieldTo(draggedField, field); setDraggedField(null); }}><button className="preview-field-remove" aria-label={`Hide ${viewFieldLabel(workspace, field)}`} onClick={() => toggleField(field)}><CloseIcon /></button><small>{viewFieldLabel(workspace, field)}</small>{exampleViewFieldValue(field)}</span>) : <p>Select fields below to preview them here.</p>}</div></details>
        <div className="builder-actions"><button className="secondary compact-action" onClick={() => setEditing({ ...editing, fields: viewFieldOptions(workspace).map((field) => field.path) })}>Select all</button><button className="secondary compact-action" onClick={() => setEditing({ ...editing, fields: [] })}>Hide all</button></div>
        <div className="field-groups">{[...new Set(viewFieldOptions(workspace).map((field) => field.group))].map((group) => <details key={group}><summary>{group}</summary><div className="field-options">{viewFieldOptions(workspace).filter((field) => field.group === group).map((field) => <label className="check" key={field.path}><input type="checkbox" checked={editing.fields.includes(field.path)} onChange={() => toggleField(field.path)} />{field.label}<small>{field.path}</small></label>)}</div></details>)}</div>
        <div className="manual-field"><input aria-label="Custom field path" placeholder="Any path, e.g. custom.client" value={manualField} onChange={(event) => setManualField(event.target.value)} /><button className="secondary compact-action" disabled={!manualField.trim() || editing.fields.includes(manualField.trim())} onClick={() => { const path = manualField.trim(); setEditing({ ...editing, fields: [...editing.fields, path] }); setManualField(''); }}>+ Add path</button></div>
        {editing.fields.length > 0 && <div className="selected-fields"><span className="selected-fields-title">Display order</span>{editing.fields.map((field, index) => <div key={field}><code>{field}</code><div><button aria-label={`Move ${field} up`} disabled={index === 0} onClick={() => moveField(index, -1)}>↑</button><button aria-label={`Move ${field} down`} disabled={index === editing.fields.length - 1} onClick={() => moveField(index, 1)}>↓</button><button aria-label={`Hide ${field}`} onClick={() => toggleField(field)}><CloseIcon /></button></div></div>)}</div>}
      </fieldset>
      <fieldset className="query-builder sort-builder"><legend>Sorting</legend>
        <p className="builder-status">Rules run from top to bottom. Later rules break ties from earlier ones.</p>
        <SectionGuide title="Sorting examples"><p><code>priority desc nulls last</code> puts urgent items first. Add <code>lower(title) asc nulls last</code> on the next line to order items with the same priority alphabetically.</p></SectionGuide>
        <div className="sort-rules">{sortRules.map((rule, index) => <div className="sort-rule" key={`${index}-${rule.expression}`}>
          <label>Sort by<select aria-label={`Sort field ${index + 1}`} value={viewFieldOptions(workspace).some((field) => field.path === rule.expression) ? rule.expression : '__custom__'} onChange={(event) => updateSortRule(index, { expression: event.target.value === '__custom__' ? 'lower(title)' : event.target.value })}>{[...new Set(viewFieldOptions(workspace).map((field) => field.group))].map((group) => <optgroup label={group} key={group}>{viewFieldOptions(workspace).filter((field) => field.group === group).map((field) => <option value={field.path} key={field.path}>{field.label}</option>)}</optgroup>)}<optgroup label="Advanced"><option value="__custom__">Custom expression…</option></optgroup></select>{!viewFieldOptions(workspace).some((field) => field.path === rule.expression) && <input className="sort-custom-expression mono" aria-label={`Custom sort expression ${index + 1}`} value={rule.expression} onChange={(event) => updateSortRule(index, { expression: event.target.value })} placeholder="lower(title)" />}</label>
          <label>Direction<select aria-label={`Sort direction ${index + 1}`} value={rule.direction} onChange={(event) => updateSortRule(index, { direction: event.target.value as ViewSortRule['direction'] })}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
          <label>Empty values<select aria-label={`Empty values ${index + 1}`} value={rule.nulls} onChange={(event) => updateSortRule(index, { nulls: event.target.value as ViewSortRule['nulls'] })}><option value="last">Last</option><option value="first">First</option></select></label>
          <div className="rule-order"><button className="secondary compact-action" aria-label={`Move sort ${index + 1} up`} disabled={index === 0} onClick={() => moveSortRule(index, -1)}>↑</button><button className="secondary compact-action" aria-label={`Move sort ${index + 1} down`} disabled={index === sortRules.length - 1} onClick={() => moveSortRule(index, 1)}>↓</button><button className="secondary compact-action" aria-label={`Remove sort ${index + 1}`} onClick={() => updateSortRules(sortRules.filter((_rule, ruleIndex) => ruleIndex !== index))}><CloseIcon /></button></div>
        </div>)}</div>
        <button className="secondary compact-action" onClick={() => updateSortRules([...sortRules, { expression: 'updatedAt', direction: 'desc', nulls: 'last' }])}>+ Add sort rule</button>
        <label className="dsl-field sort-dsl">SQL-like sorting<span className="hint">One rule per line. SQL preview: {toSqlSort(sortSource)}</span><CodeEditor language="dsl" ariaLabel="SQL-like sorting" rows={4} value={sortSource} onChange={(source) => { setSortSource(source); try { setSortRules(parseSortSource(source)); } catch { /* Keep the text editable until save reports the exact error. */ } }} /></label>
      </fieldset>
      <details className="query-builder json-editor view-json-editor"><summary>View JSON</summary><div className="details-body"><p className="builder-status">This is the complete SavedView draft. Imported JSON is applied as a template and keeps this view ID.</p><CodeEditor language="json" ariaLabel="View JSON" rows={16} value={viewJson} onChange={setViewJson} /><div className="builder-actions"><button className="secondary compact-action" onClick={() => setViewJson(JSON.stringify({ ...editing, sortSource, sort: sortRules.map((rule) => ({ field: rule.expression, direction: rule.direction, nulls: rule.nulls })) }, null, 2))}>Refresh from visual editor</button><button className="secondary compact-action" onClick={() => applyViewJson()}>Apply JSON</button><button className="secondary compact-action" onClick={() => viewJsonRef.current?.click()}>Import as template</button><input ref={viewJsonRef} hidden type="file" accept=".json,application/json" onChange={(event) => event.target.files?.[0] && void importViewTemplate(event.target.files[0])} /></div></div></details>
      <details className="query-builder view-export-details"><summary>Export view</summary><div className="details-body"><p className="builder-status">Definitions use JSON. Results can also be opened in spreadsheets or calendar apps.</p><div className="builder-actions"><button className="secondary compact-action" onClick={() => exportView({ ...editing, sortSource, sort: sortRules.map((rule) => ({ field: rule.expression, direction: rule.direction, nulls: rule.nulls })) }, 'definition')}>Definition JSON</button><details className="inline-menu"><summary>Results…</summary><div><button onClick={() => exportView({ ...editing, sortSource, sort: sortRules.map((rule) => ({ field: rule.expression, direction: rule.direction, nulls: rule.nulls })) }, 'results')}>JSON</button><button onClick={() => exportView({ ...editing, sortSource, sort: sortRules.map((rule) => ({ field: rule.expression, direction: rule.direction, nulls: rule.nulls })) }, 'results', 'csv')}>CSV</button><button onClick={() => exportView({ ...editing, sortSource, sort: sortRules.map((rule) => ({ field: rule.expression, direction: rule.direction, nulls: rule.nulls })) }, 'results', 'xlsx')}>Excel</button><button onClick={() => exportView({ ...editing, sortSource, sort: sortRules.map((rule) => ({ field: rule.expression, direction: rule.direction, nulls: rule.nulls })) }, 'results', 'ics')}>iCalendar</button><button onClick={() => exportView({ ...editing, sortSource, sort: sortRules.map((rule) => ({ field: rule.expression, direction: rule.direction, nulls: rule.nulls })) }, 'results', 'ics', true)}>iCalendar + UTM metadata</button></div></details><button className="secondary compact-action" onClick={() => exportView({ ...editing, sortSource, sort: sortRules.map((rule) => ({ field: rule.expression, direction: rule.direction, nulls: rule.nulls })) }, 'bundle', 'xlsx')}>Definition + results Excel</button></div></div></details>
      {error && <p className="error">{error}</p>}
      <footer><button className="danger" onClick={() => { if (!confirmDelete) { setConfirmDelete(true); return; } commit('Delete view', (draft) => { delete draft.views[editing.id]; Object.values(draft.dashboards).forEach((dashboard) => { for (let index = dashboard.widgets.length - 1; index >= 0; index -= 1) if (dashboard.widgets[index]?.viewId === editing.id) dashboard.widgets.splice(index, 1); }); }); setEditing(null); setConfirmDelete(false); }}>{confirmDelete ? 'Confirm delete' : 'Delete view'}</button><span /><button className="secondary" onClick={() => setEditing(null)}>Cancel</button><button className="primary" onClick={save}>Save view</button></footer>
    </section></div>}
  </section>;
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
    <div className="automation-layout"><div className="rule-list">{Object.values(workspace.automations).map((rule) => <article className="rule-card" key={rule.id}><div><span className={`status-dot ${rule.enabled ? 'on' : ''}`} /><strong>{rule.name}</strong><small>{rule.trigger.type}</small></div><code>{rule.condition.source}</code>{rule.disabledReason && <p className="error">{rule.disabledReason}</p>}<footer><button className="secondary" onClick={() => commit('Toggle rule', (draft) => { draft.automations[rule.id]!.enabled = !draft.automations[rule.id]!.enabled; delete draft.automations[rule.id]!.disabledReason; })}>{rule.enabled ? 'Disable' : 'Enable'}</button><button className="secondary" onClick={() => edit(rule)}>Edit</button></footer></article>)}{!Object.keys(workspace.automations).length && <div className="empty-panel"><svg className="automation-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 2 4.5 13.2h7.3L11 22l8.5-11.2h-7.3L13 2Z" /></svg><h3>No automations yet</h3><p>Create a safe rule for repetitive work.</p></div>}</div><aside className="log-panel"><h3>Execution log</h3>{workspace.automationLog.slice(-20).reverse().map((entry) => <div className="log-line" key={entry.id}><span className={`status-dot ${entry.outcome === 'success' ? 'on' : entry.outcome === 'failed' ? 'bad' : ''}`} /><div><strong>{workspace.automations[entry.ruleId]?.name ?? 'Deleted rule'}</strong><small>{entry.outcome} · {new Date(entry.finishedAt).toLocaleString()}</small></div></div>)}{!workspace.automationLog.length && <p className="empty">Runs will appear here.</p>}</aside></div>
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
  return <section className="page-section"><div className="page-title"><div><h1>Settings</h1></div></div>
    <section className="settings-card"><p className="eyebrow">APPEARANCE</p><h2>Theme</h2><p>Choose a light, dark or system theme. Scheduled mode switches automatically using the times below.</p><label>Theme<select value={workspace.calendarPreferences.appearance.mode} onChange={(event) => commit('Change theme mode', (draft) => { draft.calendarPreferences.appearance.mode = event.target.value as WorkspaceDocument['calendarPreferences']['appearance']['mode']; })}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option><option value="scheduled">Scheduled</option></select></label>{workspace.calendarPreferences.appearance.mode === 'scheduled' && <div className="form-grid two"><label>Light theme starts<input type="time" value={workspace.calendarPreferences.appearance.lightAt} onChange={(event) => commit('Change light theme schedule', (draft) => { draft.calendarPreferences.appearance.lightAt = event.target.value; })} /></label><label>Dark theme starts<input type="time" value={workspace.calendarPreferences.appearance.darkAt} onChange={(event) => commit('Change dark theme schedule', (draft) => { draft.calendarPreferences.appearance.darkAt = event.target.value; })} /></label></div>}<hr/><p className="eyebrow">SOUND</p><h2>Completion sound</h2><label className="check"><input type="checkbox" checked={workspace.calendarPreferences.appearance.tickSound} onChange={(event) => commit('Toggle completion sound', (draft) => { draft.calendarPreferences.appearance.tickSound = event.target.checked; })} />Play a short sound when an item is completed</label></section>
    <div className="settings-columns"><section className="settings-card"><header><div><p className="eyebrow">DATA MODEL</p><h2>Custom fields</h2></div><button className="secondary" onClick={() => setField({ id: createId(), key: '', label: '', kind: 'text', required: false })}>+ Add</button></header>{Object.values(workspace.customFields).map((entry) => <button className="setting-row" key={entry.id} onClick={() => setField(clean(entry))}><span><strong>{entry.label}</strong><small>custom.{entry.key}</small></span><span>{entry.kind}</span></button>)}{!Object.keys(workspace.customFields).length && <p className="empty">No custom fields yet.</p>}</section>
    <section className="settings-card"><p className="eyebrow">INTERFACE</p><h2>Interface language</h2><p>Choose the language used by the app on this device. Item titles and your data are never translated.</p><label>Language<select value={workspace.calendarPreferences.language} onChange={(event) => commit('Change interface language', (draft) => { draft.calendarPreferences.language = event.target.value as WorkspaceDocument['calendarPreferences']['language']; })}>{interfaceLanguages.map((language) => <option value={language.value} key={language.value}>{language.label}</option>)}</select></label><hr/><p className="eyebrow">PORTABILITY</p><h2>Move your data</h2><p>Encrypted Transfer is safe for complete workspace merge. Readable exports use the same preview, add and copy rules on import.</p><div className="settings-actions"><button className="secondary" onClick={onTransfer}><LineIcon name="transfer"/> Encrypted Transfer</button><details className="inline-menu"><summary>Export all…</summary><div><button onClick={() => exportAll('json')}>JSON</button><button onClick={() => exportAll('csv')}>CSV</button><button onClick={() => exportAll('xlsx')}>Excel</button><button onClick={() => exportAll('ics')}>iCalendar</button><button onClick={() => exportAll('ics', true)}>iCalendar + UTM metadata</button></div></details><button className="secondary" onClick={() => jsonInput.current?.click()}>Import data…</button><input ref={jsonInput} hidden type="file" accept=".json,.csv,.xlsx,.ics,application/json,text/csv,text/calendar,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImportFile(file); event.currentTarget.value = ''; }} /></div><hr/><p className="eyebrow">DEVICE</p><h2>Notifications</h2><p>Local reminders appear while the app is open. Background delivery uses optional Web Push and the free Cloudflare plan checks due jobs every 15 minutes.</p><button className="secondary" onClick={onNotify}>Allow local notifications</button><div className="background-push"><div><strong>Background notifications</strong><small>{workspace.pushPreferences.enabled ? 'Enabled for this encrypted workspace copy.' : 'Off — reminders stay only on this device while the app is open.'}</small></div>{workspace.pushPreferences.enabled ? <button className="secondary" onClick={onDisableBackground}>Disable</button> : <button className="secondary" onClick={onEnableBackground}>Enable background delivery</button>}</div>{workspace.pushPreferences.enabled && <label className="push-privacy">Lock-screen content<select value={workspace.pushPreferences.contentMode} onChange={(event) => onBackgroundContent(event.target.value as WorkspaceDocument['pushPreferences']['contentMode'])}><option value="generic">Generic — no task title leaves this device</option><option value="detailed">Show task title and urgency</option></select></label>}<p className="hint">For iPhone, install Universal to the Home Screen, then enable this from the installed app. The Worker never receives your password or encrypted database.</p><hr/><p className="eyebrow">APPLICATION</p><h2>{APP_NAME}</h2><dl><div><dt>Version</dt><dd>v{APP_VERSION}</dd></div><div><dt>Released</dt><dd><time dateTime={APP_RELEASED_AT}>{new Date(APP_RELEASED_AT).toLocaleString()}</time></dd></div></dl><hr/><p className="eyebrow">WORKSPACE</p><h2>{workspace.name}</h2><dl><div><dt>Schema</dt><dd>{workspace.schemaVersion}</dd></div><div><dt>Items</dt><dd>{Object.keys(workspace.items).length}</dd></div><div><dt>Workspace ID</dt><dd className="mono">{workspace.workspaceId}</dd></div></dl></section></div>
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
  const [editorIsNew, setEditorIsNew] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [popupNoticeIds, setPopupNoticeIds] = useState<string[]>([]);
  const [noticeCenterOpen, setNoticeCenterOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [quick, setQuick] = useState('');
  const [portableImportSource, setPortableImportSource] = useState<string | null>(null);
  const [, refreshClock] = useState(() => Date.now());
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const seenNoticeIds = useRef(new Set<string>());
  const noticeTimers = useRef(new Map<string, number>());
  const pushError = useRef('');

  useEffect(() => { void hasLocalWorkspace().then((exists) => setBoot(exists ? 'locked' : 'empty')); }, []);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 3500); return () => window.clearTimeout(timer); }, [toast]);
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
    const now = new Date();
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
    setNotices(notifications.map((notice) => ({ id: createId(), title: notice.title, body: notice.body, at: now.toISOString(), ...(notice.itemId ? { itemId: notice.itemId } : {}), ...(notice.reminderIds?.length ? { reminderIds: notice.reminderIds } : {}) })));
    if (Notification.permission === 'granted') notifications.forEach((notice) => new Notification(notice.title, { body: notice.body, ...(notice.itemId ? { tag: `reminder:${notice.itemId}` } : {}) }));
  };

  const workspace = session?.document as WorkspaceDocument | undefined;
  useEffect(() => workspace ? installDomLocalization(workspace.calendarPreferences.language) : undefined, [workspace?.calendarPreferences.language]);
  useEffect(() => {
    const appearance = workspace?.calendarPreferences.appearance;
    if (!appearance) return;
    const apply = () => {
      const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const theme = appearance.mode === 'system' ? (systemDark ? 'dark' : 'light') : appearance.mode === 'scheduled' ? scheduledTheme(appearance.lightAt, appearance.darkAt) : appearance.mode;
      document.documentElement.dataset.theme = theme;
    };
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    apply(); media.addEventListener('change', apply);
    const timer = window.setInterval(apply, 30_000);
    return () => { media.removeEventListener('change', apply); window.clearInterval(timer); };
  }, [workspace?.calendarPreferences.appearance.mode, workspace?.calendarPreferences.appearance.lightAt, workspace?.calendarPreferences.appearance.darkAt]);
  useEffect(() => {
    const itemId = new URLSearchParams(window.location.search).get('item');
    if (!itemId || !workspace?.items[itemId]) return;
    setEditor(workspace.items[itemId]);
    window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash}`);
  }, [workspace]);
  const commit = (message: string, mutation: (draft: WorkspaceDocument) => void) => {
    if (!session) return;
    const previous = session;
    const document = Automerge.change(session.document, message, (draft) => { mutation(draft as unknown as WorkspaceDocument); draft.updatedAt = new Date().toISOString(); });
    const next = { ...session, document };
    setSession(next);
    saveQueue.current = saveQueue.current.then(() => saveLocalWorkspace(document, session.dataKey)).catch((reason) => {
      setSession((current) => current?.document === document ? previous : current);
      setToast(`Save failed; the change was reverted: ${String(reason)}`);
    });
  };

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
    if (state === 'done') recentlyDoneUntil.set(item.id, Date.now() + 10_000);
    else recentlyDoneUntil.delete(item.id);
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
    if (item) setEditor(item);
  };

  if (boot === 'checking') return <main className="splash"><div className="brand-mark">U</div><p>Opening encrypted workspace…</p></main>;
  if (boot === 'empty' || boot === 'locked') return <LockScreen exists={boot === 'locked'} onReady={activate} />;
  if (!workspace || !session) return null;

  // Calendar and Automations are retained in the encrypted workspace, but archived from the daily UI until they are reliable enough to bring back.
  const nav: Array<[Page, LineIconName, string, boolean?]> = [['home', 'home', 'Home'], ['all', 'items', 'All items', true], ['settings', 'settings', 'Settings']];
    const openItems = new Set(Object.values(workspace.items).filter((item) => item.state === 'open' && !item.deletedAt && !isItemTemplate(item) && (item.role !== 'series_template' || item.habit)).map((item) => item.occurrence?.seriesId ?? item.id)).size;
  const deletedItems = Object.values(workspace.items).filter((item) => Boolean(item.deletedAt));
  const restoreItem = (item: UniversalItem) => commit('Restore item from trash', (draft) => {
    const target = draft.items[item.id]; if (!target?.deletedAt) return;
    delete target.deletedAt; delete draft.tombstones[item.id];
    target.updatedAt = new Date().toISOString(); target.revision += 1;
    if (target.role === 'series_template') reconcileRecurrences(draft);
  });
  const captureQuickItem = () => {
    if (!quick.trim()) return;
    const item = createUiItem(quick.trim());
    commit('Quick capture', (draft) => { draft.items[item.id] = clean(item); runAutomationEvents(draft, [{ id: createId(), type: 'item.created', at: item.createdAt, itemId: item.id, after: clean(item), causationId: createId(), depth: 0 }]); });
    setQuick('');
    setEditorIsNew(true); setEditor(item);
  };

  return <div className="app-shell">
    <aside className="sidebar"><div className="sidebar-brand"><div className="brand-mark small">U</div><span>Universal</span></div><nav>{nav.map(([target, icon, label, beta]) => <button key={target} className={page === target ? 'active' : ''} onClick={() => setPage(target)}><LineIcon name={icon}/><span>{label}</span>{beta && <em className="nav-beta" title="This area is still being tested and improved.">Beta</em>}{target === 'all' && <b title={`${openItems} active ${openItems === 1 ? 'item' : 'items'}`}>{openItems}</b>}</button>)}</nav><div className="sidebar-bottom"><button onClick={() => setTransfer(true)}><LineIcon name="transfer"/><span>Transfer</span></button><button onClick={() => { lock(session); setSession(null); setBoot('locked'); }}><LineIcon name="lock"/><span>Lock</span></button></div></aside>
    <main className="content">
      <header className="topbar"><div><span className="mobile-brand">Universal</span><span className="sync-state"><i /> Encrypted locally</span></div><div className="top-actions"><button className="mobile-only-lock" aria-label="Lock" onClick={() => { lock(session); setSession(null); setBoot('locked'); }}><LineIcon name="lock"/></button><button className="notice-button" aria-label="Notifications" aria-expanded={noticeCenterOpen} onClick={() => { setNoticeCenterOpen((open) => !open); setPopupNoticeIds([]); }} title="Notifications"><LineIcon name="bell"/>{notices.length > 0 && <b>{notices.length}</b>}</button></div></header>
      {!noticeCenterOpen && popupNoticeIds.length > 0 && <div className="notice-tray notice-popups">{popupNoticeIds.slice(-3).reverse().map((id) => notices.find((notice) => notice.id === id)).filter((notice): notice is Notice => Boolean(notice)).map((notice) => <article className="notice-card" key={notice.id}><button className="notice-content" onClick={() => openNoticeItem(notice)}><strong>{notice.title}</strong><span>{notice.body}</span></button><button className="notice-dismiss" aria-label="Close notification" onClick={() => dismissPopupNotice(notice.id)}><CloseIcon /></button></article>)}</div>}
      {noticeCenterOpen && <aside className="notification-center" aria-label="Notification center"><header><h2>Notifications</h2><button className="icon-button" aria-label="Close notification center" onClick={() => setNoticeCenterOpen(false)}><CloseIcon /></button></header><div className="notification-list">{notices.length ? notices.slice().reverse().map((notice) => <article className="notice-card" key={notice.id}><button className="notice-content" onClick={() => openNoticeItem(notice)}><strong>{notice.title}</strong><span>{notice.body}</span></button><button className="notice-dismiss" aria-label="Delete notification" onClick={() => deleteNotice(notice.id)}><CloseIcon /></button></article>) : <p className="empty">No notifications</p>}</div></aside>}
      {page === 'home' && <><section className="home-summary"><p>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}<span>·</span><strong>{openItems ? `${openItems} active ${openItems === 1 ? 'item' : 'items'}` : 'Everything is clear'}</strong></p></section><ViewsPage workspace={workspace} commit={commit} onEditItem={setEditor} onState={changeItemState} /></>}
      {page === 'calendar' && <CalendarPage workspace={workspace} commit={commit} onEditItem={setEditor} />}
      {page === 'all' && (() => { const recurringItems = Object.values(workspace.items).filter((item) => item.role === 'series_template' && !item.habit && !item.deletedAt && !isItemTemplate(item)); const templateItems = Object.values(workspace.items).filter((item) => isItemTemplate(item) && !item.deletedAt); return <section className="page-section"><div className="all-sections">{(['open', 'done', 'auto_closed', 'cancelled', 'archived'] as const).map((state) => { const items = Object.values(workspace.items).filter((item) => item.state === state && !item.deletedAt && !isItemTemplate(item) && (item.role !== 'series_template' || Boolean(item.habit)) && !isHabitOccurrence(workspace, item)); return <details key={state} open={state === 'open' || state === 'auto_closed'}><summary><span>{stateNames[state]}</span><b>{items.length}</b></summary><div className="item-list">{items.map((item) => <ItemCard key={item.id} item={item} onEdit={() => setEditor(item)} onState={(nextState) => changeItemState(item, nextState)} />)}</div></details>; })}<details open={recurringItems.length > 0} className="recurring-items"><summary><span>Recurring items</span><b>{recurringItems.length}</b></summary><p className="section-help">These are the repeating source items. Each scheduled cycle appears separately in the status sections above.</p><div className="item-list">{recurringItems.length ? recurringItems.map((item) => <ItemCard key={item.id} item={item} onEdit={() => setEditor(item)} onState={(nextState) => changeItemState(item, nextState)} />) : <p className="empty">No recurring items yet.</p>}</div></details><details open={templateItems.length > 0} className="recurring-items"><summary><span>Templates</span><b>{templateItems.length}</b></summary><div className="item-list">{templateItems.length ? templateItems.map((item) => <ItemCard key={item.id} item={item} onEdit={() => setEditor(item)} onState={(nextState) => changeItemState(item, nextState)} />) : <p className="empty">No templates yet.</p>}</div></details></div><AllItemsCollections items={Object.values(workspace.items).filter((item) => !item.deletedAt && !isItemTemplate(item) && !isHabitOccurrence(workspace, item))} onEdit={setEditor} onState={changeItemState} /><DeletedItemsList items={deletedItems} onRestore={restoreItem} /></section>; })()}
      {page === 'automations' && <AutomationsPage workspace={workspace} commit={commit} />}
      {page === 'settings' && <SettingsPage workspace={workspace} commit={commit} onTransfer={() => setTransfer(true)} onImportFile={(file) => { void portableFromFile(file, workspace).then(({ source, warnings }) => { if (warnings.length) setToast(warnings[0]!); setPortableImportSource(source); }).catch((error) => setToast(error instanceof Error ? error.message : String(error))); }} onNotify={() => void Notification.requestPermission().then((permission) => setToast(`Notification permission: ${permission}`))} onEnableBackground={() => void enableBackgroundNotifications()} onDisableBackground={() => void disableBackgroundNotifications()} onBackgroundContent={setBackgroundNotificationContent} />}
    </main>
    <div className="capture-dock"><div className="quick-capture"><input value={quick} onChange={(event) => setQuick(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && captureQuickItem()} placeholder="Add new task" aria-label="Add new task"/><button aria-label="Add task" disabled={!quick.trim()} onClick={captureQuickItem}>↵</button></div></div>
    <nav className="bottom-nav">{nav.map(([target, icon, label, beta]) => <button aria-label={label} key={target} className={page === target ? 'active' : ''} onClick={() => setPage(target)}><LineIcon name={icon}/><span>{label === 'Automations' ? 'Rules' : label}{beta && <em className="nav-beta">Beta</em>}</span></button>)}</nav>
    {editor && <ItemEditor initial={editor} workspace={workspace} isNew={editorIsNew} onClose={() => { setEditorIsNew(false); setEditor(null); }} onToggleSubtask={(id) => { const subtask = workspace.items[id]; if (subtask) changeItemState(subtask, subtask.state === 'done' ? 'open' : 'done'); }} onCreateSubtask={(title) => { const subtask = createUiItem(title, 'task'); commit('Create subtask', (draft) => { draft.items[subtask.id] = clean(subtask); }); return subtask; }} onSave={(item) => { const isNew = !workspace.items[item.id]; commit(isNew ? 'Create item' : 'Update item', (draft) => { const before = draft.items[item.id]; draft.items[item.id] = clean(item); if (before?.state === 'open' && (item.state === 'done' || item.state === 'cancelled') && item.occurrence && item.closure?.at) advanceCompletionAnchoredSeries(draft, item, item.closure.at); const event = { id: createId(), type: isNew ? 'item.created' as const : 'item.updated' as const, at: item.updatedAt, itemId: item.id, after: clean(item), causationId: createId(), depth: 0 }; runAutomationEvents(draft, [event]); if (item.role === 'series_template') reconcileRecurrences(draft); }); setEditorIsNew(false); setEditor(null); }} onDelete={(item) => { commit('Delete item', (draft) => { const target = draft.items[item.id]; if (target) { target.deletedAt = new Date().toISOString(); draft.tombstones[item.id] = target.deletedAt; } }); setEditorIsNew(false); setEditor(null); }} />}
    {transfer && <TransferDialog session={session} onClose={() => setTransfer(false)} onMerged={(next, message) => { setSession(next); setToast(message); }} />}
    {portableImportSource && <PortableImportDialog workspace={workspace} source={portableImportSource} onClose={() => setPortableImportSource(null)} onApply={(preview) => { commit('Import portable JSON package', (draft) => { const result = applyPortableImport(draft, preview); setToast(`Imported ${result.addedItems + result.copiedItems} items and ${result.addedViews + result.copiedViews} views`); }); setPortableImportSource(null); }} />}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}
