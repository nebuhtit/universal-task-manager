export const SCHEMA_VERSION = '1.8.0';
export const APP_ID = 'dev.universal-task-manager';
export const APP_NAME = 'Universal Task Manager';
export const APP_VERSION = '1.7.0';
export const APP_RELEASED_AT = '2026-08-26T01:40:06+03:00';
export const LEGACY_APP_VERSION = '0.1.0';

export type ItemState = 'open' | 'done' | 'cancelled' | 'auto_closed' | 'archived';
export type ItemPreset = 'task' | 'event' | 'habit' | 'blank';
export type ItemRole = 'standalone' | 'series_template' | 'occurrence';
export type ISODateTime = string;
export type ISODuration = string;
export type Scalar = string | number | boolean | null;
export type CustomValue = Scalar | Scalar[];

export interface Closure {
  at: ISODateTime;
  actor: 'user' | 'system' | 'automation' | 'import';
  reason: 'manual' | 'auto_renew' | 'rule' | 'cancelled' | 'import';
  automationId?: string;
}

export interface Schedule {
  timezone: string;
  allDay?: boolean;
  availableFrom?: ISODateTime;
  startAt?: ISODateTime;
  endAt?: ISODateTime;
  dueAt?: ISODateTime;
  estimatedDuration?: ISODuration;
  actualDuration?: ISODuration;
}

export interface RecurrenceRule {
  rrule: string;
  rdates: ISODateTime[];
  exdates: ISODateTime[];
  timezone: string;
  activationOffset?: ISODuration;
  dueOffset?: ISODuration;
  closeAt: 'next_activation' | 'due' | 'never';
  anchor: 'schedule' | 'completion';
  autoRenew: boolean;
}

export interface OccurrenceInfo {
  seriesId: string;
  recurrenceId: ISODateTime;
  sequence: number;
  templateRevision: number;
}

/** Immutable record of a finished recurrence cycle kept inside a rolling item. */
export interface CycleHistoryEntry {
  recurrenceId: ISODateTime;
  availableFrom?: ISODateTime;
  startAt?: ISODateTime;
  endAt?: ISODateTime;
  dueAt?: ISODateTime;
  closedAt: ISODateTime;
  state: 'done' | 'cancelled' | 'auto_closed';
  actor: Closure['actor'];
  reason: Closure['reason'];
}

export interface RecurrenceOverride {
  kind: 'this_occurrence' | 'future_split';
  sourceSeriesId: string;
  recurrenceId: ISODateTime;
}

export interface Progress {
  mode: 'boolean' | 'percent' | 'counter';
  current: number;
  target: number;
  unit?: string;
}

export interface Habit {
  target: number;
  unit: string;
  streakMode: 'manual_only' | 'any_closed';
  /** Calendar days completed by the user. Missing scheduled days are skips. */
  completedDates: string[];
}

export interface Reminder {
  id: string;
  mode: 'absolute' | 'relative';
  at?: ISODateTime;
  relativeTo?: 'available' | 'start' | 'due' | 'end';
  offset?: ISODuration;
  urgency: 'normal' | 'urgent' | 'critical';
  repeatEvery?: ISODuration;
  repeatUntilAcknowledged: boolean;
  acknowledgedAt?: ISODateTime;
}

function reminderMoment(value?: ISODateTime): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  date.setUTCSeconds(0, 0);
  return date.toISOString();
}

export function reminderSignature(reminder: Reminder): string {
  return JSON.stringify({
    mode: reminder.mode,
    at: reminderMoment(reminder.at),
    relativeTo: reminder.relativeTo ?? '',
    offset: reminder.offset ?? '',
    urgency: reminder.urgency,
    repeatEvery: reminder.repeatEvery ?? '',
    repeatUntilAcknowledged: reminder.repeatUntilAcknowledged,
    acknowledgedAt: reminderMoment(reminder.acknowledgedAt),
  });
}

/** Removes semantic duplicates in-place and preserves the first reminder ID. */
export function removeDuplicateReminders(item: UniversalItem): number {
  const seen = new Set<string>();
  let removed = 0;
  for (let index = 0; index < item.reminders.length; index += 1) {
    const signature = reminderSignature(item.reminders[index]!);
    if (!seen.has(signature)) { seen.add(signature); continue; }
    item.reminders.splice(index, 1);
    index -= 1;
    removed += 1;
  }
  return removed;
}

