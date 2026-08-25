import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
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
const dateInput = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromDateInput = (value: string) => (value ? new Date(value).toISOString() : undefined) as string;
const localeForLanguage = (language?: WorkspaceLanguage): string => ({ en: 'en-GB', ru: 'ru-RU', es: 'es-ES', de: 'de-DE', fr: 'fr-FR', ko: 'ko-KR' }[language ?? (document.documentElement.lang as WorkspaceLanguage)] ?? 'en-GB');
const formatSystemDateTime = (value: string | number | Date, language?: WorkspaceLanguage): string => new Intl.DateTimeFormat(localeForLanguage(language), {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(value));
const formatRussianDateTime = formatSystemDateTime;
const formatViewDate = (value: string | number | Date, includeTime = true, language?: WorkspaceLanguage): string => {
  const formatter = new Intl.DateTimeFormat(localeForLanguage(language), {
    weekday: 'short', day: 'numeric', month: 'short', year: '2-digit',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const } : {}),
  });
  const values = Object.fromEntries(formatter.formatToParts(new Date(value)).map((part) => [part.type, part.value.replace(/\./g, '')]));
  const date = [values.weekday, values.day, values.month, values.year].filter(Boolean).join(' ');
  return includeTime ? `${date}, ${values.hour}:${values.minute}` : date;
};
const formatHeaderDate = (value: Date, language: WorkspaceLanguage): string => {
  const formatter = new Intl.DateTimeFormat(localeForLanguage(language), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const values = Object.fromEntries(formatter.formatToParts(value).map((part) => [part.type, part.value.replace(/\./g, '')]));
  return `${values.weekday} ${values.day} ${values.month} ${values.year} · ${values.hour}:${values.minute}:${values.second}`;
};
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
const isSleepTime = (date: Date, schedule: WorkspaceDocument['calendarPreferences']['sleepSchedule']) => {
  const minute = date.getHours() * 60 + date.getMinutes(); const wake = clockMinutes(schedule.wake); const sleep = clockMinutes(schedule.sleep);
  if (wake === sleep) return false;
  return sleep < wake ? minute >= sleep && minute < wake : minute >= sleep || minute < wake;
};
const commaList = (value: string) => value.split(',').map((part) => part.trim()).filter(Boolean);
type FriendlyDurationUnit = 'minutes' | 'hours' | 'days' | 'weeks';
type ReminderDurationUnit = 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'years';
const reminderIsoDuration = (amount: number, unit: ReminderDurationUnit) => unit === 'seconds' ? `PT${amount}S` : unit === 'minutes' ? `PT${amount}M` : unit === 'hours' ? `PT${amount}H` : unit === 'days' ? `P${amount}D` : unit === 'weeks' ? `P${amount}W` : unit === 'months' ? `P${amount}M` : `P${amount}Y`;
const parseReminderDuration = (value?: string): { amount: number; unit: ReminderDurationUnit; before: boolean } => { const before = (value ?? '').startsWith('-'); const match = /^(?:-)?(?:P(\d+)([DWMY])|PT(\d+)([HMS]))$/.exec(value ?? ''); if (!match) return { amount: 1, unit: 'hours', before: false }; const amount = Number(match[1] ?? match[3]); const code = match[2] ?? match[4]; return { amount, before, unit: code === 'S' ? 'seconds' : code === 'M' ? (match[3] ? 'minutes' : 'months') : code === 'H' ? 'hours' : code === 'W' ? 'weeks' : code === 'Y' ? 'years' : 'days' }; };
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
const calendarDuration = (startAt?: string, endAt?: string): { amount: number; unit: FriendlyDurationUnit } => {
  const start = startAt ? Date.parse(startAt) : Number.NaN;
  const end = endAt ? Date.parse(endAt) : Number.NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return { amount: 10, unit: 'minutes' };
  const minutes = Math.max(1, Math.round((end - start) / 60_000));
  if (minutes % (7 * 24 * 60) === 0) return { amount: minutes / (7 * 24 * 60), unit: 'weeks' };
  if (minutes % (24 * 60) === 0) return { amount: minutes / (24 * 60), unit: 'days' };
  if (minutes % 60 === 0) return { amount: minutes / 60, unit: 'hours' };
  return { amount: minutes, unit: 'minutes' };
};
const calendarDurationMs = (amount: number, unit: FriendlyDurationUnit) => {
  const minutes = unit === 'weeks' ? amount * 7 * 24 * 60 : unit === 'days' ? amount * 24 * 60 : unit === 'hours' ? amount * 60 : amount;
  return minutes * 60_000;
};
const createUiItem = (title = '', preset: ItemPreset = 'task', now = new Date()) => {
  const item = createItem(title, preset, now);
  const startAt = now.toISOString();
  item.schedule = { ...item.schedule, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, startAt, endAt: new Date(now.getTime() + 10 * 60_000).toISOString() };
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

function readUiBoolean(key: string, fallback: boolean) {
  if (typeof window === 'undefined') return fallback;
  const value = window.localStorage.getItem(`utm-ui:${key}`);
  return value === null ? fallback : value === '1';
}

function persistUiBoolean(key: string, value: boolean) {
  if (typeof window !== 'undefined') window.localStorage.setItem(`utm-ui:${key}`, value ? '1' : '0');
}

/**
 * Native <details> keeps its own DOM state, which becomes fragile once a
 * parent rerenders. Keep one small React state per section instead, and still
 * remember the user's choice between visits. This is deliberately reusable
 * for system collections as well as saved views.
 */
function PersistedDetails({ uiKey, defaultOpen, className, children }: {
  uiKey: string; defaultOpen: boolean; className?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readUiBoolean(uiKey, defaultOpen));
  useEffect(() => { setOpen(readUiBoolean(uiKey, defaultOpen)); }, [uiKey]);
  useEffect(() => { persistUiBoolean(uiKey, open); }, [uiKey, open]);
  return <details className={className} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>{children}</details>;
}

type LineIconName = 'home' | 'calendar' | 'items' | 'views' | 'rules' | 'settings' | 'lock' | 'bell' | 'transfer' | 'menu' | 'plus' | 'chevronDown';
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
    menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
    plus: <path d="M12 4v16M4 12h16"/>,
    chevronDown: <path d="m6 9 6 6 6-6"/>,
  };
  return <svg className="line-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{paths[name]}</svg>;
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
  { path: 'isHabit', label: 'Habit', group: 'Core' }, { path: 'activeRange', label: 'Inside active range now', group: 'Core' },
  { path: 'activeDuration', label: 'Has active range dates', group: 'Core' },
  { path: 'role', label: 'Role', group: 'Core' }, { path: 'priority', label: 'Priority', group: 'Core' },
  { path: 'tags', label: 'Tags', group: 'Core' }, { path: 'contexts', label: 'Contexts', group: 'Core' }, { path: 'list', label: 'Task list', group: 'Core' },
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
  { path: 'subtasks', label: 'Subtasks', group: 'Connections' }, { path: 'parent', label: 'Parent item', group: 'Connections' },
  { path: 'isSubtask', label: 'Subtask', group: 'Connections' }, { path: 'isParent', label: 'Parent item', group: 'Connections' },
  { path: 'parentDepth', label: 'Parent depth', group: 'Connections' }, { path: 'childDepth', label: 'Child depth', group: 'Connections' },
  { path: 'attachments', label: 'Links', group: 'Connections' },
  { path: 'closure.at', label: 'Closed at', group: 'History' }, { path: 'closure.actor', label: 'Closed by', group: 'History' },
  { path: 'closure.reason', label: 'Closure reason', group: 'History' }, { path: 'occurrence.seriesId', label: 'Series ID', group: 'History' },
  { path: 'occurrence.recurrenceId', label: 'Occurrence date', group: 'History' }, { path: 'occurrence.sequence', label: 'Occurrence sequence', group: 'History' },
  { path: 'cycleHistory', label: 'Cycle history', group: 'History' },
  { path: 'createdAt', label: 'Created at', group: 'System' }, { path: 'updatedAt', label: 'Last modified', group: 'System' },
  { path: 'createdWithAppName', label: 'Created with app', group: 'System' }, { path: 'createdWithVersion', label: 'Created with version', group: 'System' },
  { path: 'createdWithAppId', label: 'Application ID', group: 'System' }, { path: 'schemaVersion', label: 'Schema version', group: 'System' },
  { path: 'revision', label: 'Revision', group: 'System' }, { path: 'id', label: 'Item ID', group: 'System' },
  { path: 'isTemplate', label: 'Template', group: 'System' },
];

const viewAccentOptions = [
  { value: '#d9485f', label: 'Coral' },
  { value: '#c27a00', label: 'Amber' },
  { value: '#087f73', label: 'Teal' },
  { value: '#2864c7', label: 'Blue' },
  { value: '#7048b8', label: 'Violet' },
  { value: '#b83280', label: 'Berry' },
] as const;