export type RelationType = 'parent' | 'blocks' | 'blocked_by' | 'related' | 'duplicate' | 'custom';
export interface ItemRelation { id: string; targetId: string; type: RelationType; label?: string }
export interface LinkAttachment { id: string; url: string; title?: string; mimeType?: string }

export interface UniversalItem {
  id: string;
  schemaVersion: string;
  readonly createdWithAppId: string;
  readonly createdWithAppName: string;
  readonly createdWithVersion: string;
  revision: number;
  role: ItemRole;
  preset: ItemPreset;
  title: string;
  bodyMarkdown: string;
  state: ItemState;
  closure?: Closure;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  deletedAt?: ISODateTime;
  schedule?: Schedule;
  recurrence?: RecurrenceRule;
  occurrence?: OccurrenceInfo;
  /** Finished cycles for auto-renew recurrence. The live occurrence itself is reused. */
  cycleHistory?: CycleHistoryEntry[];
  recurrenceOverride?: RecurrenceOverride;
  progress?: Progress;
  habit?: Habit;
  priority?: 0 | 1 | 2 | 3 | 4;
  /** Optional plain task-list membership. Items can belong to one list or no list. */
  list?: string;
  contexts: string[];
  tags: string[];
  reminders: Reminder[];
  relations: ItemRelation[];
  attachments: LinkAttachment[];
  custom: Record<string, CustomValue>;
  /** Safe, item-local computed fields. Expressions use the allowlisted UTM DSL; arbitrary JavaScript is never executed. */
  scripts?: ItemScriptField[];
  /** Namespaced data from a newer or foreign schema that this version cannot interpret. */
  extensions?: Record<string, unknown>;
}

export type ItemScriptResultKind = 'text' | 'number' | 'boolean' | 'datetime' | 'duration';
export interface ItemScriptField {
  id: string;
  key: string;
  label: string;
  source: string;
  resultKind: ItemScriptResultKind;
}

export type CustomFieldKind =
  | 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'duration'
  | 'enum' | 'multi_enum' | 'url' | 'item_ref' | 'formula';

export interface CustomFieldDefinition {
  id: string;
  key: string;
  label: string;
  kind: CustomFieldKind;
  required: boolean;
  options?: string[];
  formula?: string;
  formulaResult?: Exclude<CustomFieldKind, 'formula' | 'multi_enum'>;
}

export interface QuerySpec {
  source: string;
  ast?: Expression;
}

export interface ViewSortRule {
  expression: string;
  direction: 'asc' | 'desc';
  nulls: 'first' | 'last';
}

export interface SavedView {
  id: string;
  name: string;
  /** Optional accent used for the view title and completed ticks. */
  accent?: string;
  query: QuerySpec;
  renderer: 'list' | 'table' | 'calendar' | 'board';
  /** Legacy structured form retained for portable older workspaces. */
  sort: Array<{ field: string; direction: 'asc' | 'desc'; nulls?: 'first' | 'last' }>;
  /** One safe DSL expression per line: `<expression> asc|desc nulls first|last`. */
  sortSource?: string;
  groupBy?: string;
  fields: string[];
  /** Optional list membership constraint. Empty means all lists. */
  list?: string;
  /** Explicit editable values copied into a fresh item created from this view. */
  creationDefaults?: Record<string, unknown>;
  /** Namespaced data from a newer or foreign schema that this version cannot interpret. */
  extensions?: Record<string, unknown>;
}

export interface PortableSource {
  appId: string;
  appName: string;
  appVersion: string;
  workspaceId: string;
}

export type PortableSelection =
  | { type: 'single_item'; itemId: string }
  | { type: 'view_results'; viewId: string; viewName: string }
  | { type: 'all_items' }
  | { type: 'view_definition'; viewId: string; viewName: string };

export interface PortablePackage {
  format: 'utm-portable';
  formatVersion: 1;
  kind: 'items' | 'views' | 'view_bundle';
  schemaVersion: string;
  exportedAt: ISODateTime;
  source: PortableSource;
  customFields: Record<string, CustomFieldDefinition>;
  items: UniversalItem[];
  views: SavedView[];
  selection?: PortableSelection;
  dependencyItemIds: string[];
  extensions?: Record<string, unknown>;
}

export interface DashboardWidget {
  id: string;
  type: 'smart_list' | 'table' | 'calendar' | 'board' | 'habit_summary' | 'markdown';
  title: string;
  viewId?: string;
  markdown?: string;
  width: 1 | 2 | 3;
  order: number;
}

export interface Dashboard { id: string; name: string; widgets: DashboardWidget[] }