const viewFieldOptions = (workspace: WorkspaceDocument): ViewFieldOption[] => {
  const scriptFields = new Map<string, ViewFieldOption>();
  Object.values(workspace.items).flatMap((item) => item.scripts ?? []).forEach((script) => {
    if (!scriptFields.has(script.key)) scriptFields.set(script.key, { path: `script.${script.key}`, label: script.label, group: 'Scripts' });
  });
  return [
    ...builtInViewFields,
    ...Object.values(workspace.customFields).map((field) => ({ path: `custom.${field.key}`, label: field.label, group: 'Custom fields' })),
    ...scriptFields.values(),
  ];
};
const creationDefaultPaths = new Set([
  'title', 'bodyMarkdown', 'state', 'priority', 'tags', 'contexts', 'list',
  'schedule.availableFrom', 'schedule.startAt', 'schedule.endAt', 'schedule.dueAt', 'schedule.estimatedDuration', 'schedule.timezone', 'schedule.allDay',
  'recurrence.rrule', 'recurrence.rdates', 'recurrence.exdates', 'recurrence.timezone', 'recurrence.activationOffset', 'recurrence.dueOffset', 'recurrence.closeAt', 'recurrence.anchor', 'recurrence.autoRenew',
  'progress.mode', 'progress.current', 'progress.target', 'progress.unit',
  'habit.target', 'habit.unit', 'habit.streakMode', 'reminders', 'attachments',
]);
const creationDefaultFieldOptions = (workspace: WorkspaceDocument) => viewFieldOptions(workspace).filter((field) => creationDefaultPaths.has(field.path) || field.path.startsWith('custom.'));
const defaultValueForPath = (workspace: WorkspaceDocument, path: string): unknown => {
  const custom = path.startsWith('custom.') ? workspace.customFields[path.slice('custom.'.length)] : undefined;
  if (custom) return custom.kind === 'boolean' ? false : custom.kind === 'number' ? 0 : custom.kind === 'multi_enum' ? [] : '';
  if (path === 'state') return 'open';
  if (path === 'priority') return 0;
  if (['tags', 'contexts', 'recurrence.rdates', 'recurrence.exdates', 'reminders', 'attachments'].includes(path)) return [];
  if (['schedule.allDay', 'recurrence.autoRenew'].includes(path)) return false;
  if (path === 'progress.mode') return 'boolean';
  if (['progress.current', 'progress.target', 'habit.target'].includes(path)) return 0;
  if (path === 'habit.unit') return 'times';
  if (path === 'habit.streakMode') return 'manual_only';
  if (path === 'recurrence.closeAt') return 'next_activation';
  if (path === 'recurrence.anchor') return 'schedule';
  if (path === 'recurrence.rrule') return 'FREQ=WEEKLY;INTERVAL=1';
  if (path === 'schedule.timezone' || path === 'recurrence.timezone') return Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (path === 'schedule.estimatedDuration') return 'PT10M';
  if (path.startsWith('schedule.') && path.endsWith('At') || path === 'schedule.availableFrom') return new Date().toISOString();
  return '';
};
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
    'occurrence.recurrenceId': 'Aug 24, 10:00', 'occurrence.sequence': '12', cycleHistory: '4 finished cycles', subtasks: 'Draft outline, Review notes', parent: 'Quarterly review',
    isSubtask: 'Yes', isParent: 'Yes', parentDepth: '1', childDepth: '2', createdAt: 'Aug 12, 14:20', updatedAt: 'Today, 09:45',
    createdWithAppName: 'Universal Task Manager', createdWithVersion: APP_VERSION, createdWithAppId: 'dev.universal-task-manager',
    schemaVersion: '1.8.0', revision: '7', id: 'itm_example_20260824',
  } as Record<string, string>)[path] ?? 'Example value';
};
const readItemField = (item: UniversalItem, field: string, workspace?: WorkspaceDocument, now = new Date()): unknown => {
  if (field === 'description') field = 'bodyMarkdown';
  if (field === 'schedule.estimatedDuration') {
    if (item.schedule?.estimatedDuration) return item.schedule.estimatedDuration;
    if (item.schedule?.startAt && item.schedule?.endAt) {
      const milliseconds = new Date(item.schedule.endAt).getTime() - new Date(item.schedule.startAt).getTime();
      if (Number.isFinite(milliseconds) && milliseconds >= 0) return toIsoDuration(milliseconds / 60_000, 'minutes');
    }
    return undefined;
  }
  if (workspace && field === 'subtasks') return item.relations.filter((relation) => relation.type === 'parent').map((relation) => workspace.items[relation.targetId]?.title ?? relation.targetId);
  if (workspace && field === 'parent') {
    const parent = Object.values(workspace.items).find((candidate) => candidate.relations.some((relation) => relation.type === 'parent' && relation.targetId === item.id));
    return parent?.title;
  }
  if (workspace && ['isTemplate', 'isSubtask', 'isParent', 'parentDepth', 'childDepth'].includes(field)) {
    if (field === 'isTemplate') return isItemTemplate(item);
    const relation = relationContext(workspace, item);
    return relation[field as keyof typeof relation];
  }
  if (field.startsWith('custom.') && workspace) {
    const key = field.slice(7);
    const definition = Object.values(workspace.customFields).find((candidate) => candidate.key === key);
    if (definition?.kind === 'formula') return evaluateFormulas(item, Object.values(workspace.customFields), now).values[key];
  }
  if (field.startsWith('script.') && workspace) {
    const key = field.slice(7);
    const definition = item.scripts?.find((script) => script.key === key);
    const result = evaluateItemScripts(item, (id) => workspace.items[id], now).values[key];
    if (definition?.resultKind === 'duration' && typeof result === 'number') return formatComputedDuration(result);
    return result;
  }
  return field.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, item);
};
const formatComputedDuration = (milliseconds: number): string => {
  const sign = milliseconds < 0 ? '−' : '';
  const totalSeconds = Math.round(Math.abs(milliseconds) / 1_000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [days ? `${days} d` : '', hours ? `${hours} h` : '', minutes ? `${minutes} min` : '', seconds ? `${seconds} s` : ''].filter(Boolean).slice(0, 3);
  return `${sign}${parts.join(' ') || '0 s'}`;
};
const formatScriptResult = (value: unknown, kind: ItemScriptField['resultKind']): string => kind === 'duration' && typeof value === 'number' ? formatComputedDuration(value) : String(value ?? '—');
const displayViewValue = (value: unknown, field: string, language?: WorkspaceLanguage): string => {
  if (value === undefined || value === null || value === '') return '';
  if ((field.endsWith('Duration') || field.endsWith('Offset')) && typeof value === 'string' && /^P/.test(value)) {
    const parsed = parseFriendlyDuration(value);
    const totalMinutes = Math.round(calendarDurationMs(parsed.amount, parsed.unit) / 60_000);
    if (totalMinutes < 60) return `${totalMinutes} min`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours} h${minutes ? ` ${minutes} min` : ''}`;
  }
  if ((field.endsWith('At') || field.endsWith('Date') || field === 'createdAt' || field === 'updatedAt') && typeof value === 'string') {
    const date = new Date(value); if (!Number.isNaN(date.getTime())) return formatViewDate(date, true, language);
  }
  if (field.startsWith('script.') && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const date = new Date(value); if (!Number.isNaN(date.getTime())) return formatViewDate(date, true, language);
  }
  if (Array.isArray(value)) return value.length ? value.map((entry) => typeof entry === 'object' ? JSON.stringify(entry) : String(entry)).join(', ') : '';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
};

function ItemCard({ item, onEdit, onState, fields, workspace, celebrating = false }: { item: UniversalItem; onEdit: () => void; onState: (state: UniversalItem['state']) => void; fields?: string[]; workspace?: WorkspaceDocument; celebrating?: boolean }) {
  const due = item.schedule?.dueAt ?? item.schedule?.startAt;
  const today = new Date().toISOString().slice(0, 10);
  const isHabit = Boolean(item.habit);
  const habitCompletedToday = isHabit && Boolean(item.habit?.completedDates?.includes(today));
  const visiblyClosed = isHabit ? habitCompletedToday : item.state !== 'open';
  // An empty field selection means “use the familiar All items layout”.
  // Custom rendering starts only after the user has selected at least one field.
  const customDisplay = fields !== undefined && fields.length > 0;
  const metadataFields = (fields?.filter((field) => field !== 'title' && field !== 'priority') ?? [])
    .map((field) => ({ field, value: displayViewValue(readItemField(item, field, workspace), field, workspace?.calendarPreferences.language) }));
  return <article className={`item-card state-${item.state}${celebrating ? ' is-celebrating' : ''}`}>
    <button className="state-toggle" aria-label={isHabit ? (habitCompletedToday ? 'Undo habit completion today' : 'Complete habit today') : item.state === 'open' ? 'Complete item' : 'Reopen item'} onClick={() => onState(visiblyClosed ? 'open' : 'done')}>
      {visiblyClosed ? '✓' : ''}
    </button>
    <button className="item-main" onClick={onEdit}>
      {(!customDisplay || fields?.includes('title')) && <span className="item-title">{item.title}</span>}
      {!customDisplay && <span className="item-meta"><span className={`preset ${inferredPreset(item)}`}>{inferredPreset(item)}</span>{due && <span>{formatViewDate(due, !item.schedule?.allDay, workspace?.calendarPreferences.language)}</span>}{item.schedule?.estimatedDuration && <span>{item.schedule.estimatedDuration}</span>}{item.tags.slice(0, 2).map((tag) => <span key={tag}>#{tag}</span>)}{item.closure?.reason === 'auto_renew' && <span className="auto-pill">auto-closed</span>}</span>}
      {customDisplay && metadataFields.length > 0 && <span className="view-item-fields">{metadataFields.map(({ field, value }) => <span key={field}>{value && <small>{viewFieldLabel(workspace!, field)}</small>}{value}</span>)}</span>}
    </button>
    {item.priority && (!customDisplay || fields?.includes('priority')) ? <button className={`priority p${item.priority}`} title={`Priority ${item.priority}: ${priorityNames[item.priority]}. Click to edit.`} aria-label={`Priority ${item.priority}: ${priorityNames[item.priority]}. Edit item`} onClick={onEdit}>{priorityNames[item.priority]}</button> : null}
  </article>;
}

function DeletedItemsList({ items, onRestore, onClear, onDelete }: { items: UniversalItem[]; onRestore: (item: UniversalItem) => void; onClear: () => void; onDelete: (item: UniversalItem) => void }) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const sorted = [...items].sort((left, right) => new Date(right.deletedAt!).getTime() - new Date(left.deletedAt!).getTime());
  return <details className="trash-section" open={sorted.length > 0}>
    <summary><span>Trash</span><b>{sorted.length}</b>{sorted.length > 0 && <button type="button" className="secondary compact-action trash-clear" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setConfirmClear(true); }}>Clear trash</button>}</summary>
    <p className="section-help">Deleted items stay here until you restore them.</p>
    {confirmClear && sorted.length > 0 && <div className="trash-confirm" role="alert"><strong>Permanently delete {sorted.length} {sorted.length === 1 ? 'item' : 'items'}?</strong><span>This cannot be undone.</span><div><button type="button" className="secondary compact-action" onClick={() => setConfirmClear(false)}>Cancel</button><button type="button" className="danger compact-action" onClick={() => { onClear(); setConfirmClear(false); }}>Delete permanently</button></div></div>}
    <div className="trash-list">{sorted.length ? sorted.map((item) => <article className="trash-item" key={item.id}>
      <div><span className="trash-title">{item.title || 'Untitled'}</span><span className="item-meta"><span className={`preset ${item.preset}`}>{item.preset}</span><span>{stateNames[item.state]}</span><span>Deleted {formatSystemDateTime(item.deletedAt!)}</span></span></div>
      <div className="trash-item-actions">{confirmDeleteId === item.id ? <><button type="button" className="secondary compact-action" onClick={() => setConfirmDeleteId(null)}>Cancel</button><button type="button" className="danger compact-action" onClick={() => { onDelete(item); setConfirmDeleteId(null); }}>Delete permanently</button></> : <><button type="button" className="secondary compact-action" aria-label={`Restore ${item.title || 'Untitled'}`} onClick={() => onRestore(item)}>Restore</button><button type="button" className="secondary compact-action" aria-label={`Delete ${item.title || 'Untitled'} permanently`} onClick={() => setConfirmDeleteId(item.id)}>Delete</button></>}</div>
    </article>) : <p className="empty">Trash is empty.</p>}</div>
  </details>;
}

/** Extra system collections. They are intentionally read-only for now; Views will make them configurable later. */
const ALL_ITEMS_VIEW_ID = '__all_items__';
const allItemsViewFor = (workspace: WorkspaceDocument): SavedView => workspace.views[ALL_ITEMS_VIEW_ID] ?? {
  id: ALL_ITEMS_VIEW_ID, name: 'All items', query: { source: 'role != "series_template" && isTemplate != true' }, renderer: 'list', sort: [{ field: 'updatedAt', direction: 'desc' }], fields: [],
};

function AllItemsSettings({ workspace, view, onSave, onClose }: { workspace: WorkspaceDocument; view: SavedView; onSave: (view: SavedView) => void; onClose: () => void }) {
  const [fields, setFields] = useState(view.fields ?? []);
  const toggle = (path: string) => setFields((current) => current.includes(path) ? current.filter((entry) => entry !== path) : [...current, path]);
  return <div className="modal-backdrop"><section className="dialog all-items-settings" role="dialog" aria-modal="true" aria-label="Customize all items"><header><div><p className="dialog-kicker">ALL ITEMS</p><h2>Customize all items</h2></div><button className="icon-button" aria-label="Close all items settings" onClick={onClose}><CloseIcon /></button></header><p className="hint">This uses the same SavedView field model as every other view. The status sections and Trash stay in their current layout.</p><div className="field-groups all-items-field-groups">{[...new Set(viewFieldOptions(workspace).map((field) => field.group))].map((group) => <details key={group} open><summary>{group}</summary><div className="field-options">{viewFieldOptions(workspace).filter((field) => field.group === group).map((field) => <label className="check" key={field.path}><input type="checkbox" checked={fields.includes(field.path)} onChange={() => toggle(field.path)} />{field.label}<small>{field.path}</small></label>)}</div></details>)}</div><footer className="drawer-actions"><span /><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" onClick={() => { onSave({ ...view, fields }); onClose(); }}>Save fields</button></footer></section></div>;
}

function AllItemsCollections({ items, fields, workspace, onEdit, onState }: { items: UniversalItem[]; fields: string[]; workspace: WorkspaceDocument; onEdit: (item: UniversalItem) => void; onState: (item: UniversalItem, state: UniversalItem['state']) => void }) {
  const now = Date.now();
  const collections = [
    { name: 'Overdue', help: 'Open items whose deadline has passed.', items: items.filter((item) => item.state === 'open' && item.schedule?.dueAt && new Date(item.schedule.dueAt).getTime() < now) },
    { name: 'Unscheduled', help: 'Open items without a scheduled time or deadline.', items: items.filter((item) => item.state === 'open' && !item.schedule?.startAt && !item.schedule?.dueAt) },
    { name: 'With reminders', help: 'Items that still have at least one active reminder.', items: items.filter((item) => item.reminders.some((reminder) => !reminder.acknowledgedAt)) },
  ];
  return <PersistedDetails uiKey="all:planning" defaultOpen={false} className="all-item-collections">
    <summary><span>Planning &amp; attention</span><b>{collections.reduce((total, collection) => total + collection.items.length, 0)}</b></summary>
    <p className="section-help">Useful system collections. An item can appear here and in its status section; custom categories will come later through Views.</p>
    {collections.map((collection) => <PersistedDetails key={collection.name} uiKey={`all:collection:${collection.name}`} defaultOpen={collection.name === 'Overdue' && collection.items.length > 0}>
      <summary><span>{collection.name}</span><b>{collection.items.length}</b></summary>
      <p className="section-help">{collection.help}</p>
      <div className="item-list">{collection.items.length ? collection.items.map((item) => <ItemCard key={item.id} item={item} fields={fields} workspace={workspace} onEdit={() => onEdit(item)} onState={(state) => onState(item, state)} />) : <p className="empty">None.</p>}</div>
    </PersistedDetails>)}
  </PersistedDetails>;
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

function effectiveWorkspaceNow(workspace: WorkspaceDocument, realNow = new Date()): Date {
  const clock = workspace.calendarPreferences.testClock;
  if (!clock?.enabled || !clock.secondsPerDay || !clock.startedAt || !clock.virtualAt) return realNow;
  const elapsed = Math.max(0, realNow.getTime() - new Date(clock.startedAt).getTime());
  return new Date(new Date(clock.virtualAt).getTime() + elapsed * 86_400_000 / clock.secondsPerDay);
}

function filteredItems(workspace: WorkspaceDocument, view?: SavedView, now = effectiveWorkspaceNow(workspace)): UniversalItem[] {
  const templateFilterRequested = Boolean(view && /\bisTemplate\b/.test(view.query.source));
  const available = Object.values(workspace.items).filter((item) => !item.deletedAt && (!view?.list || item.list === view.list) && (templateFilterRequested || !isItemTemplate(item)) && !(item.role === 'occurrence' && item.occurrence?.seriesId && workspace.items[item.occurrence.seriesId]?.habit));
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
      const combined = [...standalone, ...logicalOccurrences, ...matchingSeries.filter((series) => !logicalOccurrences.some((item) => item.occurrence?.seriesId === series.id))];
      // A reconciler retry can leave two materialized rows for the same cycle.
      // Keep one logical occurrence in every view, while preserving independent items.
      const seenLogical = new Set<string>();
      items = combined.filter((item) => {
        const key = item.role === 'occurrence' && item.occurrence?.seriesId
          ? `occurrence:${item.occurrence.seriesId}:${item.occurrence.recurrenceId ?? item.schedule?.startAt ?? item.id}`
          : `item:${item.id}`;
        if (seenLogical.has(key)) return false;
        seenLogical.add(key); return true;
      });
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
  // A parent relation is stored on the parent and points at the child. The
  // reverse lookup above finds parents; walking children must therefore read
  // the current parent's own relations (the previous implementation walked
  // the reverse direction twice and made isParent/childDepth incorrect).
  const children = (id: string) => (workspace.items[id]?.relations ?? [])
    .filter((relation) => relation.type === 'parent' && Boolean(workspace.items[relation.targetId]))
    .map((relation) => relation.targetId);
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
  initial: UniversalItem; workspace: WorkspaceDocument; isNew?: boolean; onSave: (item: UniversalItem) => void; onDelete: (item: UniversalItem) => void; onCreateSubtask: (title: string, parentId: string) => UniversalItem; onToggleSubtask: (id: string) => void; onClose: () => void;
}) {
  const [item, setItem] = useState(() => clean(initial));
  const [tags, setTags] = useState(item.tags.join(', '));
  const [contexts, setContexts] = useState(item.contexts.join(', '));
  const [recurring, setRecurring] = useState(item.role === 'series_template');
  const [repeatIntervalDraft, setRepeatIntervalDraft] = useState('1');
  const [timezoneOpen, setTimezoneOpen] = useState(false);
  const [error, setError] = useState('');
  const [jsonDraft, setJsonDraft] = useState(() => JSON.stringify(initial, null, 2));
  const [jsonDirty, setJsonDirty] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [isTemplate, setIsTemplate] = useState(Boolean(item.extensions?.['utm:template']));
  const templates = Object.values(workspace.items).filter((candidate) => !candidate.deletedAt && candidate.extensions?.['utm:template'] === true && candidate.id !== item.id);
  const focusTitleOnOpen = typeof window !== 'undefined' && window.matchMedia('(min-width: 621px)').matches;
  // Parent links are stored on the parent item (parent -> child). Derive the
  // reverse side so a child always shows its parent in the editor.
  const parentItems = Object.values(workspace.items).filter((candidate) => !candidate.deletedAt && candidate.id !== item.id && candidate.relations.some((relation) => relation.type === 'parent' && relation.targetId === item.id));
  const applyTemplate = (template: UniversalItem) => {
    const identity = { id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt, revision: item.revision, createdWithAppId: item.createdWithAppId, createdWithAppName: item.createdWithAppName, createdWithVersion: item.createdWithVersion };
    const next = clean({ ...template, ...identity, state: 'open' as const, role: 'standalone' as const, extensions: { ...template.extensions } });
    const cleanNext = withoutTemplateMarker(next);
    setItem(cleanNext); setTags(cleanNext.tags.join(', ')); setContexts(cleanNext.contexts.join(', ')); setRecurring(false); setIsTemplate(false); setJsonDraft(JSON.stringify(cleanNext, null, 2)); setJsonDirty(false);
  };
  const importJsonRef = useRef<HTMLInputElement>(null);
  const definitions = Object.values(workspace.customFields);
  const formulas = evaluateFormulas(item, definitions);
  const scriptResults = evaluateItemScripts(item, (id) => workspace.items[id]);
  const patchScript = (id: string, patch: Partial<ItemScriptField>) => patchItem({ scripts: (item.scripts ?? []).map((script) => script.id === id ? { ...script, ...patch } : script) });
  const addScript = () => patchItem({ scripts: [...(item.scripts ?? []), { id: createId(), key: `calculation_${(item.scripts?.length ?? 0) + 1}`, label: 'New calculation', source: 'timeUntil(schedule.startAt)', resultKind: 'text' }] });
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
  const rruleMap = () => new Map((item.recurrence?.rrule ?? 'FREQ=WEEKLY;INTERVAL=1').split(';').filter(Boolean).map((part) => { const [key, ...rest] = part.split('='); return [key!.trim().toUpperCase(), rest.join('=').trim()]; }));
  const updateRrule = (changes: Record<string, string | undefined>) => {
    const parts = rruleMap();
    Object.entries(changes).forEach(([key, value]) => { if (value) parts.set(key, value); else parts.delete(key); });
    patchRecurrence({ rrule: [...parts].map(([key, value]) => `${key}=${value}`).join(';') });
  };
  // Imported RRULEs are not always consistent about casing. Normalize the
  // frequency once so the selector and its human-readable unit cannot drift
  // apart (e.g. MONTHLY with a stale "week" suffix).
  const repeatFrequency = (rruleMap().get('FREQ') ?? 'WEEKLY').toUpperCase();
  const repeatInterval = Number(rruleMap().get('INTERVAL') ?? 1);
  const repeatUnit = ({ MINUTELY: 'minute', HOURLY: 'hour', DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' } as Record<string, string>)[repeatFrequency] ?? 'week';
  const repeatDays = (rruleMap().get('BYDAY') ?? '').split(',').filter(Boolean);
  useEffect(() => {
    setRepeatIntervalDraft(String(Number.isFinite(repeatInterval) && repeatInterval > 0 ? repeatInterval : 1));
    // This effect runs when a different item or recurrence rule is loaded.
    // While typing, the draft itself is intentionally left untouched until
    // blur so an empty number field does not immediately turn back into “1”.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.recurrence?.rrule]);
  const activation = parseFriendlyDuration(item.recurrence?.activationOffset);
  const activeRange = recurring && Boolean(item.recurrence?.autoRenew) && item.recurrence?.closeAt === 'due' && activation.amount === 0;
  const estimate = item.schedule?.estimatedDuration ? parseEstimateDuration(item.schedule.estimatedDuration) : { amount: 45, unit: 'minutes' as FriendlyDurationUnit };
  const scheduledDuration = calendarDuration(item.schedule?.startAt, item.schedule?.endAt);
  const patchScheduledDuration = (amount: number, unit: FriendlyDurationUnit) => {
    const start = item.schedule?.startAt ? Date.parse(item.schedule.startAt) : Number.NaN;
    if (!Number.isFinite(start)) return;
    patchSchedule({ endAt: new Date(start + calendarDurationMs(Math.max(1, amount), unit)).toISOString() });
  };
  const applyDurationPreset = (preset: string) => {
    if (preset === '1h') patchScheduledDuration(1, 'hours');
    else if (preset === '2h' || preset === '3h' || preset === '5h') patchScheduledDuration(Number(preset.slice(0, -1)), 'hours');
    else if (preset === 'until-sleep') {
      const start = item.schedule?.startAt ? new Date(item.schedule.startAt) : null;
      const sleep = workspace.calendarPreferences?.sleepSchedule?.sleep ?? '22:00';
      if (start) {
        const [hours, minutes] = sleep.split(':').map(Number);
        const end = new Date(start);
        end.setHours(hours || 22, minutes || 0, 0, 0);
        if (end.getTime() <= start.getTime()) end.setDate(end.getDate() + 1);
        patchSchedule({ endAt: end.toISOString(), allDay: false });
      }
    } else if (preset === 'all-day') {
      const start = item.schedule?.startAt ? new Date(item.schedule.startAt) : null;
      if (start) patchSchedule({ allDay: true, endAt: new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString() });
    }
    else if (preset) patchScheduledDuration(Number(preset), 'minutes');
  };
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
      const scriptKeys = new Set<string>();
      for (const script of item.scripts ?? []) {
        if (!script.label.trim()) throw new Error('Every script needs a name.');
        if (!/^[a-z][a-z0-9_]*$/.test(script.key)) throw new Error(`Script key “${script.key}” must start with a letter and use lowercase letters, numbers or underscores.`);
        if (scriptKeys.has(script.key)) throw new Error(`Script key “${script.key}” is duplicated.`);
        scriptKeys.add(script.key); parseExpression(script.source);
      }
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
        // The number input is intentionally kept as a draft while typing. Before
        // persistence, always materialize a complete, valid RRULE so a blank or
        // stale interval can never make the Automerge transaction fail.
        const recurrence = result.recurrence;
        const parts = new Map((recurrence?.rrule ?? 'FREQ=WEEKLY;INTERVAL=1').replace(/^RRULE:/i, '').split(';').filter(Boolean).map((part) => {
          const [key, ...rest] = part.split('='); return [key!.trim().toUpperCase(), rest.join('=').trim()];
        }));
        parts.set('FREQ', repeatFrequency || 'WEEKLY');
        parts.set('INTERVAL', String(Math.max(1, Number.parseInt(repeatIntervalDraft, 10) || 1)));
        if (activeRange || repeatFrequency !== 'WEEKLY' || !repeatDays.length) parts.delete('BYDAY');
        else parts.set('BYDAY', repeatDays.join(','));
        result.recurrence = {
          rrule: [...parts].map(([key, value]) => `${key}=${value}`).join(';'),
          rdates: Array.isArray(recurrence?.rdates) ? [...recurrence.rdates] : [],
          exdates: Array.isArray(recurrence?.exdates) ? [...recurrence.exdates] : [],
          timezone: recurrence?.timezone ?? result.schedule?.timezone ?? 'UTC',
          activationOffset: recurrence?.activationOffset ?? 'P7D',
          closeAt: recurrence?.closeAt ?? 'next_activation',
          anchor: recurrence?.anchor ?? 'schedule',
          autoRenew: recurrence?.autoRenew !== false,
        };
        result = { ...result, schedule: { ...result.schedule!, startAt: anchor } };
        // Validate the exact detached object that will be stored, not the draft
        // UI state. This turns parser failures into an inline editor error.
        buildRecurrenceRule(result);
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

  // A compact signal for existing items: it shows which optional sections contain data.
  // New items stay intentionally quiet until the user opens a section.
  const sectionMark = (filled: boolean) => !isNew && filled ? <span className="section-dot" aria-label="Contains data">•</span> : null;
  const dateField = (label: string, value: string | undefined, onChange: (value: string | undefined) => void, help?: string, onFocus?: () => void) => <div className="date-field"><div className="date-field-row"><input aria-label={label} type="datetime-local" value={dateInput(value)} onFocus={onFocus} onChange={(event) => onChange(fromDateInput(event.currentTarget.value))} /><button type="button" className="date-clear" aria-label={`Clear ${label}`} disabled={!value} onPointerDown={(event) => event.preventDefault()} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onChange(undefined); }}>Clear</button></div>{value && <small className="formatted-date">{formatViewDate(value, true, workspace.calendarPreferences.language)}</small>}{help && <small>{help}</small>}</div>;

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="drawer" role="dialog" aria-modal="true" aria-label="Item editor">
      <header className="drawer-head"><div><p className="eyebrow">UNIVERSAL ITEM</p><h2>{workspace.items[item.id] ? 'Edit item' : 'New item'}</h2></div><button className="icon-button" aria-label="Close item editor" onClick={onClose}><CloseIcon /></button></header>
      <div className="editor-scroll">
        <label className="item-title-field">Title<input autoFocus={focusTitleOnOpen} value={item.title} onChange={(event) => patchItem({ title: event.target.value })} placeholder="What needs to happen?" /></label>
        {isNew && templates.length > 0 && <details className="template-picker"><summary>Choose a saved template <span>Optional</span></summary><div className="details-body"><p className="schedule-explainer">Pick a template to prefill this new item. Nothing changes until you select one, and you can edit every field before saving.</p>{templates.map((template) => <button type="button" className="template-option" key={template.id} onClick={() => applyTemplate(template)}>{template.title || 'Untitled template'}</button>)}</div></details>}
        <details className="template-toggle"><summary>Template</summary><div className="details-body"><label className="check"><input type="checkbox" checked={isTemplate} onChange={(event) => setIsTemplate(event.target.checked)} /> Save this item as a template</label><p className="schedule-explainer">Templates are kept in the same workspace but do not appear in ordinary lists. They can be selected only while creating a new item.</p></div></details>
        <details className="description-section"><summary>Description {sectionMark(Boolean(item.bodyMarkdown.trim()))}</summary><div className="details-body">
          <label><span className="hint">Markdown</span><textarea rows={5} value={item.bodyMarkdown} onChange={(event) => patchItem({ bodyMarkdown: event.target.value })} placeholder="Context, links, checklists…" /></label>
          {item.bodyMarkdown && <details className="markdown-details"><summary>Markdown preview</summary><div className="markdown preview"><ReactMarkdown>{item.bodyMarkdown}</ReactMarkdown></div></details>}
        </div></details>
        <details><summary>Dates &amp; time {sectionMark(Boolean(item.schedule?.availableFrom || item.schedule?.startAt || item.schedule?.endAt || item.schedule?.dueAt || item.schedule?.estimatedDuration || item.schedule?.allDay))}</summary><div className="details-body">
          <p className="schedule-explainer">Scheduled time reserves a calendar block. A deadline is the latest completion time. Availability only says how early work may begin.</p>
          <SectionGuide title="Which date should I use?"><ul><li><strong>Event opens</strong> is when the item becomes active and starts its calendar block.</li><li><strong>Event ends</strong> is only the end of the calendar block.</li><li><strong>Due / Active range ends</strong> is the latest completion time and can close the active range.</li><li><strong>Available to work from</strong> is optional; it keeps reminders quiet before that time.</li></ul></SectionGuide>
          <details className="optional-field"><summary>Available to work from <span>Optional</span></summary><div className="details-body"><label>{dateField('Available to work from', item.schedule?.availableFrom, (value) => patchSchedule({ availableFrom: value }), 'Earliest intended time to begin; not a deadline.')}</label></div></details>
          <div className="form-grid two schedule-grid">
            <label><span>Event opens</span>{dateField('Event opens', item.schedule?.startAt, (value) => patchSchedule({ startAt: value }), 'When it begins and appears in the calendar.')}</label>
            <label><span>Duration</span><div className="duration-control"><select aria-label="Duration preset" value="" disabled={!item.schedule?.startAt} onChange={(event) => applyDurationPreset(event.target.value)}><option value="">Presets…</option><option value="15">15 min</option><option value="30">30 min</option><option value="45">45 min</option><option value="1h">1 hour</option><option value="2h">2 hours</option><option value="3h">3 hours</option><option value="5h">5 hours</option><option value="until-sleep">Until sleep</option><option value="all-day">All day</option></select><input className="duration-amount" type="number" min="1" aria-label="Calendar duration amount" value={scheduledDuration.amount} disabled={!item.schedule?.startAt} onChange={(event) => patchScheduledDuration(Number(event.target.value) || 1, scheduledDuration.unit)} /><select className="duration-unit" aria-label="Calendar duration unit" value={scheduledDuration.unit} disabled={!item.schedule?.startAt} onChange={(event) => patchScheduledDuration(scheduledDuration.amount, event.target.value as FriendlyDurationUnit)}><option value="minutes">Minutes</option><option value="hours">Hours</option><option value="days">Days</option><option value="weeks">Weeks</option></select></div><small>{item.schedule?.startAt ? 'Choose a preset or type a value. Changes Event ends; Due stays unchanged.' : 'Set Event opens first.'}</small></label>
            <label><span>Event ends</span>{dateField('Event ends', item.schedule?.endAt, (value) => patchSchedule({ endAt: value }), 'When the calendar block ends. Use with Event opens.')}</label>
            <label><span>Due / Active range ends</span>{dateField('Due / Active range ends', item.schedule?.dueAt, (value) => patchSchedule({ dueAt: value }), 'Latest acceptable completion time. Tap the empty field to copy Event opens.', () => { if (!item.schedule?.dueAt && item.schedule?.startAt) patchSchedule({ dueAt: item.schedule.startAt }); })}</label>
          </div>
          <div className="schedule-tools"><button className="timezone-button" aria-expanded={timezoneOpen} onClick={() => setTimezoneOpen((current) => !current)}><span>Timezone</span><strong>{item.schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}</strong><i aria-hidden>{timezoneOpen ? '−' : '+'}</i></button></div>
          {timezoneOpen && <div className="timezone-panel"><label>Timezone<input autoFocus list="iana-timezones" value={item.schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone} onChange={(event) => patchSchedule({ timezone: event.target.value })} /></label><small>Used for recurrence and daylight-saving calculations.</small><datalist id="iana-timezones">{typeof Intl.supportedValuesOf === 'function' && Intl.supportedValuesOf('timeZone').map((timezone) => <option value={timezone} key={timezone} />)}</datalist></div>}
        </div></details>

        <details><summary>Subtasks {sectionMark(item.relations.some((relation) => relation.type === 'parent'))}</summary><div className="details-body">
          <p className="schedule-explainer">Add existing items as steps of this item. Subtasks remain independent universal items and can be completed or edited on their own.</p>
          {item.relations.filter((relation) => relation.type === 'parent').map((relation) => { const subtask = workspace.items[relation.targetId]; const completed = subtask?.state === 'done'; return <div className={`subtask-row${completed ? ' completed' : ''}`} key={relation.id}><button type="button" className={`subtask-check${completed ? ' checked' : ''}`} aria-label={`${completed ? 'Reopen' : 'Complete'} subtask ${subtask?.title ?? relation.targetId}`} onClick={() => onToggleSubtask(relation.targetId)}>{completed ? '✓' : ''}</button><span>{subtask?.title ?? relation.targetId}</span><button type="button" aria-label="Remove subtask" onClick={() => patchItem({ relations: item.relations.filter((entry) => entry.id !== relation.id) })}><CloseIcon /></button></div>; })}
          <div className="inline-row"><input aria-label="New subtask title" value={newSubtaskTitle} onChange={(event) => setNewSubtaskTitle(event.target.value)} placeholder="New subtask title" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); const title = newSubtaskTitle.trim(); if (!title) return; const subtask = onCreateSubtask(title, item.id); patchItem({ relations: [...item.relations, { id: createId(), targetId: subtask.id, type: 'parent' }] }); setNewSubtaskTitle(''); } }} /><button className="secondary" onClick={() => { const title = newSubtaskTitle.trim(); if (!title) return; const subtask = onCreateSubtask(title, item.id); patchItem({ relations: [...item.relations, { id: createId(), targetId: subtask.id, type: 'parent' }] }); setNewSubtaskTitle(''); }}>Add subtask</button></div>
        </div></details>

        <details><summary>Reminders {sectionMark(item.reminders.length > 0)}</summary><div className="details-body">
          <p className="schedule-explainer">Notifications can happen before or at any important moment, independently of the scheduled time and deadline.</p>
          <SectionGuide title="How reminders behave"><p>Use more than one reminder when needed. Due reminders for the same item are shown as one card with a count. Closing the pop-up only hides it; deleting it from Notifications confirms those reminders so they do not return after the next unlock.</p></SectionGuide>
          {item.reminders.map((reminder, index) => { const relative = reminder.mode === 'relative'; const parsed = parseReminderDuration(reminder.offset); return <div className="reminder-row" key={reminder.id}><select aria-label={`Reminder ${index + 1} mode`} value={relative ? (parsed.before ? 'before' : 'after') : 'absolute'} onChange={(event) => patchItem({ reminders: item.reminders.map((entry, at) => { if (at !== index) return entry; const mode = event.target.value; return mode === 'absolute' ? { ...entry, mode: 'absolute', at: entry.at ?? new Date().toISOString() } : { ...entry, mode: 'relative', relativeTo: 'start', offset: reminderIsoDuration(parsed.amount, parsed.unit).replace(/^/, mode === 'before' ? '-' : '') }; }) })}><option value="absolute">At time</option><option value="before">Before Event opens</option><option value="after">After Event opens</option></select>{relative ? <><input type="number" min="1" aria-label={`Reminder ${index + 1} amount`} value={parsed.amount} onChange={(event) => patchItem({ reminders: item.reminders.map((entry, at) => at === index ? { ...entry, offset: reminderIsoDuration(Math.max(1, Number(event.target.value) || 1), parsed.unit).replace(/^/, parsed.before ? '-' : '') } : entry) })} /><select aria-label={`Reminder ${index + 1} unit`} value={parsed.unit} onChange={(event) => patchItem({ reminders: item.reminders.map((entry, at) => at === index ? { ...entry, offset: reminderIsoDuration(parsed.amount, event.target.value as ReminderDurationUnit).replace(/^/, parsed.before ? '-' : '') } : entry) })}><option>seconds</option><option>minutes</option><option>hours</option><option>days</option><option>weeks</option><option>months</option><option>years</option></select></> : <input aria-label={`Reminder ${index + 1} time`} type="datetime-local" value={dateInput(reminder.at)} onInput={(event) => patchItem({ reminders: item.reminders.map((entry, at) => { if (at !== index) return entry; const next = { ...entry }; const value = fromDateInput(event.currentTarget.value); if (value) next.at = value; else delete next.at; return next; }) })} />}<select aria-label={`Reminder ${index + 1} urgency`} value={reminder.urgency} onChange={(event) => patchItem({ reminders: item.reminders.map((entry, at) => at === index ? { ...entry, urgency: event.target.value as typeof entry.urgency } : entry) })}><option>normal</option><option>urgent</option><option>critical</option></select><button aria-label="Remove reminder" onClick={() => patchItem({ reminders: item.reminders.filter((_, at) => at !== index) })}><CloseIcon /></button></div>; })}
          <button className="secondary" onClick={() => patchItem({ reminders: [...item.reminders, { id: createId(), mode: 'absolute', at: item.schedule?.startAt ?? new Date().toISOString(), urgency: 'normal', repeatUntilAcknowledged: false }] })}>+ Add reminder</button>
        </div></details>

        <details className="compact-property"><summary>Priority {sectionMark(Boolean(item.priority))}</summary><div className="details-body"><label><select value={item.priority ?? 0} onChange={(event) => patchItem({ priority: Number(event.target.value) as NonNullable<UniversalItem['priority']> })}>{([0, 1, 2, 3, 4] as NonNullable<UniversalItem['priority']>[]).map((priority) => <option key={priority} value={priority}>{priority ? `${priority} — ${priorityNames[priority]}` : 'None'}</option>)}</select></label></div></details>
        <details className="compact-property"><summary>Estimated duration {sectionMark(Boolean(item.schedule?.estimatedDuration))}</summary><div className="details-body"><label><div className="duration-control"><input className="duration-amount" type="number" min="0" aria-label="Estimated duration amount" value={item.schedule?.estimatedDuration ? estimate.amount : ''} onChange={(event) => patchSchedule({ estimatedDuration: event.target.value ? toIsoDuration(Math.max(0, Number(event.target.value) || 0), estimate.unit) : undefined })} placeholder="45" /><select className="duration-unit" aria-label="Estimated duration unit" value={estimate.unit} onChange={(event) => patchSchedule({ estimatedDuration: toIsoDuration(estimate.amount, event.target.value as FriendlyDurationUnit) })}><option value="minutes">Minutes</option><option value="hours">Hours</option><option value="days">Days</option><option value="weeks">Weeks</option></select></div><small>How much time you expect this item to take.</small></label></div></details>
        <details className="compact-property"><summary>Tags {sectionMark(commaList(tags).length > 0)}</summary><div className="details-body"><label><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Add tags separated by commas" /></label>{collectedTags.length > 0 && <div className="tag-collection" aria-label="Available tags">{collectedTags.map((tag) => <button className={commaList(tags).includes(tag) ? 'active' : ''} key={tag} onClick={() => toggleTag(tag)}>#{tag}</button>)}</div>}</div></details>
        <details className="compact-property"><summary>Task link {sectionMark(Boolean(item.list))}</summary><div className="details-body"><label><input value={item.list ?? ''} list="item-list-values" onChange={(event) => patchItem({ list: event.target.value.trim() || undefined })} placeholder="Optional list name" /></label></div></details>
        <datalist id="item-list-values">{[...new Set(Object.values(workspace.items).map((entry) => entry.list).filter((list): list is string => Boolean(list)))].sort().map((list) => <option value={list} key={list} />)}</datalist>
        <details><summary>Status {sectionMark(item.state !== 'open')}</summary><div className="details-body"><label>Item status<select value={item.state} onChange={(event) => { const state = event.target.value as UniversalItem['state']; patchItem({ state, closure: state === 'open' ? undefined : { at: item.closure?.at ?? new Date().toISOString(), actor: item.closure?.actor ?? 'user', reason: state === 'cancelled' ? 'cancelled' : 'manual' } }); }}>{['open', 'done', 'cancelled', 'auto_closed', 'archived'].map((state) => <option key={state} value={state}>{stateNames[state as UniversalItem['state']]}</option>)}</select><small>Status normally changes through completion, cancellation, auto-renew or archiving.</small></label>{(item.state === 'done' || item.state === 'cancelled') && <label>Actually {item.state === 'done' ? 'completed' : 'cancelled'} at {dateField(`Actually ${item.state === 'done' ? 'completed' : 'cancelled'} at`, item.closure?.at, (value) => { if (value) patchItem({ closure: { at: value, actor: item.closure?.actor ?? 'user', reason: item.state === 'cancelled' ? 'cancelled' : 'manual' } }); else patchItem({ closure: undefined }); }, 'Defaults to now. Change this when you are recording the item after it happened. For a completion-anchored series, the next cycle uses this time when this cycle is first closed.')}</label>}</div></details>
        <details><summary>Contexts {sectionMark(commaList(contexts).length > 0)}</summary><div className="details-body"><label>Contexts<input value={contexts} onChange={(event) => setContexts(event.target.value)} placeholder="office, laptop" /></label></div></details>

        <details><summary>Recurrence &amp; auto-renew {sectionMark(recurring)}</summary><div className="details-body">
          <label className="check"><input type="checkbox" checked={recurring} onChange={(event) => {
            const enabled = event.target.checked;
            setRecurring(enabled);
            if (enabled && !item.recurrence) patchRecurrence({ rrule: 'FREQ=WEEKLY;INTERVAL=1' });
          }} /> Make this a recurring series</label>
          {recurring && <>
            <SectionGuide title="How recurring items work"><ul><li>A series is one source item; each cycle has its own history.</li><li><strong>Only show during the active range</strong> uses Event opens and Due: complete once during that period, then the next cycle waits until it opens.</li><li>Most weekly tasks only need Repeat and, optionally, the active range. Advanced settings are for unusual activation and auto-close rules.</li></ul></SectionGuide>
            <div className="form-grid two"><label>Repeat<select aria-label="Repeat frequency" value={repeatFrequency} onChange={(event) => { const frequency = event.target.value; updateRrule({ FREQ: frequency, BYDAY: frequency === 'WEEKLY' ? (repeatDays.join(',') || undefined) : undefined }); setRepeatIntervalDraft(String(repeatInterval || 1)); }}><option value="MINUTELY">Minutes</option><option value="HOURLY">Hours</option><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option><option value="YEARLY">Yearly</option></select></label><label>Every<input type="number" min="1" aria-label="Repeat interval" value={repeatIntervalDraft} onChange={(event) => setRepeatIntervalDraft(event.target.value)} onBlur={() => { const value = Math.max(1, Number(repeatIntervalDraft) || 1); setRepeatIntervalDraft(String(value)); updateRrule({ INTERVAL: String(value) }); }} /><span className="field-suffix">{repeatInterval === 1 ? repeatUnit : `${repeatUnit}s`}</span></label></div>
            <p className="field-hint recurrence-anchor-help">The cycle follows the date and time in <strong>Event opens</strong>. If <strong>Due / Active range ends</strong> is set, it defines the end of each cycle's active window.</p>
            <label className="check completion-anchor-toggle"><input type="checkbox" checked={item.recurrence?.anchor === 'completion'} onChange={(event) => patchRecurrence({ anchor: event.target.checked ? 'completion' : 'schedule' })} /><span><strong>Repeat after completion</strong><small>Count the selected interval from the actual completion time: days, weeks, months or years.</small></span></label>
            {!activeRange && repeatFrequency === 'WEEKLY' && <div className="weekday-picker" aria-label="Repeat on weekdays"><span className="field-hint">Choose days for regular repeating tasks or habits.</span>{[['MO', 'M'], ['TU', 'T'], ['WE', 'W'], ['TH', 'T'], ['FR', 'F'], ['SA', 'S'], ['SU', 'S']].map(([value, label]) => <button className={repeatDays.includes(value!) ? 'active' : ''} aria-label={`Repeat on ${value}`} key={value} onClick={() => { const days = repeatDays.includes(value!) ? repeatDays.filter((day) => day !== value) : [...repeatDays, value!]; updateRrule({ BYDAY: days.length ? days.join(',') : undefined }); }}>{label}</button>)}</div>}
            <label className="active-window-toggle"><input type="checkbox" checked={activeRange} onChange={(event) => { if (event.target.checked) updateRrule({ BYDAY: undefined }); patchRecurrence(event.target.checked ? { activationOffset: 'PT0M', closeAt: 'due', autoRenew: true } : { closeAt: 'next_activation' }); }} /><span><strong>Only show during the active range</strong><small>Complete once between Event opens and Due / Active range ends. Outside that range, no active item is shown. The opening date supplies the weekly cycle day.</small></span></label>
            {activeRange && <div className={`active-window-summary ${item.schedule?.startAt && item.schedule?.dueAt ? '' : 'incomplete'}`}><span><small>Event opens</small>{item.schedule?.startAt ? formatViewDate(item.schedule.startAt, true, workspace.calendarPreferences.language) : 'Set Event opens'}</span><span><small>Active range ends</small>{item.schedule?.dueAt ? formatViewDate(item.schedule.dueAt, true, workspace.calendarPreferences.language) : 'Set Due'}</span></div>}
            <details className="advanced-recurrence"><summary>Advanced recurrence behavior</summary><div className="details-body"><div className="form-grid two"><label>Activate before<div className="duration-control"><input type="number" min="0" aria-label="Activation amount" value={activation.amount} onChange={(event) => patchRecurrence({ activationOffset: toIsoDuration(Math.max(0, Number(event.target.value) || 0), activation.unit) })} /><select aria-label="Activation unit" value={activation.unit} onChange={(event) => patchRecurrence({ activationOffset: toIsoDuration(activation.amount, event.target.value as FriendlyDurationUnit) })}><option value="minutes">Minutes</option><option value="hours">Hours</option><option value="days">Days</option><option value="weeks">Weeks</option></select></div></label><label>Auto-close<select value={item.recurrence?.closeAt ?? 'next_activation'} onChange={(event) => patchRecurrence({ closeAt: event.target.value as NonNullable<UniversalItem['recurrence']>['closeAt'] })}><option value="next_activation">At next activation</option><option value="due">At due time</option><option value="never">Never</option></select></label></div><label>Next cycle starts from<select value={item.recurrence?.anchor ?? 'schedule'} onChange={(event) => patchRecurrence({ anchor: event.target.value as NonNullable<UniversalItem['recurrence']>['anchor'] })}><option value="schedule">Scheduled time</option><option value="completion">Actual completion or cancellation</option></select><small>Choose actual completion when the next interval should be counted from the time you finished, rather than the original schedule.</small></label><label className="check"><input type="checkbox" checked={item.recurrence?.autoRenew ?? true} onChange={(event) => patchRecurrence({ autoRenew: event.target.checked })} /> Auto-close untouched cycles</label><label>Repeat rule <span className="hint">RRULE — Recurrence Rule</span><input className="mono" value={item.recurrence?.rrule ?? 'FREQ=WEEKLY;INTERVAL=1'} onChange={(event) => patchRecurrence({ rrule: event.target.value })} /></label><label>Activation duration <span className="hint">ISO 8601</span><input className="mono" value={item.recurrence?.activationOffset ?? 'P7D'} onChange={(event) => patchRecurrence({ activationOffset: event.target.value })} /></label></div></details>
          </>}
        </div></details>

        <details><summary>Progress &amp; habit {sectionMark(Boolean(item.progress || item.habit))}</summary><div className="details-body">
          <SectionGuide title="Progress versus habit"><p>Progress describes the current item. A habit stays one item and records completed calendar dates instead of creating a duplicate item for every day.</p><p>Set the repeat interval and weekdays in <strong>Recurrence &amp; auto-renew</strong>.</p></SectionGuide>
          <div className="form-grid three"><label>Mode<select value={item.progress?.mode ?? 'counter'} onChange={(event) => patchItem({ progress: { mode: event.target.value as 'counter', current: item.progress?.current ?? 0, target: item.progress?.target ?? 1 } })}><option>boolean</option><option>percent</option><option>counter</option></select></label>
          <label>Current<input type="number" value={item.progress?.current ?? 0} onChange={(event) => patchItem({ progress: { mode: item.progress?.mode ?? 'counter', current: Number(event.target.value), target: item.progress?.target ?? 1 } })} /></label>
          <label>Target<input type="number" value={item.progress?.target ?? 1} onChange={(event) => patchItem({ progress: { mode: item.progress?.mode ?? 'counter', current: item.progress?.current ?? 0, target: Number(event.target.value) } })} /></label></div>
          <label className="check"><input type="checkbox" checked={Boolean(item.habit)} onChange={(event) => patchItem({ habit: event.target.checked ? { target: item.progress?.target ?? 1, unit: 'times', streakMode: 'manual_only', completedDates: item.habit?.completedDates ?? [] } : undefined })} /> Track as a habit</label>
          {item.habit && <div className="habit-history"><strong>{item.habit.completedDates?.length ?? 0} completions</strong><small>{item.habit.completedDates?.length ? `Completed on ${[...(item.habit.completedDates ?? [])].sort().map((date) => formatViewDate(`${date}T00:00:00`, false, workspace.calendarPreferences.language)).join(', ')}` : 'No completion dates yet.'}</small></div>}
        </div></details>

        <details><summary>Relations &amp; links {sectionMark(item.relations.length > 0 || item.attachments.length > 0 || parentItems.length > 0)}</summary><div className="details-body">
          <SectionGuide title="Linking items"><p>Relations connect two items without making either one a subtask. Links are URL references only; files are not stored in this workspace.</p></SectionGuide>
          {parentItems.map((parent) => <div className="chip" key={`parent-${parent.id}`}><span>Parent: {parent.title}</span><small className="hint">This item is a subtask</small></div>)}
          {item.relations.map((relation) => <div className="chip" key={relation.id}>{relation.type}: {workspace.items[relation.targetId]?.title ?? relation.targetId}<button aria-label="Remove relation" onClick={() => patchItem({ relations: item.relations.filter((entry) => entry.id !== relation.id) })}><CloseIcon /></button></div>)}
          <div className="inline-row"><select id="relation-target" defaultValue=""><option value="">Choose related item…</option>{Object.values(workspace.items).filter((candidate) => candidate.id !== item.id && !candidate.deletedAt).map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.title}</option>)}</select><button className="secondary" onClick={() => { const select = document.getElementById('relation-target') as HTMLSelectElement; if (select.value) patchItem({ relations: [...item.relations, { id: createId(), targetId: select.value, type: 'related' }] }); }}>Link</button></div>
          {item.attachments.map((attachment) => <div className="chip" key={attachment.id}><a href={attachment.url} target="_blank" rel="noreferrer">{attachment.title ?? attachment.url}</a><button aria-label="Remove link" onClick={() => patchItem({ attachments: item.attachments.filter((entry) => entry.id !== attachment.id) })}><CloseIcon /></button></div>)}
          <button className="secondary" onClick={() => { const url = window.prompt('Link URL'); if (url) patchItem({ attachments: [...item.attachments, { id: createId(), url }] }); }}>+ Add link</button>
        </div></details>

        <details><summary>Scripts {Boolean(item.scripts?.length) && <span className="summary-count">{item.scripts!.length}</span>}</summary><div className="details-body item-scripts">
          <p className="schedule-explainer">Add computed fields to this item. Expressions look like JavaScript, but run in a safe read-only engine: no <code>eval</code>, network, files or workspace changes.</p>
          <SectionGuide title="Variables and examples"><ul><li>Current item: <code>schedule.startAt</code>, <code>schedule.estimatedDuration</code>, <code>priority</code>, <code>custom.rate</code>.</li><li>Compact countdown text: <code>timeUntil(schedule.startAt)</code> → <em>2h 14m</em>.</li><li>Whole-number countdowns for Views: <code>secondsUntil(schedule.startAt)</code>, <code>minutesUntil(schedule.startAt)</code>, <code>hoursUntil(schedule.startAt)</code>, <code>daysUntil(schedule.startAt)</code>. A past time is negative.</li><li>Duration result: choose <strong>Duration</strong>, then use <code>durationUntil(schedule.startAt)</code> or <code>durationBetween(schedule.startAt, schedule.endAt)</code>. Use <code>formatDuration(durationUntil(schedule.startAt))</code> for text.</li><li>Add duration: <code>timeUntil(addDuration(schedule.startAt, schedule.estimatedDuration))</code>.</li><li>Linked item: <code>linked(&quot;related&quot;, &quot;schedule.dueAt&quot;)</code>. Exact item: <code>item(&quot;ITEM_ID&quot;, &quot;priority&quot;)</code>. Another calculation: <code>script.my_key</code>.</li></ul></SectionGuide>
          {(item.scripts ?? []).map((script) => <article className="item-script-row" key={script.id}>
            <div className="item-script-head"><label>Name<input value={script.label} onChange={(event) => { const label = event.target.value; patchScript(script.id, { label, key: script.key.startsWith('calculation_') ? (label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || script.key) : script.key }); }} /></label><label>Key<input className="mono" pattern="[a-z][a-z0-9_]*" value={script.key} onChange={(event) => patchScript(script.id, { key: event.target.value })} /></label><label>Result<select value={script.resultKind} onChange={(event) => patchScript(script.id, { resultKind: event.target.value as ItemScriptField['resultKind'] })}><option value="text">Text</option><option value="number">Number</option><option value="boolean">True / false</option><option value="datetime">Date &amp; time</option><option value="duration">Duration</option></select></label><button className="icon-button" aria-label={`Remove script ${script.label}`} onClick={() => patchItem({ scripts: item.scripts?.filter((entry) => entry.id !== script.id) })}><CloseIcon /></button></div>
            <label>Expression<CodeEditor language="dsl" ariaLabel={`${script.label} expression`} rows={3} value={script.source} onChange={(source) => patchScript(script.id, { source })} /></label>
            <output className={`formula-output${scriptResults.errors[script.key] ? ' error' : ''}`}><small>Live result</small>{scriptResults.errors[script.key] ?? formatScriptResult(scriptResults.values[script.key], script.resultKind)}</output>
          </article>)}
          <button className="secondary" type="button" onClick={addScript}>+ Add computed field</button>
        </div></details>
        {definitions.length > 0 && <details><summary>Custom fields {sectionMark(Object.keys(item.custom).length > 0)}</summary><div className="details-body">{definitions.map((field) => <label key={field.id}>{field.label}{field.kind === 'formula' ? <output className="formula-output">{String(formulas.values[field.key] ?? formulas.errors[field.key] ?? '—')}</output> : <input value={String(item.custom[field.key] ?? '')} onChange={(event) => patchItem({ custom: { ...item.custom, [field.key]: field.kind === 'number' ? Number(event.target.value) : field.kind === 'boolean' ? event.target.value === 'true' : event.target.value } })} />}</label>)}</div></details>}
        <details><summary>Item JSON {sectionMark(jsonDirty)}</summary><div className="details-body json-editor"><p className="hint">Edit the same item draft as the form. Protected identity, provenance, timestamps and occurrence fields are preserved when updating an existing item.</p><SectionGuide title="JSON safety"><p>Apply JSON updates the form first; only Save item writes it to the workspace. Import as new item always creates a separate copy. Exported data is readable, so do not share it accidentally.</p></SectionGuide><CodeEditor language="json" ariaLabel="Item JSON" rows={18} value={jsonDraft} onChange={(value) => { setJsonDraft(value); setJsonDirty(true); }} /><div className="builder-actions"><button className="secondary compact-action" onClick={() => { setJsonDraft(JSON.stringify(item, null, 2)); setJsonDirty(false); }}>Refresh from form</button><button className="secondary compact-action" onClick={applyJson}>Apply JSON to form</button><details className="inline-menu"><summary>Export…</summary><div><button onClick={exportItemJson}>JSON</button><button onClick={() => exportItem('csv')}>CSV</button><button onClick={() => exportItem('xlsx')}>Excel</button><button onClick={() => exportItem('ics')}>iCalendar</button><button onClick={() => exportItem('ics', true)}>iCalendar + UTM metadata</button></div></details><button className="secondary compact-action" onClick={() => importJsonRef.current?.click()}>Import as new item</button><input ref={importJsonRef} hidden type="file" accept=".json,.csv,.xlsx,.ics,application/json,text/csv,text/calendar,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => event.target.files?.[0] && void importAsNew(event.target.files[0])} /></div></div></details>
        {Boolean(item.cycleHistory?.length) && <details><summary>Cycle history <span className="summary-count">{item.cycleHistory!.length}</span></summary><div className="details-body cycle-history"><p className="field-hint">Finished auto-renew cycles stay inside this item. Its current Dates &amp; time always describe the active or most recent cycle.</p>{[...item.cycleHistory!].reverse().map((cycle) => <article key={cycle.recurrenceId}><div><strong>{cycle.state === 'auto_closed' ? 'Auto closed' : cycle.state === 'done' ? 'Completed' : 'Cancelled'}</strong><time dateTime={cycle.closedAt}>{formatViewDate(cycle.closedAt, true, workspace.calendarPreferences.language)}</time></div><small>{cycle.startAt ? `Opened ${formatViewDate(cycle.startAt, true, workspace.calendarPreferences.language)}` : `Cycle ${formatViewDate(cycle.recurrenceId, true, workspace.calendarPreferences.language)}`}{cycle.dueAt ? ` · Due ${formatViewDate(cycle.dueAt, true, workspace.calendarPreferences.language)}` : ''}</small></article>)}</div></details>}
        <details><summary>System metadata</summary><div className="details-body metadata-grid"><div><span>Created at</span><output><time dateTime={item.createdAt}>{formatViewDate(item.createdAt, true, workspace.calendarPreferences.language)}</time></output></div><div><span>Last modified</span><output><time dateTime={item.updatedAt}>{formatViewDate(item.updatedAt, true, workspace.calendarPreferences.language)}</time></output></div><div><span>Created by application</span><output>{item.createdWithAppName} v{item.createdWithVersion}</output></div><div><span>Application ID</span><output className="mono">{item.createdWithAppId}</output></div><div><span>Item schema</span><output>{item.schemaVersion}</output></div><div><span>Item ID</span><output>{item.id}</output></div></div></details>
      </div>
      {error && <p className="editor-error error" role="alert">{error}</p>}
      <footer className="drawer-actions">{workspace.items[item.id] && <button className="danger" onClick={() => onDelete(item)}>Delete</button>}<span /><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" onClick={save}>Save item</button></footer>
    </section>
  </div>;
}

function ViewResults({ view, workspace, onEdit, onState, celebratingIds = new Set<string>() }: {
  view: SavedView; workspace: WorkspaceDocument; onEdit: (item: UniversalItem) => void;
  onState: (item: UniversalItem, state: UniversalItem['state']) => void; celebratingIds?: ReadonlySet<string> | undefined;
}) {
  const [liveNow, setLiveNow] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setLiveNow(new Date()), 30_000); return () => window.clearInterval(timer); }, []);
  // Automerge exposes live proxy values. Render a plain snapshot so a saved
  // item change cannot leave a View row reading an older proxy value.
  const renderWorkspace = useMemo(() => clean(workspace), [workspace]);
  const renderView = useMemo(() => clean(view), [view]);
  const items = filteredItems(renderWorkspace, renderView);
  const visibleFields = renderView.fields ?? [];
  const stateButtonLabel = (item: UniversalItem) => item.habit
    ? (item.habit.completedDates?.includes(new Date().toISOString().slice(0, 10)) ? 'Undo habit completion today' : 'Complete habit today')
    : item.state === 'open' ? `Complete ${item.title}` : `Reopen ${item.title}`;
  const nextState = (item: UniversalItem): UniversalItem['state'] => item.habit && item.habit.completedDates?.includes(new Date().toISOString().slice(0, 10)) ? 'open' : item.state === 'open' ? 'done' : 'open';
  const isCelebrating = (item: UniversalItem) => celebratingIds.has(item.id);
  const fieldContent = (item: UniversalItem, omit: string[] = []) => <span className="renderer-fields">{visibleFields.filter((field) => !omit.includes(field)).map((field) => {
    if (field === 'title') return <strong key={field}>{item.title}</strong>;
    const value = displayViewValue(readItemField(item, field, renderWorkspace, liveNow), field, renderWorkspace.calendarPreferences.language);
    return value ? <span key={field}><small>{viewFieldLabel(renderWorkspace, field)}</small>{value}</span> : null;
  })}</span>;
  if (!items.length) return <p className="empty">No items match this view.</p>;
  if (renderView.renderer === 'calendar') {
    const dated = items.flatMap((item) => {
      const date = item.schedule?.startAt ?? item.schedule?.dueAt;
      return date ? [{ item, date }] : [];
    });
    return dated.length ? <div className="calendar-strip">{dated.map(({ item, date }) => <article className={`calendar-item state-${item.state}${isCelebrating(item) ? ' is-celebrating' : ''}`} key={item.id}><button className="state-toggle" aria-label={stateButtonLabel(item)} onClick={() => onState(item, nextState(item))}>{item.state === 'open' && !item.habit?.completedDates?.includes(new Date().toISOString().slice(0, 10)) ? '' : '✓'}</button><button className="calendar-main" onClick={() => onEdit(item)}><time dateTime={date}>{formatViewDate(date, false, renderWorkspace.calendarPreferences.language)}</time>{fieldContent(item, ['schedule.startAt', 'schedule.dueAt'])}</button></article>)}</div> : <p className="empty">Matching items have no dates.</p>;
  }
  if (renderView.renderer === 'board') {
    const settings = boardSettingsFor(renderView);
    const columns = settings.groupBy === 'tag'
      ? [...new Set(items.flatMap((item) => item.tags))].sort((a, b) => a.localeCompare(b)).map((tag) => ({ key: tag, label: `#${tag}`, items: items.filter((item) => item.tags.includes(tag)) })).concat([{ key: '__untagged__', label: 'No tags', items: items.filter((item) => item.tags.length === 0) }])
      : settings.states.map((state) => ({ key: state, label: stateNames[state], items: items.filter((item) => item.state === state) }));
    const visibleColumns = columns.filter((column) => settings.showEmpty || column.items.length > 0);
    return visibleColumns.length ? <div className="mini-board">{visibleColumns.map(({ key, label, items: columnItems }) => <section key={key}><h4>{label}</h4>{columnItems.map((item) => <article className={`board-item state-${item.state}${isCelebrating(item) ? ' is-celebrating' : ''}`} key={item.id}><button className="state-toggle" aria-label={stateButtonLabel(item)} onClick={() => onState(item, nextState(item))}>{item.state === 'open' && !item.habit?.completedDates?.includes(new Date().toISOString().slice(0, 10)) ? '' : '✓'}</button><button className="board-item-main" onClick={() => onEdit(item)}>{fieldContent(item, ['state'])}</button></article>)}</section>)}</div> : <p className="empty">No items match this board.</p>;
  }
  if (renderView.renderer === 'table') {
    const fields = visibleFields.length ? visibleFields : ['title', 'state', 'schedule.dueAt', 'priority'];
    return <div className="table-wrap renderer-table-wrap"><table><thead><tr><th className="state-column"><span className="sr-only">Complete</span></th>{fields.map((field) => <th key={field}>{viewFieldLabel(renderWorkspace, field)}</th>)}</tr></thead><tbody>{items.map((item) => <tr className={`state-${item.state}${isCelebrating(item) ? ' is-celebrating' : ''}`} key={item.id} onClick={() => onEdit(item)}><td className="state-column"><button className="state-toggle" aria-label={stateButtonLabel(item)} onClick={(event) => { event.stopPropagation(); onState(item, nextState(item)); }}>{item.state === 'open' && !item.habit?.completedDates?.includes(new Date().toISOString().slice(0, 10)) ? '' : '✓'}</button></td>{fields.map((field) => <td key={field}>{displayViewValue(readItemField(item, field, renderWorkspace, liveNow), field, renderWorkspace.calendarPreferences.language)}</td>)}</tr>)}</tbody></table></div>;
  }
  return <div className="item-list">{items.map((item) => <ItemCard key={item.id} item={item} celebrating={isCelebrating(item)} fields={visibleFields} workspace={renderWorkspace} onEdit={() => onEdit(item)} onState={(state) => onState(item, state)} />)}</div>;
}