export type AutomationTriggerType =
  | 'item.created' | 'item.updated' | 'status.changed' | 'occurrence.activated'
  | 'occurrence.boundary' | 'reminder.due' | 'time.schedule';

export interface AutomationTrigger { type: AutomationTriggerType; rrule?: string; timezone?: string }
export type AutomationAction =
  | { type: 'set_field'; path: string; value: CustomValue }
  | { type: 'close'; state: 'done' | 'cancelled' | 'auto_closed' }
  | { type: 'archive' }
  | { type: 'create_item'; title: string; preset: ItemPreset }
  | { type: 'add_relation'; targetId: string; relation: RelationType }
  | { type: 'set_progress'; current: number }
  | { type: 'add_reminder'; reminder: Reminder }
  | { type: 'notify'; title: string; body: string };

export interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  condition: QuerySpec;
  actions: AutomationAction[];
  missedPolicy: 'run_each' | 'run_once' | 'skip';
  maxDepth: number;
  cooldownMs: number;
  lastRunAt?: ISODateTime;
  disabledReason?: string;
}

export interface AutomationLogEntry {
  id: string;
  ruleId: string;
  itemId?: string;
  trigger: AutomationTriggerType;
  startedAt: ISODateTime;
  finishedAt: ISODateTime;
  outcome: 'success' | 'skipped' | 'failed' | 'loop_blocked';
  message?: string;
  causationId: string;
  depth: number;
  idempotencyKey: string;
}

export interface WorkspaceDocument {
  schemaVersion: string;
  workspaceId: string;
  name: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  items: Record<string, UniversalItem>;
  customFields: Record<string, CustomFieldDefinition>;
  views: Record<string, SavedView>;
  dashboards: Record<string, Dashboard>;
  automations: Record<string, AutomationRule>;
  automationLog: AutomationLogEntry[];
  tombstones: Record<string, ISODateTime>;
  calendarPreferences: CalendarPreferences;
  /** Encrypted credentials and preferences for optional background Web Push. */
  pushPreferences: PushPreferences;
}

export type CalendarViewMode = 'month' | 'week' | 'day' | 'three_day' | 'agenda';
/** UI language is a workspace preference; item data itself remains language-neutral. */
export type WorkspaceLanguage = 'en' | 'ru' | 'es' | 'de' | 'fr' | 'ko';
export interface CalendarPreferences {
  timezone: string;
  lastMode: CalendarViewMode;
  weekStartsOn: 0 | 1;
  workingHours: { start: string; end: string };
  sleepSchedule: { wake: string; sleep: string };
  weekends: boolean;
  snapMinutes: number;
  defaultDurationMinutes: number;
  timeFormat: '24h';
  language: WorkspaceLanguage;
  appearance: { mode: 'system' | 'light' | 'dark' | 'scheduled'; lightAt: string; darkAt: string; tickSound: boolean; uiSound: boolean; /** Records the one-time upgrade that enabled calm sounds by default. */ soundDefaultsVersion?: 1 };
  selectedViewId?: string;
  includeStates: ItemState[];
  /** Optional accelerated clock for local recurrence testing; never enabled by default. */
  testClock?: { enabled: boolean; secondsPerDay: number; startedAt: ISODateTime; virtualAt: ISODateTime };
  backupPreferences?: { reminderDays: number; lastBackupAt?: ISODateTime; locationLabel?: string };
}

export interface PushPreferences {
  /** Background delivery is opt-in; local reminders work without this service. */
  enabled: boolean;
  /** Public Worker origin. It never receives the workspace password or database. */
  serviceUrl?: string;
  /** Random per-device identity, stored only inside the encrypted workspace. */
  deviceId?: string;
  /** Random bearer secret for the device identity, also encrypted at rest. */
  deviceSecret?: string;
  /** Whether notification title/body may leave this device for lock-screen display. */
  contentMode: 'generic' | 'detailed';
  lastSyncedAt?: ISODateTime;
  lastError?: string;
}

export interface ProjectedOccurrence {
  id: string;
  sourceItemId: string;
  materializedItemId?: string;
  seriesId?: string;
  recurrenceId?: ISODateTime;
  virtual: boolean;
  title: string;
  state: ItemState;
  preset: ItemPreset;
  priority?: 0 | 1 | 2 | 3 | 4;
  schedule: Schedule;
  dueOnly: boolean;
}

export type Expression =
  | { type: 'literal'; value: Scalar }
  | { type: 'identifier'; path: string }
  | { type: 'unary'; operator: '!' | '-'; argument: Expression }
  | { type: 'binary'; operator: string; left: Expression; right: Expression }
  | { type: 'call'; name: string; args: Expression[] };