function SavedViewSection({ view, workspace, onEditView, onEditItem, onState, onRendererChange, onAddItem, celebratingIds, showTechnicalSummary = true }: {
  view: SavedView; workspace: WorkspaceDocument; onEditView: () => void; onEditItem: (item: UniversalItem) => void;
  onState: (item: UniversalItem, state: UniversalItem['state']) => void; onRendererChange: (renderer: SavedView['renderer']) => void; onAddItem: (view: SavedView) => void; celebratingIds?: ReadonlySet<string> | undefined; showTechnicalSummary?: boolean;
}) {
  const [open, setOpen] = useState(() => readUiBoolean(`view:${view.id}`, true));
  useEffect(() => { persistUiBoolean(`view:${view.id}`, open); }, [open, view.id]);
  const matchingItems = filteredItems(workspace, view).length;
  const viewStyle = view.accent ? ({ '--view-accent': view.accent } as CSSProperties) : undefined;
  return <section className={`view-section${open ? '' : ' is-collapsed'}`} style={viewStyle}>
    <header className="view-section-summary"><div><h2>{view.name}</h2></div><div className="view-section-actions">{open && <button type="button" className="icon-button view-settings-button" aria-label={`Edit ${view.name}`} title="Edit view" onClick={onEditView}><LineIcon name="settings" /></button>}<button type="button" className="view-collapse-button" aria-label={`${open ? 'Collapse' : 'Expand'} ${view.name}`} aria-expanded={open} onClick={() => setOpen((current) => !current)}>{open ? '−' : <LineIcon name="chevronDown"/>}</button></div></header>
    {open && <div className="view-section-body">{showTechnicalSummary && <div className="view-query-summary"><code>{view.query.source.trim() || 'All items'}</code>{view.list && <code className="sort-preview">List: {view.list}</code>}{Object.keys(view.creationDefaults ?? {}).length > 0 && <code className="sort-preview">New item defaults: {Object.keys(view.creationDefaults ?? {}).length}</code>}{(view.sortSource || view.sort?.length) && <code className="sort-preview">Sort: {view.sortSource ?? view.sort.map((sort) => `${sort.field} ${sort.direction}`).join(' · ')}</code>}<p>{matchingItems} matching items</p></div>}<div className="view-results-scroll"><ViewResults view={view} workspace={workspace} onEdit={onEditItem} onState={onState} celebratingIds={celebratingIds} /></div>{(view.list || Object.keys(view.creationDefaults ?? {}).length > 0) && <button className="view-add-item" type="button" onClick={() => onAddItem(view)}>{view.list ? `+ Add item to ${view.list}` : '+ Add item'}</button>}</div>}
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

function ViewsPage({ workspace, commit, onEditItem, onState, onOpenCalendar, onAddItem, celebratingIds, createRequest = 0 }: {
  workspace: WorkspaceDocument; commit: (message: string, mutation: (draft: WorkspaceDocument) => void) => void;
  onEditItem: (item: UniversalItem) => void; onState: (item: UniversalItem, state: UniversalItem['state']) => void;
  onOpenCalendar?: (viewId: string) => void; onAddItem: (view: SavedView) => void; celebratingIds?: ReadonlySet<string> | undefined; createRequest?: number;
}) {
  type VisualConditionRow = { id: string; join: 'and' | 'or'; field: string; operator: string; value: string };
  const [editing, setEditing] = useState<SavedView | null>(null);
  const [error, setError] = useState('');
  const [visualRows, setVisualRows] = useState<VisualConditionRow[]>([]);
  const [visualDirty, setVisualDirty] = useState(false);
  const [sortRules, setSortRules] = useState<ViewSortRule[]>([]);
  const [sortSource, setSortSource] = useState('');
  const [manualField, setManualField] = useState('');
  const [defaultField, setDefaultField] = useState('priority');
  const [draggedField, setDraggedField] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [viewJson, setViewJson] = useState('');
  const viewJsonRef = useRef<HTMLInputElement>(null);
  const handledCreateRequest = useRef(createRequest);

  const literal = (value: string) => ['true', 'false', 'null'].includes(value) || (!Number.isNaN(Number(value)) && value.trim() !== '') ? value : JSON.stringify(value);
  const visualOptions: Record<string, string[]> = {
    state: ['open', 'done', 'auto_closed', 'cancelled', 'archived'], preset: ['task', 'event', 'habit', 'blank'],
    isHabit: ['true', 'false'], isTemplate: ['true', 'false'], isSubtask: ['true', 'false'], isParent: ['true', 'false'], activeRange: ['true', 'false'], activeDuration: ['true', 'false'], role: ['standalone', 'series_template', 'occurrence'], priority: ['0', '1', '2', '3', '4'],
  };
  const visualFieldKinds: Record<string, 'enum' | 'boolean' | 'number' | 'date' | 'text' | 'multi'> = {
    state: 'enum', preset: 'enum', role: 'enum', isHabit: 'boolean', isTemplate: 'boolean', isSubtask: 'boolean', isParent: 'boolean', activeRange: 'boolean', activeDuration: 'boolean', priority: 'number',
    'schedule.startAt': 'date', 'schedule.endAt': 'date', 'schedule.dueAt': 'date', 'schedule.availableFrom': 'date',
    title: 'text', description: 'text', tags: 'multi', contexts: 'multi', subtasks: 'multi', parent: 'text',
  };
  const visualOperators = (field: string): string[] => {
    const kind = visualFieldKinds[field] ?? 'text';
    const presence = ['is set', 'is not set'];
    if (kind === 'number' || kind === 'date') return [...presence, '==', '!=', '>', '>=', '<', '<='];
    if (kind === 'boolean' || kind === 'enum') return [...presence, '==', '!=', 'in'];
    if (kind === 'multi') return [...presence, 'has any', 'has all', 'has none'];
    return [...presence, '==', '!=', 'contains'];
  };
  const visualClause = (row: Pick<VisualConditionRow, 'field' | 'operator' | 'value'>) => {
    const presenceExpression = visualFieldKinds[row.field] === 'multi' || visualFieldKinds[row.field] === 'text' ? `length(${row.field}) > 0` : `${row.field} != null`;
    if (row.operator === 'is set') return presenceExpression;
    if (row.operator === 'is not set') return visualFieldKinds[row.field] === 'multi' || visualFieldKinds[row.field] === 'text' ? `length(${row.field}) == 0` : `${row.field} == null`;
    if (row.field === 'tags' || row.field === 'contexts') {
      const values = commaList(row.value);
      if (!values.length) return 'true';
      const checks = values.map((value) => `includes(${row.field}, ${JSON.stringify(value)})`);
      if (row.operator === 'has all') return checks.join(' && ');
      if (row.operator === 'has none') return `!(${checks.join(' || ')})`;
      return `(${checks.join(' || ')})`;
    }
    return `${row.field} ${row.operator === 'contains' ? 'in' : row.operator} ${literal(row.value)}`;
  };
  const serializeVisualRows = (rows: VisualConditionRow[]) => rows.reduce((source, row, index) => {
    const clause = visualClause(row);
    if (index === 0) return clause;
    return `(${source} ${row.join === 'or' ? '||' : '&&'} ${clause})`;
  }, '');
  const parseVisualRows = (source: string): VisualConditionRow[] | null => {
    const stripOuterParentheses = (value: string) => {
      let result = value.trim();
      while (result.startsWith('(') && result.endsWith(')')) {
        let depth = 0;
        let quoted = false;
        let escaped = false;
        let enclosesWholeExpression = true;
        for (let index = 0; index < result.length; index += 1) {
          const character = result[index]!;
          if (escaped) { escaped = false; continue; }
          if (character === '\\' && quoted) { escaped = true; continue; }
          if (character === '"') { quoted = !quoted; continue; }
          if (quoted) continue;
          if (character === '(') depth += 1;
          if (character === ')') depth -= 1;
          if (depth === 0 && index < result.length - 1) { enclosesWholeExpression = false; break; }
        }
        if (!enclosesWholeExpression || depth !== 0) break;
        result = result.slice(1, -1).trim();
      }
      return result;
    };
    const splitAtLastTopLevelJoin = (value: string): { left: string; join: 'and' | 'or'; right: string } | null => {
      let depth = 0;
      let quoted = false;
      let escaped = false;
      let match: { index: number; join: 'and' | 'or' } | null = null;
      for (let index = 0; index < value.length - 1; index += 1) {
        const character = value[index]!;
        if (escaped) { escaped = false; continue; }
        if (character === '\\' && quoted) { escaped = true; continue; }
        if (character === '"') { quoted = !quoted; continue; }
        if (quoted) continue;
        if (character === '(') depth += 1;
        else if (character === ')') depth -= 1;
        else if (depth === 0 && value.slice(index, index + 2) === '&&') { match = { index, join: 'and' }; index += 1; }
        else if (depth === 0 && value.slice(index, index + 2) === '||') { match = { index, join: 'or' }; index += 1; }
      }
      if (!match) return null;
      return { left: value.slice(0, match.index).trim(), join: match.join, right: value.slice(match.index + 2).trim() };
    };
    const parseClause = (clauseSource: string, join: 'and' | 'or'): VisualConditionRow | null => {
      const clause = stripOuterParentheses(clauseSource);
      const presence = /^([\w.]+)\s*(==|!=)\s*null$/.exec(clause);
      const normal = /^([\w.]+)\s*(==|!=|>=|<=|>|<|in)\s*("(?:[^"\\]|\\.)*"|true|false|null|-?\d+(?:\.\d+)?)$/.exec(clause);
      const match = presence ?? normal;
      if (!match) return null;
      const field = match[1]!;
      let operator = match[2]!;
      let value = '';
      if (presence) operator = presence[2] === '!=' ? 'is set' : 'is not set';
      else if (normal?.[3]) { try { value = String(JSON.parse(normal[3])); } catch { value = normal[3]; } }
      return { id: createId(), join, field, operator, value };
    };
    const parseExpression = (expressionSource: string): VisualConditionRow[] | null => {
      const expression = stripOuterParentheses(expressionSource);
      const split = splitAtLastTopLevelJoin(expression);
      if (!split) {
        const clause = parseClause(expression, 'and');
        return clause ? [clause] : null;
      }
      const left = parseExpression(split.left);
      const right = parseClause(split.right, split.join);
      return left && right ? [...left, right] : null;
    };
    const trimmed = source.trim();
    return trimmed ? parseExpression(trimmed) : [];
  };
  const syncRowsToDsl = (rows: VisualConditionRow[]) => {
    if (!editing) return;
    setVisualRows(rows);
    setVisualDirty(false);
    setEditing({ ...editing, query: { source: serializeVisualRows(rows) } });
  };
  const beginEditing = (view: SavedView) => {
    const copy = clean(view);
    copy.fields ??= [];
    copy.sort ??= [];
    const source = copy.sortSource ?? serializeSortRules(copy.sort.map((sort) => ({ expression: sort.field, direction: sort.direction, nulls: sort.nulls ?? 'last' })));
    const rows = parseVisualRows(copy.query.source);
    setEditing(copy);
    setVisualRows(rows ?? []);
    setVisualDirty(rows === null);
    setSortSource(source);
    try { setSortRules(parseSortSource(source)); } catch { setSortRules([]); }
    setManualField('');
    setDefaultField('priority');
    setConfirmDelete(false);
    setViewJson(JSON.stringify(copy, null, 2));
    setError('');
  };
  const addVisualRow = (join: 'and' | 'or') => syncRowsToDsl([...visualRows, { id: createId(), join, field: 'state', operator: '==', value: 'open' }]);
  const startVisualRows = () => syncRowsToDsl([{ id: createId(), join: 'and', field: 'state', operator: '==', value: 'open' }]);
  const updateVisualRow = (id: string, patch: Partial<VisualConditionRow>) => {
    const rows = visualRows.map((row) => {
      if (row.id !== id) return row;
      const next = { ...row, ...patch };
      if (patch.field) {
        const options = visualOperators(patch.field);
        next.operator = options.includes(next.operator) ? next.operator : options[0]!;
        next.value = visualOptions[patch.field]?.[0] ?? '';
      }
      return next;
    });
    syncRowsToDsl(rows);
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
  const updateCreationDefaults = (next: Record<string, unknown>) => {
    if (!editing) return;
    setEditing(Object.keys(next).length ? { ...editing, creationDefaults: next } : (() => { const { creationDefaults: _defaults, ...withoutDefaults } = editing; return withoutDefaults; })());
  };
  const addCreationDefault = () => {
    if (!editing || editing.creationDefaults?.[defaultField] !== undefined) return;
    updateCreationDefaults({ ...editing.creationDefaults, [defaultField]: defaultValueForPath(workspace, defaultField) });
  };
  const replaceCreationDefaultPath = (oldPath: string, path: string) => {
    if (!editing || oldPath === path) return;
    const next = { ...editing.creationDefaults }; const value = next[oldPath]; delete next[oldPath];
    if (!(path in next)) next[path] = value ?? defaultValueForPath(workspace, path);
    updateCreationDefaults(next);
  };
  const setCreationDefaultValue = (path: string, value: unknown) => updateCreationDefaults({ ...(editing?.creationDefaults ?? {}), [path]: value });
  const creationDefaultControl = (path: string, value: unknown): ReactNode => {
    const custom = path.startsWith('custom.') ? workspace.customFields[path.slice(7)] : undefined;
    const json = ['reminders', 'attachments', 'recurrence.rdates', 'recurrence.exdates'].includes(path);
    if (json) return <textarea className="mono creation-default-json" aria-label={`Default value for ${path}`} defaultValue={JSON.stringify(value, null, 2)} onBlur={(event) => { try { setCreationDefaultValue(path, JSON.parse(event.currentTarget.value)); setError(''); } catch { setError(`${viewFieldLabel(workspace, path)} must contain valid JSON.`); } }} />;
    if (path === 'state') return <select value={String(value)} onChange={(event) => setCreationDefaultValue(path, event.target.value)}>{Object.entries(stateNames).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select>;
    if (path === 'progress.mode') return <select value={String(value)} onChange={(event) => setCreationDefaultValue(path, event.target.value)}><option value="boolean">Boolean</option><option value="percent">Percent</option><option value="counter">Counter</option></select>;
    if (path === 'habit.streakMode') return <select value={String(value)} onChange={(event) => setCreationDefaultValue(path, event.target.value)}><option value="manual_only">Manual only</option><option value="any_closed">Any closed</option></select>;
    if (path === 'recurrence.closeAt') return <select value={String(value)} onChange={(event) => setCreationDefaultValue(path, event.target.value)}><option value="next_activation">Next activation</option><option value="due">Due</option><option value="never">Never</option></select>;
    if (path === 'recurrence.anchor') return <select value={String(value)} onChange={(event) => setCreationDefaultValue(path, event.target.value)}><option value="schedule">Scheduled time</option><option value="completion">Completion time</option></select>;
    if (['schedule.allDay', 'recurrence.autoRenew'].includes(path) || custom?.kind === 'boolean') return <select value={String(value)} onChange={(event) => setCreationDefaultValue(path, event.target.value === 'true')}><option value="true">True</option><option value="false">False</option></select>;
    if (path === 'tags' || path === 'contexts' || custom?.kind === 'multi_enum') return <input value={Array.isArray(value) ? value.join(', ') : ''} placeholder="Comma-separated values" onChange={(event) => setCreationDefaultValue(path, commaList(event.target.value))} />;
    if (['priority', 'progress.current', 'progress.target', 'habit.target'].includes(path) || custom?.kind === 'number') return <input type="number" value={Number(value)} onChange={(event) => setCreationDefaultValue(path, Number(event.target.value))} />;
    if (path.startsWith('schedule.') && (path.endsWith('At') || path === 'schedule.availableFrom')) return <input type="datetime-local" value={dateInput(String(value))} onChange={(event) => setCreationDefaultValue(path, fromDateInput(event.target.value))} />;
    return <input value={String(value ?? '')} onChange={(event) => setCreationDefaultValue(path, event.target.value)} />;
  };
  const save = () => {
    if (!editing) return;
    const result = editing;
    try {
      parseExpression(result.query.source.trim() || 'true');
      const defaultsValidation = validateViewCreationDefaults(result.creationDefaults);
      if (!defaultsValidation.valid) throw new Error(defaultsValidation.errors.join('; '));
      const parsedSort = parseSortSource(sortSource);
      compileSort(sortSource);
      const saved = { ...result, sortSource: serializeSortRules(parsedSort), sort: parsedSort.map((rule) => ({ field: rule.expression, direction: rule.direction, nulls: rule.nulls })) };
      commit('Save view', (draft) => { draft.views[result.id] = clean(saved); });
      setEditing(null);
      setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const newView = () => beginEditing({ id: createId(), name: 'New view', query: { source: '(state == "open" || state == "done") && role != "series_template" && isTemplate != true' }, renderer: 'table', sort: [{ field: 'updatedAt', direction: 'desc' }], fields: ['title', 'state'] });
  useEffect(() => {
    if (createRequest === handledCreateRequest.current) return;
    handledCreateRequest.current = createRequest;
    newView();
  }, [createRequest]);
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
  const displayFieldsEditor = editing && <section className="visual-query-display" aria-label="Display fields">
    <h3 className="query-builder-heading">2. Show in results</h3>
    <p className="builder-status">Choose the columns or details shown for every matching item. This does not change which items match; their order is the display order.</p>
    <details className="display-fields-example"><summary>Preview with a fully filled example item</summary><p className="display-fields-help">Drag a field to change its order, or hide it with ×.</p><div>{editing.fields.length ? editing.fields.map((field) => <span key={field} draggable onDragStart={() => setDraggedField(field)} onDragEnd={() => setDraggedField(null)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (draggedField) moveFieldTo(draggedField, field); setDraggedField(null); }}><button className="preview-field-remove" aria-label={`Hide ${viewFieldLabel(workspace, field)}`} onClick={() => toggleField(field)}><CloseIcon /></button><small>{viewFieldLabel(workspace, field)}</small>{exampleViewFieldValue(field)}</span>) : <p>Select fields below to preview them here.</p>}</div></details>
    <div className="builder-actions"><button className="secondary compact-action" onClick={() => setEditing({ ...editing, fields: viewFieldOptions(workspace).map((field) => field.path) })}>Select all</button><button className="secondary compact-action" onClick={() => setEditing({ ...editing, fields: [] })}>Hide all</button></div>
    <div className="field-groups">{[...new Set(viewFieldOptions(workspace).map((field) => field.group))].map((group) => <details key={group}><summary>{group}</summary><div className="field-options">{viewFieldOptions(workspace).filter((field) => field.group === group).map((field) => <label className="check" key={field.path}><input type="checkbox" checked={editing.fields.includes(field.path)} onChange={() => toggleField(field.path)} />{field.label}<small>{field.path}</small></label>)}</div></details>)}</div>
    <div className="manual-field"><input aria-label="Custom field path" placeholder="Any path, e.g. custom.client" value={manualField} onChange={(event) => setManualField(event.target.value)} /><button className="secondary compact-action" disabled={!manualField.trim() || editing.fields.includes(manualField.trim())} onClick={() => { const path = manualField.trim(); setEditing({ ...editing, fields: [...editing.fields, path] }); setManualField(''); }}>+ Add path</button></div>
    {editing.fields.length > 0 && <div className="selected-fields"><span className="selected-fields-title">Display order</span>{editing.fields.map((field, index) => <div key={field}><code>{field}</code><div><button aria-label={`Move ${field} up`} disabled={index === 0} onClick={() => moveField(index, -1)}>↑</button><button aria-label={`Move ${field} down`} disabled={index === editing.fields.length - 1} onClick={() => moveField(index, 1)}>↓</button><button aria-label={`Hide ${field}`} onClick={() => toggleField(field)}><CloseIcon /></button></div></div>)}</div>}
  </section>;

  return <section className="page-section views-page">
    <div className="views-stack">{Object.values(workspace.views).map((view) => <div key={view.id}>{view.renderer === 'calendar' && onOpenCalendar && <button className="open-calendar-button" onClick={() => onOpenCalendar(view.id)}>Open {view.name} in Calendar</button>}<SavedViewSection view={view} workspace={workspace} onEditView={() => beginEditing(view)} onEditItem={onEditItem} onState={onState} onAddItem={onAddItem} celebratingIds={celebratingIds} showTechnicalSummary={false} onRendererChange={(renderer) => commit('Change view renderer', (draft) => { const target = draft.views[view.id]; if (target) target.renderer = renderer; })} /></div>)}</div>
    {editing && <div className="modal-backdrop"><section className="dialog view-editor">
      <header><div><p className="dialog-kicker">SAVED VIEW</p><h2>Edit view</h2></div><button className="icon-button" aria-label="Close view editor" onClick={() => setEditing(null)}><CloseIcon /></button></header>
      <label>Name<input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label>
      <label>Renderer<select value={editing.renderer} onChange={(event) => setEditing({ ...editing, renderer: event.target.value as SavedView['renderer'] })}><option>list</option><option>table</option><option>calendar</option><option>board</option></select></label>
      <details className="view-editor-section"><summary>View color</summary><fieldset className="view-accent-picker"><p className="builder-status">This color identifies the view and completed ticks. Each option stays readable in light and dark themes.</p><div className="view-accent-options"><button type="button" className={!editing.accent ? 'selected' : ''} onClick={() => { const { accent: _accent, ...withoutAccent } = editing; setEditing(withoutAccent); }}>Default</button>{viewAccentOptions.map((option) => <button type="button" key={option.value} className={editing.accent === option.value ? 'selected' : ''} aria-label={`${option.label} view color`} aria-pressed={editing.accent === option.value} onClick={() => setEditing({ ...editing, accent: option.value })}><span style={{ backgroundColor: option.value }} />{option.label}</button>)}</div></fieldset></details>
      <SectionGuide title="How views work"><ul><li>A view is a saved, live list; it never copies items.</li><li>Use the visual setup below: first choose which items appear, then choose what is shown for each item.</li><li>The optional advanced filter code below is synchronized with ordinary rows whenever its logic can be represented visually.</li><li>An empty filter means all items except recurring source templates. Sorting only controls order.</li></ul></SectionGuide>
      <details className="view-editor-section" open><summary>Visual setup</summary><fieldset className="query-builder visual-query-builder">
        <h3 className="query-builder-heading">1. Filter items</h3>
        <p className="builder-status">Build the filter with ordinary fields, operators and values. The result and advanced code update immediately. Active range uses Event opens through Due.</p>
        {visualRows.map((row, index) => <div className="visual-condition-row" key={row.id}>
          <label className="condition-join">{index === 0 ? 'Where' : 'Join'}{index === 0 ? <span className="field-hint">First rule</span> : <select value={row.join} onChange={(event) => updateVisualRow(row.id, { join: event.target.value as 'and' | 'or' })}><option value="and">AND</option><option value="or">OR</option></select>}</label>
          <label>Property<select value={row.field} onChange={(event) => updateVisualRow(row.id, { field: event.target.value })}>{[...new Set(viewFieldOptions(workspace).map((field) => field.group))].map((group) => <optgroup label={group} key={group}>{viewFieldOptions(workspace).filter((field) => field.group === group).map((field) => <option value={field.path} key={field.path}>{field.label}</option>)}</optgroup>)}</select></label>
          <label>Operator<select value={row.operator} onChange={(event) => updateVisualRow(row.id, { operator: event.target.value })}>{visualOperators(row.field).map((operator) => <option key={operator} value={operator}>{operator}</option>)}</select></label>
          <label>Value{row.operator === 'is set' || row.operator === 'is not set' ? <span className="field-hint">No value needed</span> : visualOptions[row.field] ? <select value={row.value} onChange={(event) => updateVisualRow(row.id, { value: event.target.value })}>{visualOptions[row.field]!.map((value) => <option key={value} value={value}>{row.field === 'state' ? stateNames[value as UniversalItem['state']] ?? value : value}</option>)}</select> : <input type={row.field.startsWith('schedule.') ? 'datetime-local' : 'text'} list={row.field === 'title' ? 'view-title-values' : row.field === 'tags' || row.field === 'contexts' ? 'view-tag-values' : undefined} placeholder={row.field === 'tags' || row.field === 'contexts' ? 'Choose or type comma-separated values' : undefined} value={row.value} onChange={(event) => updateVisualRow(row.id, { value: event.target.value })} />}</label>
          <button className="secondary compact-action visual-condition-remove" aria-label={`Remove filter rule ${index + 1}`} onClick={() => syncRowsToDsl(visualRows.filter((entry) => entry.id !== row.id))}><CloseIcon /></button>
        </div>)}
        <datalist id="view-title-values">{[...new Set(Object.values(workspace.items).map((entry) => entry.title))].map((title) => <option value={title} key={title} />)}</datalist>
        <datalist id="view-tag-values">{[...new Set(Object.values(workspace.items).flatMap((entry) => [...entry.tags, ...entry.contexts]))].sort().map((tag) => <option value={tag} key={tag} />)}</datalist>
        {visualDirty ? <p className="builder-status">This filter uses advanced code that cannot be shown as ordinary rows. Adding a visual rule replaces that code.</p> : <p className="builder-status">The visual rows and advanced filter code are synchronized.</p>}
        <div className="builder-actions"><button className="secondary compact-action" onClick={() => visualDirty ? startVisualRows() : addVisualRow('and')}>+ Add AND rule</button><button className="secondary compact-action" onClick={() => visualDirty ? startVisualRows() : addVisualRow('or')}>+ Add OR rule</button></div>
        {displayFieldsEditor}
      </fieldset></details>
      <details className="view-editor-section"><summary>Advanced filter code</summary><label className="dsl-field">Advanced filter code <span className="hint">Optional text form of the visual rows. SQL preview: {toSqlExpression(editing.query.source)}</span><CodeEditor language="dsl" ariaLabel="Advanced filter code" rows={5} value={editing.query.source} onChange={(value) => { const rows = parseVisualRows(value); setEditing({ ...editing, query: { source: value } }); if (rows !== null) setVisualRows(rows); setVisualDirty(rows === null); }} /></label></details>
      <details className="view-editor-section"><summary>Defaults for new items</summary><fieldset className="query-builder creation-defaults">
        <p className="builder-status">Pinned values are copied only when this view creates a new item. They never change the filter or existing items.</p>
        {Object.entries(editing.creationDefaults ?? {}).map(([path, value]) => <div className="creation-default-row" key={path}>
          <label>Property<select value={path} onChange={(event) => replaceCreationDefaultPath(path, event.target.value)}>{[...new Set(creationDefaultFieldOptions(workspace).map((field) => field.group))].map((group) => <optgroup key={group} label={group}>{creationDefaultFieldOptions(workspace).filter((field) => field.group === group).map((field) => <option key={field.path} value={field.path} disabled={field.path !== path && Object.hasOwn(editing.creationDefaults ?? {}, field.path)}>{field.label}</option>)}</optgroup>)}</select></label>
          <label>Value{creationDefaultControl(path, value)}</label>
          <button className="secondary compact-action creation-default-remove" aria-label={`Remove default ${viewFieldLabel(workspace, path)}`} onClick={() => { const next = { ...editing.creationDefaults }; delete next[path]; updateCreationDefaults(next); }}><CloseIcon /></button>
        </div>)}
        <div className="builder-actions"><select aria-label="Property to pin for new items" value={defaultField} onChange={(event) => setDefaultField(event.target.value)}>{[...new Set(creationDefaultFieldOptions(workspace).map((field) => field.group))].map((group) => <optgroup key={group} label={group}>{creationDefaultFieldOptions(workspace).filter((field) => field.group === group).map((field) => <option key={field.path} value={field.path} disabled={Object.hasOwn(editing.creationDefaults ?? {}, field.path)}>{field.label}</option>)}</optgroup>)}</select><button className="secondary compact-action" disabled={Object.hasOwn(editing.creationDefaults ?? {}, defaultField)} onClick={addCreationDefault}>+ Pin property</button></div>
        <small className="field-hint">Relations, subtasks, item IDs, timestamps, completion history and occurrence identity cannot be copied into new items.</small>
      </fieldset></details>
      <details className="view-editor-section"><summary>Task list</summary><label>Task list<input value={editing.list ?? ''} list="view-list-values" placeholder="Choose or type a list name" onChange={(event) => { const list = event.target.value.trim(); setEditing(list ? { ...editing, list } : (() => { const { list: _list, ...withoutList } = editing; return withoutList; })()); }} /><datalist id="view-list-values">{[...new Set(Object.values(workspace.items).map((item) => item.list).filter((list): list is string => Boolean(list)))].sort().map((list) => <option value={list} key={list} />)}</datalist><small>Choose an existing list or type a new name. Items assigned to it will appear in this view.</small></label></details>
      {editing.renderer === 'board' && <details className="view-editor-section"><summary>Board columns</summary><fieldset className="query-builder board-builder"><p className="builder-status">Group items by status or by tag. Empty columns are hidden by default.</p><label>Group columns by<select value={boardSettingsFor(editing).groupBy} onChange={(event) => updateBoardSettings({ groupBy: event.target.value as BoardSettings['groupBy'] })}><option value="status">Status</option><option value="tag">Tags</option></select></label><label className="check"><input type="checkbox" checked={boardSettingsFor(editing).showEmpty} onChange={(event) => updateBoardSettings({ showEmpty: event.target.checked })} />Show empty columns</label>{boardSettingsFor(editing).groupBy === 'status' ? <><div className="board-column-settings">{boardSettingsFor(editing).states.map((state, index) => <div key={state}><label className="check"><input type="checkbox" checked onChange={() => updateBoardSettings({ states: boardSettingsFor(editing).states.filter((entry) => entry !== state) })} />{stateNames[state]}</label><div><button className="secondary compact-action" aria-label={`Move ${stateNames[state]} left`} disabled={index === 0} onClick={() => moveBoardState(index, -1)}>←</button><button className="secondary compact-action" aria-label={`Move ${stateNames[state]} right`} disabled={index === boardSettingsFor(editing).states.length - 1} onClick={() => moveBoardState(index, 1)}>→</button></div></div>)}</div><div className="builder-actions">{defaultBoardStates.filter((state) => !boardSettingsFor(editing).states.includes(state)).map((state) => <button className="secondary compact-action" key={state} onClick={() => updateBoardSettings({ states: [...boardSettingsFor(editing).states, state] })}>+ {stateNames[state]}</button>)}</div></> : <p className="builder-status">Each existing tag becomes a column automatically. Items without tags appear in “No tags”. Add or remove tags on items to change the columns.</p>}</fieldset></details>}
      <details className="view-editor-section"><summary>Sorting</summary><fieldset className="query-builder sort-builder">
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
      </fieldset></details>
      <details className="query-builder json-editor view-json-editor"><summary>View JSON</summary><div className="details-body"><p className="builder-status">This is the complete SavedView draft. Imported JSON is applied as a template and keeps this view ID.</p><CodeEditor language="json" ariaLabel="View JSON" rows={16} value={viewJson} onChange={setViewJson} /><div className="builder-actions"><button className="secondary compact-action" onClick={() => setViewJson(JSON.stringify({ ...editing, sortSource, sort: sortRules.map((rule) => ({ field: rule.expression, direction: rule.direction, nulls: rule.nulls })) }, null, 2))}>Refresh from visual editor</button><button className="secondary compact-action" onClick={() => applyViewJson()}>Apply JSON</button><button className="secondary compact-action" onClick={() => viewJsonRef.current?.click()}>Import as template</button><input ref={viewJsonRef} hidden type="file" accept=".json,application/json" onChange={(event) => event.target.files?.[0] && void importViewTemplate(event.target.files[0])} /></div></div></details>
      <details className="query-builder view-export-details"><summary>Export view</summary><div className="details-body"><p className="builder-status">Definitions use JSON. Results can also be opened in spreadsheets or calendar apps.</p><div className="builder-actions"><button className="secondary compact-action" onClick={() => exportView({ ...editing, sortSource, sort: sortRules.map((rule) => ({ field: rule.expression, direction: rule.direction, nulls: rule.nulls })) }, 'definition')}>Definition JSON</button><details className="inline-menu"><summary>Results…</summary><div><button onClick={() => exportView({ ...editing, sortSource, sort: sortRules.map((rule) => ({ field: rule.expression, direction: rule.direction, nulls: rule.nulls })) }, 'results')}>JSON</button><button onClick={() => exportView({ ...editing, sortSource, sort: sortRules.map((rule) => ({ field: rule.expression, direction: rule.direction, nulls: rule.nulls })) }, 'results', 'csv')}>CSV</button><button onClick={() => exportView({ ...editing, sortSource, sort: sortRules.map((rule) => ({ field: rule.expression, direction: rule.direction, nulls: rule.nulls })) }, 'results', 'xlsx')}>Excel</button><button onClick={() => exportView({ ...editing, sortSource, sort: sortRules.map((rule) => ({ field: rule.expression, direction: rule.direction, nulls: rule.nulls })) }, 'results', 'ics')}>iCalendar</button><button onClick={() => exportView({ ...editing, sortSource, sort: sortRules.map((rule) => ({ field: rule.expression, direction: rule.direction, nulls: rule.nulls })) }, 'results', 'ics', true)}>iCalendar + UTM metadata</button></div></details><button className="secondary compact-action" onClick={() => exportView({ ...editing, sortSource, sort: sortRules.map((rule) => ({ field: rule.expression, direction: rule.direction, nulls: rule.nulls })) }, 'bundle', 'xlsx')}>Definition + results Excel</button></div></div></details>
      {error && <p className="error">{error}</p>}
      <footer className="view-editor-actions"><button className="danger" onClick={() => { if (!confirmDelete) { setConfirmDelete(true); return; } commit('Delete view', (draft) => { delete draft.views[editing.id]; Object.values(draft.dashboards).forEach((dashboard) => { for (let index = dashboard.widgets.length - 1; index >= 0; index -= 1) if (dashboard.widgets[index]?.viewId === editing.id) dashboard.widgets.splice(index, 1); }); }); setEditing(null); setConfirmDelete(false); }}>{confirmDelete ? 'Confirm delete' : 'Delete view'}</button><span /><button className="secondary" onClick={() => setEditing(null)}>Cancel</button><button className="primary" onClick={save}>Save view</button></footer>
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
  const [allItemsSettingsOpen, setAllItemsSettingsOpen] = useState(false);
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
      recentlyDoneUntil.set(item.id, Date.now() + 10_000);
      setCelebratingIds((current) => new Set(current).add(item.id));
      window.setTimeout(() => setCelebratingIds((current) => { const next = new Set(current); next.delete(item.id); return next; }), 900);
    }
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
    if (item) setEditor(itemEditorSource(workspace, item));
  };

  if (boot === 'checking') return <main className="splash"><div className="brand-mark">U</div><p>Opening encrypted workspace…</p></main>;
  if (boot === 'empty' || boot === 'locked') return <LockScreen exists={boot === 'locked'} onReady={activate} />;
  if (!workspace || !session) return null;
  const allItemsView = allItemsViewFor(workspace);
  const uiKey = 'all:recurring';

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
  return <div className="app-shell">
    <aside className="sidebar"><div className="sidebar-brand"><div className="brand-mark small">U</div><span>Universal</span></div><nav>{nav.map(([target, icon, label, beta]) => <button key={target} className={page === target ? 'active' : ''} onClick={() => setPage(target)}><LineIcon name={icon}/><span>{label}</span>{beta && <em className="nav-beta" title="This area is still being tested and improved.">Beta</em>}{target === 'all' && <b title={`${openItems} active ${openItems === 1 ? 'item' : 'items'}`}>{openItems}</b>}</button>)}</nav><div className="sidebar-bottom"><button onClick={() => setTransfer(true)}><LineIcon name="transfer"/><span>Transfer</span></button><button onClick={() => { lock(session); setSession(null); setBoot('locked'); }}><LineIcon name="lock"/><span>Lock</span></button></div></aside>
    <main className="content">
      <header className="topbar"><div><span className="top-summary">{activeDateLabel}</span><span className="sync-state"><i /> Encrypted locally</span></div><div className="top-actions">{page === 'home' && <button className="views-add-button" aria-label="New view" title="New view" onClick={() => setNewViewRequest((value) => value + 1)}><LineIcon name="plus"/></button>}<button className="notice-button" aria-label="Notifications" aria-expanded={noticeCenterOpen} onClick={() => { setMobileNavOpen(false); setNoticeCenterOpen((open) => !open); setPopupNoticeIds([]); }} title="Notifications"><LineIcon name="bell"/>{notices.length > 0 && <b>{notices.length}</b>}</button><button className="mobile-menu-button" aria-label="Open navigation" aria-expanded={mobileNavOpen} onClick={() => { setNoticeCenterOpen(false); setMobileNavOpen((open) => !open); }}><LineIcon name="menu"/></button></div></header>
      {mobileNavOpen && <nav className="mobile-nav-menu" aria-label="Main navigation">{nav.map(([target, icon, label, beta]) => <button key={target} className={page === target ? 'active' : ''} onClick={() => { setPage(target); setMobileNavOpen(false); }}><LineIcon name={icon}/><span>{label}</span>{beta && <em className="nav-beta">Beta</em>}</button>)}</nav>}
      {!noticeCenterOpen && popupNoticeIds.length > 0 && <div className="notice-tray notice-popups" aria-live="polite">{popupNoticeIds.slice(-3).reverse().map((id) => notices.find((notice) => notice.id === id)).filter((notice): notice is Notice => Boolean(notice)).map((notice) => <article className="notice-card" key={notice.id}><button className="notice-content" onClick={() => openNoticeItem(notice)}><strong>{notice.title}</strong><span>{notice.body}</span></button><button type="button" className="notice-dismiss" aria-label="Close notification" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); dismissPopupNotice(notice.id); }} onClick={(event) => { event.preventDefault(); event.stopPropagation(); dismissPopupNotice(notice.id); }}><CloseIcon /></button></article>)}</div>}
      {noticeCenterOpen && <aside className="notification-center" aria-label="Notification center"><header><h2>Notifications</h2><button type="button" className="icon-button" aria-label="Close notification center" onClick={() => setNoticeCenterOpen(false)}><CloseIcon /></button></header><div className="notification-list">{notices.length ? notices.slice().reverse().map((notice) => <article className="notice-card" key={notice.id}><button className="notice-content" onClick={() => openNoticeItem(notice)}><strong>{notice.title}</strong><span>{notice.body}</span></button><button type="button" className="notice-dismiss" aria-label="Delete notification" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); deleteNotice(notice.id); }}><CloseIcon /></button></article>) : <p className="empty">No notifications</p>}</div></aside>}
      {page === 'home' && <><ViewsPage workspace={workspace} commit={commit} onEditItem={(item) => setEditor(itemEditorSource(workspace, item))} onState={changeItemState} celebratingIds={celebratingIds} createRequest={newViewRequest} onAddItem={(view) => { setEditorIsNew(true); setEditor(applyViewCreationDefaults(createUiItem('', 'task'), view)); }} /></>}
      {page === 'calendar' && <CalendarPage workspace={workspace} commit={commit} onEditItem={(item) => setEditor(itemEditorSource(workspace, item))} />}
      {page === 'all' && (() => { const recurringItems = Object.values(workspace.items).filter((item) => item.role === 'series_template' && !item.habit && !item.deletedAt && !isItemTemplate(item)); const templateItems = Object.values(workspace.items).filter((item) => isItemTemplate(item) && !item.deletedAt); const fields = allItemsView.fields ?? ['title', 'state']; const visibleItems = Object.values(workspace.items).filter((item) => !item.deletedAt && !isItemTemplate(item) && !isHabitOccurrence(workspace, item)); const openItem = (item: UniversalItem) => setEditor(itemEditorSource(workspace, item)); return <section className="page-section"><header className="all-items-toolbar"><div><p className="eyebrow">EVERYTHING</p><h1>All items</h1></div><button className="secondary" onClick={() => setAllItemsSettingsOpen(true)}>Customize</button></header><div className="all-sections">{(['open', 'done', 'auto_closed', 'cancelled', 'archived'] as const).map((state) => { const items = Object.values(workspace.items).filter((item) => item.state === state && !item.deletedAt && !isItemTemplate(item) && (item.role !== 'series_template' || Boolean(item.habit)) && !isHabitOccurrence(workspace, item)); const uiKey = `all:${state}`; return <details key={state} open={readUiBoolean(uiKey, state === 'open' || state === 'auto_closed')} onToggle={(event) => persistUiBoolean(uiKey, event.currentTarget.open)}><summary><span>{stateNames[state]}</span><b>{items.length}</b></summary><div className="item-list">{items.map((item) => <ItemCard key={item.id} item={item} fields={fields} workspace={workspace} onEdit={() => openItem(item)} onState={(nextState) => changeItemState(item, nextState)} />)}</div></details>; })}<details open={readUiBoolean('all:templates', templateItems.length > 0)} onToggle={(event) => persistUiBoolean('all:templates', event.currentTarget.open)} className="recurring-items"><summary><span>Templates</span><b>{templateItems.length}</b></summary><div className="item-list">{templateItems.length ? templateItems.map((item) => <ItemCard key={item.id} item={item} fields={fields} workspace={workspace} onEdit={() => openItem(item)} onState={(nextState) => changeItemState(item, nextState)} />) : <p className="empty">No templates yet.</p>}</div></details><details open={readUiBoolean('all:recurring', recurringItems.length > 0)} onToggle={(event) => persistUiBoolean('all:recurring', event.currentTarget.open)} className="recurring-items"><summary><span>Recurring items</span><b>{recurringItems.length}</b></summary><p className="section-help">These are the recurrence source settings. Auto-renew keeps one live item and records finished cycles inside its Cycle history.</p><div className="item-list">{recurringItems.length ? recurringItems.map((item) => <ItemCard key={item.id} item={item} fields={fields} workspace={workspace} onEdit={() => openItem(item)} onState={(nextState) => changeItemState(item, nextState)} />) : <p className="empty">No recurring items yet.</p>}</div></details></div><AllItemsCollections items={visibleItems} fields={fields} workspace={workspace} onEdit={openItem} onState={changeItemState} /><DeletedItemsList items={deletedItems} onRestore={restoreItem} onClear={clearTrash} onDelete={permanentlyDeleteItem} />{allItemsSettingsOpen && <AllItemsSettings workspace={workspace} view={allItemsView} onClose={() => setAllItemsSettingsOpen(false)} onSave={(view) => commit('Customize all items view', (draft) => { draft.views[ALL_ITEMS_VIEW_ID] = clean(view); })} />}</section>; })()}
      {page === 'automations' && <AutomationsPage workspace={workspace} commit={commit} />}
      {page === 'settings' && <SettingsPage workspace={workspace} commit={commit} onTransfer={() => setTransfer(true)} onImportFile={(file) => { void portableFromFile(file, workspace).then(({ source, warnings }) => { if (warnings.length) setToast(warnings[0]!); setPortableImportSource(source); }).catch((error) => setToast(error instanceof Error ? error.message : String(error))); }} onNotify={() => void Notification.requestPermission().then((permission) => setToast(`Notification permission: ${permission}`))} onEnableBackground={() => void enableBackgroundNotifications()} onDisableBackground={() => void disableBackgroundNotifications()} onBackgroundContent={setBackgroundNotificationContent} />}
      {page === 'settings' && <section className="settings-card diagnostics-card"><p className="eyebrow">DIAGNOSTICS</p><h2>Usage and error log</h2><p>Anonymous local diagnostics help investigate failures and unusual behavior. Nothing is uploaded automatically.</p><div className="diagnostics-actions"><span>{diagnosticCount} recorded entries</span><button className="secondary" onClick={downloadDiagnostics} disabled={!diagnosticCount}>Download log</button><button className="secondary" onClick={() => { localStorage.removeItem(DIAGNOSTICS_KEY); setDiagnosticCount(0); }}>Clear log</button></div></section>}
    </main>
    <div className="capture-dock"><div className="quick-capture"><input ref={captureInputRef} enterKeyHint="done" value={quick} onChange={(event) => setQuick(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); captureQuickItem(); } }} placeholder="Add new task" aria-label="Add new task"/></div></div>
    {editor && <ItemEditor initial={editor} workspace={workspace} isNew={editorIsNew} onClose={() => { setEditorIsNew(false); setEditor(null); }} onToggleSubtask={(id) => { const subtask = workspace.items[id]; if (subtask) changeItemState(subtask, subtask.state === 'done' ? 'open' : 'done'); }} onCreateSubtask={(title, parentId) => { const subtask = createUiItem(title, 'task'); commit('Create subtask', (draft) => { draft.items[subtask.id] = clean(subtask); const parent = draft.items[parentId]; if (parent && !parent.relations.some((relation) => relation.type === 'parent' && relation.targetId === subtask.id)) parent.relations = [...parent.relations, { id: createId(), targetId: subtask.id, type: 'parent' }]; }); return subtask; }} onSave={(item) => { const isNew = !workspace.items[item.id]; let recurrenceError = ''; const saved = commit(isNew ? 'Create item' : 'Update item', (draft) => { const before = draft.items[item.id]; draft.items[item.id] = clean(item); if (before?.state === 'open' && (item.state === 'done' || item.state === 'cancelled') && item.occurrence && item.closure?.at) advanceCompletionAnchoredSeries(draft, item, item.closure.at); const event = { id: createId(), type: isNew ? 'item.created' as const : 'item.updated' as const, at: item.updatedAt, itemId: item.id, after: clean(item), causationId: createId(), depth: 0 }; runAutomationEvents(draft, [event]); if (item.role === 'series_template') { try { reconcileRecurrences(draft); } catch (reason) { recurrenceError = reason instanceof Error ? reason.message : String(reason); } } }); if (saved) { setEditorIsNew(false); setEditor(null); if (recurrenceError) setToast(`Series saved. Recurrence sync will retry in the background (${recurrenceError}).`); } }} onDelete={(item) => { const deleted = commit('Delete item', (draft) => { const target = draft.items[item.id]; if (target) { target.deletedAt = new Date().toISOString(); draft.tombstones[item.id] = target.deletedAt; } }); if (deleted) { setEditorIsNew(false); setEditor(null); } }} />}
    {transfer && <TransferDialog session={session} onClose={() => setTransfer(false)} onBackupExported={() => { commit('Record encrypted backup', (draft) => { draft.calendarPreferences.backupPreferences = { ...(draft.calendarPreferences.backupPreferences ?? { reminderDays: 7 }), lastBackupAt: new Date().toISOString() }; }); setBackupReminder(false); setToast('Encrypted backup saved. Choose its folder in Files.'); }} onMerged={(next, message) => { setSession(next); setToast(message); }} onReplaced={(next, message) => { lock(session); setSession(next); setToast(message); }} />}
    {portableImportSource && <PortableImportDialog workspace={workspace} source={portableImportSource} onClose={() => setPortableImportSource(null)} onApply={(preview) => { commit('Import portable JSON package', (draft) => { const result = applyPortableImport(draft, preview); setToast(`Imported ${result.addedItems + result.copiedItems} items and ${result.addedViews + result.copiedViews} views`); }); setPortableImportSource(null); }} />}
    {page === 'settings' && workspace && <section className="settings-card backup-controls"><p className="eyebrow">BACKUP SCHEDULE</p><h2>Backup reminders</h2><p>Choose how often the app should remind you to export an encrypted <code>.utmb</code> backup. The browser will not write to a folder by itself.</p><label>Remind every (days; 0 disables)<input type="number" min="0" step="1" value={workspace.calendarPreferences.backupPreferences?.reminderDays ?? 7} onChange={(event) => commit('Change backup reminder', (draft) => { draft.calendarPreferences.backupPreferences = { ...(draft.calendarPreferences.backupPreferences ?? { reminderDays: 7 }), reminderDays: Math.max(0, Number(event.target.value) || 0) }; })} /></label><label>Backup location note (optional)<input value={workspace.calendarPreferences.backupPreferences?.locationLabel ?? ''} placeholder="iCloud Drive / Universal" onChange={(event) => commit('Change backup location note', (draft) => { draft.calendarPreferences.backupPreferences = { ...(draft.calendarPreferences.backupPreferences ?? { reminderDays: 7 }), locationLabel: event.target.value }; })} /></label><button className="secondary" onClick={() => setTransfer(true)}>Create encrypted backup now</button>{workspace.calendarPreferences.backupPreferences?.lastBackupAt && <small>Last backup: {formatRussianDateTime(workspace.calendarPreferences.backupPreferences.lastBackupAt)}</small>}</section>}
    {backupReminder && !transfer && <div className="toast backup-reminder" role="alert"><span>It is time to create an encrypted backup.</span><button className="secondary" onClick={() => setTransfer(true)}>Back up now</button><button className="icon-button" aria-label="Dismiss backup reminder" onClick={() => setBackupReminder(false)}>×</button></div>}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}