export interface DomainEvent {
  id: string;
  type: AutomationTriggerType;
  at: ISODateTime;
  itemId?: string;
  before?: UniversalItem;
  after?: UniversalItem;
  causationId: string;
  depth: number;
}

export interface ReconcileResult {
  created: UniversalItem[];
  updated: UniversalItem[];
  autoClosed: UniversalItem[];
  removedIds: string[];
  untouched: number;
}

export function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function backfillItemCreationVersions(workspace: WorkspaceDocument, legacyVersion = LEGACY_APP_VERSION): number {
  let changed = 0;
  for (const item of Object.values(workspace.items)) {
    const mutable = item as UniversalItem & { createdWithAppId?: string; createdWithAppName?: string; createdWithVersion?: string };
    let itemChanged = false;
    if (!mutable.createdWithAppId) { mutable.createdWithAppId = APP_ID; itemChanged = true; }
    if (!mutable.createdWithAppName) { mutable.createdWithAppName = APP_NAME; itemChanged = true; }
    if (!mutable.createdWithVersion) { mutable.createdWithVersion = legacyVersion; itemChanged = true; }
    if (itemChanged) changed += 1;
  }
  return changed;
}

export function createWorkspace(name = 'My workspace', now = new Date()): WorkspaceDocument {
  const timestamp = now.toISOString();
  const inboxId = createId();
  const dashboardId = createId();
  return {
    schemaVersion: SCHEMA_VERSION,
    workspaceId: createId(),
    name,
    createdAt: timestamp,
    updatedAt: timestamp,
    items: {},
    customFields: {},
    views: {
      '__all_items__': {
        id: '__all_items__',
        name: 'All items',
        query: { source: 'role != "series_template" && isTemplate != true' },
        renderer: 'list',
        sort: [{ field: 'updatedAt', direction: 'desc' }],
        fields: [],
      },
      [inboxId]: {
        id: inboxId,
        name: 'Now',
        query: { source: '(state == "open" || state == "done") && role != "series_template" && isTemplate != true' },
        renderer: 'table',
        sort: [{ field: 'schedule.dueAt', direction: 'asc' }],
        fields: ['title', 'schedule.dueAt', 'priority', 'tags'],
      },
    },
    dashboards: {
      [dashboardId]: {
        id: dashboardId,
        name: 'Home',
        widgets: [
          { id: createId(), type: 'smart_list', title: 'Now', viewId: inboxId, width: 2, order: 0 },
          { id: createId(), type: 'habit_summary', title: 'Habits', width: 1, order: 1 },
        ],
      },
    },
    automations: {},
    automationLog: [],
    tombstones: {},
    calendarPreferences: {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      lastMode: 'month', weekStartsOn: 1, workingHours: { start: '08:00', end: '22:00' }, sleepSchedule: { wake: '08:00', sleep: '22:00' },
      weekends: true, snapMinutes: 15, defaultDurationMinutes: 30, timeFormat: '24h', language: 'en', appearance: { mode: 'system', lightAt: '07:00', darkAt: '20:00', tickSound: true, uiSound: true, soundDefaultsVersion: 1 },
      includeStates: ['open', 'done'],
      testClock: { enabled: false, secondsPerDay: 86_400, startedAt: now.toISOString(), virtualAt: now.toISOString() },
      backupPreferences: { reminderDays: 7 },
    },
    pushPreferences: { enabled: false, contentMode: 'generic' },
  };
}

export function createItem(
  title: string,
  preset: ItemPreset = 'task',
  now = new Date(),
): UniversalItem {
  const timestamp = now.toISOString();
  const item: UniversalItem = {
    id: createId(),
    schemaVersion: SCHEMA_VERSION,
    createdWithAppId: APP_ID,
    createdWithAppName: APP_NAME,
    createdWithVersion: APP_VERSION,
    revision: 1,
    role: 'standalone',
    preset,
    title,
    bodyMarkdown: '',
    state: 'open',
    createdAt: timestamp,
    updatedAt: timestamp,
    contexts: [],
    tags: [],
    reminders: [],
    relations: [],
    attachments: [],
    custom: {},
  };
  if (preset === 'event') item.schedule = { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  if (preset === 'habit') {
    item.progress = { mode: 'counter', current: 0, target: 1 };
    item.habit = { target: 1, unit: 'times', streakMode: 'manual_only', completedDates: [] };
  }
  return item;
}
