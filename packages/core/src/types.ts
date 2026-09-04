export const SCHEMA_VERSION = '1.22.0';
export const APP_ID = 'dev.universal-task-manager';
export const APP_NAME = 'Universal Task Manager';
export const APP_VERSION = '1.99.3';
export const APP_RELEASED_AT = '2026-09-04T16:15:14.703Z';
export const LEGACY_APP_VERSION = '0.1.0';
export const ACTIVE_ITEM_VIEW_QUERY = 'state == "open" && isTemplate != true';
export const LEGACY_ACTIVE_ITEM_VIEW_QUERY = 'state == "open" && role != "series_template" && isTemplate != true';
export const LEGACY_STANDARD_VIEW_SORT_SOURCE = 'schedule.dueAt asc nulls last\nschedule.startAt asc nulls last\norganizationOrder asc nulls last';
export const STANDARD_ATTENTION_VIEW_SORT_SOURCE = 'organizationOrder desc nulls last\nattentionOrder asc nulls last\ndurationOrder desc nulls last\ncreatedAt desc nulls last';

export const standardAttentionViewSort = () => [
  { field: 'organizationOrder', direction: 'desc' as const, nulls: 'last' as const },
  { field: 'attentionOrder', direction: 'asc' as const, nulls: 'last' as const },
  { field: 'durationOrder', direction: 'desc' as const, nulls: 'last' as const },
  { field: 'createdAt', direction: 'desc' as const, nulls: 'last' as const },
];

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
  /** A running stopwatch survives item saves and app restarts. */
  activeTimerStartedAt?: ISODateTime;
  timerSessions?: Array<{ id: string; startedAt: ISODateTime; endedAt: ISODateTime; durationSeconds: number }>;
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

const durationUnits: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000, M: 2_592_000_000, Y: 31_536_000_000 };

export function durationToMs(value: string): number {
  const sign = value.startsWith('-') ? -1 : 1; const normalized = value.replace(/^-/, '');
  const short = /^(\d+(?:\.\d+)?)([smhdw])$/.exec(normalized);
  if (short) return sign * Number(short[1]) * durationUnits[short[2]!]!;
  const iso = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(normalized);
  if (!iso) throw new TypeError(`Unsupported duration: ${value}`);
  return sign * (Number(iso[1] ?? 0) * durationUnits.Y! + Number(iso[2] ?? 0) * durationUnits.M! + Number(iso[3] ?? 0) * 86_400_000 + Number(iso[4] ?? 0) * 3_600_000 + Number(iso[5] ?? 0) * 60_000 + Number(iso[6] ?? 0) * 1_000);
}

/** Resolves absolute and relative reminders without mutating the item. Invalid or incomplete reminders stay unresolved. */
export function reminderTime(item: UniversalItem, reminder: Reminder): string | undefined {
  if (reminder.acknowledgedAt) return undefined;
  if (reminder.mode === 'absolute') {
    const timestamp = reminder.at ? Date.parse(reminder.at) : Number.NaN;
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
  }
  const base = reminder.relativeTo === 'available' ? item.schedule?.availableFrom
    : reminder.relativeTo === 'start' ? item.schedule?.startAt
      : reminder.relativeTo === 'end' ? item.schedule?.endAt : item.schedule?.dueAt;
  const baseTime = base ? Date.parse(base) : Number.NaN;
  if (!Number.isFinite(baseTime)) return undefined;
  try {
    const timestamp = baseTime + (reminder.offset ? durationToMs(reminder.offset) : 0);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
  } catch { return undefined; }
}

export function activeReminders(item: UniversalItem): Reminder[] {
  return item.reminders.filter((reminder) => !reminder.acknowledgedAt);
}

export function nextActiveReminderAt(item: UniversalItem): string | undefined {
  return activeReminders(item).map((reminder) => reminderTime(item, reminder)).filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
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
export interface ItemTimerSession {
  id: string;
  mode: 'timer' | 'stopwatch';
  startedAt: ISODateTime;
  endedAt: ISODateTime;
  durationSeconds: number;
  targetSeconds?: number;
}

/** Provenance for an immutable event mirrored from an external calendar. */
export interface ExternalCalendarSource {
  provider: 'google_calendar';
  connectionId: string;
  calendarId: string;
  eventId: string;
  sourceUrl: string;
  readOnly: true;
  transparency?: 'opaque' | 'transparent';
  etag?: string;
  syncedAt: ISODateTime;
}

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
  /** Optional event/location hint for future calendar integrations. */
  location?: string;
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
  /** Ongoing PARA responsibilities. Independent from Projects and a plain list. */
  areas: string[];
  /** Finite PARA outcomes. Projects may belong to several Areas. */
  projects: string[];
  /** Legacy scalar accepted only while migrating older workspaces. */
  area?: string;
  /** Legacy scalar accepted only while migrating older workspaces. */
  project?: string;
  contexts: string[];
  tags: string[];
  reminders: Reminder[];
  relations: ItemRelation[];
  attachments: LinkAttachment[];
  /** Completed quick timer and stopwatch sessions; active controls remain editor-local. */
  timerHistory?: ItemTimerSession[];
  /** External events are edited only in their source calendar. */
  external?: ExternalCalendarSource;
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

export interface ViewStatisticsSettings {
  /** Shows duration-weighted completion, remaining work and capacity for finite periods. */
  showTime: boolean;
  /** Scheduled or recurring source items that always reserve capacity in this view period. */
  reservedItemIds: string[];
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
  /** Optional Area constraint and creation default. */
  area?: string;
  /** Optional Project constraint and creation default. */
  project?: string;
  /** Explicit editable values copied into a fresh item created from this view. */
  creationDefaults?: Record<string, unknown>;
  /** Optional presentation and capacity settings. Missing settings retain the legacy visible summary. */
  statistics?: ViewStatisticsSettings;
  /** Safe computed columns evaluated against every item matched by this View. */
  scripts?: ItemScriptField[];
  /** Namespaced data from a newer or foreign schema that this version cannot interpret. */
  extensions?: Record<string, unknown>;
}

export type ListKind = 'list' | 'project' | 'area' | 'resource' | 'archive';

/** Workspace-level metadata for the plain list name stored on each item. */
export interface ListDefinition {
  name: string;
  kind: ListKind;
  priority: 0 | 1 | 2 | 3 | 4;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface AreaDefinition {
  name: string;
  /** Optional accent used when presenting this Area throughout the interface. */
  accent?: string;
  /** Accepted only while normalizing older portable packages. */
  priority?: 0 | 1 | 2 | 3 | 4;
  /** Accepted only while normalizing older portable packages. */
  order?: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface ProjectDefinition extends AreaDefinition {
  /** Parent Areas. An empty array means the Project is unassigned. */
  areas: string[];
  /** Optional Project accent used by its name and derived progress presentation. */
  accent?: string;
  /** Legacy scalar accepted only while migrating older workspaces. */
  area?: string;
}

export type OrganizationPriorityKind = 'area' | 'project' | 'tag';
export interface OrganizationPriorityEntry {
  kind: OrganizationPriorityKind;
  /** Null represents No Area, No Project, or No Tags for its kind. */
  name: string | null;
  /** Project occurrence scope. A Project linked to several Areas has one entry per Area. */
  area?: string | null;
}

export interface OrganizationPreferences {
  /** Top-to-bottom order. A single null is the movable unassigned row. */
  areaOrder: Array<string | null>;
  projectOrder: Array<string | null>;
  tagOrder: Array<string | null>;
  /** Optional presentation accents keyed by the exact reusable Tag name. */
  tagAccents?: Record<string, string>;
  /** Unified top-to-bottom priority across Areas, Projects and Tags. */
  priorityOrder: OrganizationPriorityEntry[];
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
  areaDefinitions?: Record<string, AreaDefinition>;
  projectDefinitions?: Record<string, ProjectDefinition>;
  organizationPreferences?: OrganizationPreferences;
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

export interface MigrationIssue {
  id: string;
  entityType: 'workspace' | 'item' | 'view' | 'automation';
  entityId: string;
  sourceVersion: string;
  code: string;
  disabledCapability: 'recurrence' | 'script' | 'filter' | 'automation' | 'reminder' | 'entity';
  status: 'needs_repair' | 'resolved';
  detectedAt: ISODateTime;
}

export interface WorkspaceDocument {
  schemaVersion: string;
  workspaceId: string;
  name: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  items: Record<string, UniversalItem>;
  /** Shared PARA/order metadata keyed by the exact list name used by items and views. */
  listDefinitions: Record<string, ListDefinition>;
  /** PARA Areas keyed by their exact user-visible name. */
  areaDefinitions: Record<string, AreaDefinition>;
  /** PARA Projects keyed by their exact user-visible name. */
  projectDefinitions: Record<string, ProjectDefinition>;
  organizationPreferences: OrganizationPreferences;
  customFields: Record<string, CustomFieldDefinition>;
  views: Record<string, SavedView>;
  /** Shared display order for saved Views. IDs absent from this list are appended safely. */
  viewOrder: string[];
  dashboards: Record<string, Dashboard>;
  automations: Record<string, AutomationRule>;
  automationLog: AutomationLogEntry[];
  migrationIssues: MigrationIssue[];
  tombstones: Record<string, ISODateTime>;
  calendarPreferences: CalendarPreferences;
  /** Encrypted credentials and preferences for optional background Web Push. */
  pushPreferences: PushPreferences;
}

export type CalendarViewMode = 'month' | 'week' | 'day' | 'three_day' | 'agenda';
export type TestClockUnit = 'seconds' | 'minutes' | 'hours';
export interface TestClockPreferences {
  enabled: boolean;
  /** Canonical real-time duration of one simulated day. */
  secondsPerDay: number;
  /** User-facing input retained so Settings does not silently change units. */
  dayDurationValue?: number;
  dayDurationUnit?: TestClockUnit;
  startedAt: ISODateTime;
  virtualAt: ISODateTime;
}
/** UI language is a workspace preference; item data itself remains language-neutral. */
export type WorkspaceLanguage = 'en' | 'ru' | 'es' | 'de' | 'fr' | 'ko';
export interface GoogleCalendarDefinition {
  id: string;
  name: string;
  primary?: boolean;
  selected: boolean;
}
export interface GoogleCalendarPreferences {
  connectionId: string;
  accountEmail?: string;
  calendars: GoogleCalendarDefinition[];
  /** Opaque Google sync tokens. OAuth access tokens are deliberately never persisted. */
  syncTokens: Record<string, string>;
  /** The bounded event window used for the last full sync. Refreshed periodically so the horizon keeps moving. */
  syncWindow?: { timeMin: ISODateTime; timeMax: ISODateTime; refreshedAt: ISODateTime };
  lastSyncedAt?: ISODateTime;
  lastError?: string;
}
export type CalendarScheduleSource = 'event_open' | 'event' | 'active' | 'due';
export interface CalendarDayViewPreferences {
  /** Additional filter applied inside the selected day boundary. */
  filter: QuerySpec;
  /** Schedule relationships matched with OR inside the fixed selected day. */
  scheduleSources: CalendarScheduleSource[];
  fields: string[];
  /** Presentation and capacity settings shared by every selected calendar day. */
  statistics?: ViewStatisticsSettings;
  sort: ViewSortRule[];
  sortSource?: string;
}
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
  appearance: { mode: 'system' | 'light' | 'dark' | 'scheduled'; lightAt: string; darkAt: string; tickSound: boolean; uiSound: boolean; overdueAgeIndicator: boolean; /** Records the one-time upgrade that enabled calm sounds by default. */ soundDefaultsVersion?: 1 };
  dayView: CalendarDayViewPreferences;
  /** Opt-in local operation logs used for troubleshooting; never uploaded automatically. */
  diagnosticsEnabled: boolean;
  /** Optional inline guides and explanatory copy; disabled by default for a compact interface. */
  showExplanations: boolean;
  /** Optional accelerated clock for local recurrence testing; never enabled by default. */
  testClock?: TestClockPreferences;
  backupPreferences?: { reminderDays: number; lastBackupAt?: ISODateTime; locationLabel?: string };
  googleCalendar?: GoogleCalendarPreferences;
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
  const todayId = createId();
  const weekId = createId();
  const dashboardId = createId();
  const activeQuery = ACTIVE_ITEM_VIEW_QUERY;
  const defaultFields = ['title', 'bodyMarkdown', 'schedule.startAt', 'schedule.dueAt', 'tags', 'area', 'project'];
  const defaultSort = standardAttentionViewSort();
  return {
    schemaVersion: SCHEMA_VERSION,
    workspaceId: createId(),
    name,
    createdAt: timestamp,
    updatedAt: timestamp,
    items: {},
    listDefinitions: {},
    areaDefinitions: {},
    projectDefinitions: {},
    organizationPreferences: {
      areaOrder: [null], projectOrder: [null], tagOrder: [null],
      priorityOrder: [{ kind: 'area', name: null }, { kind: 'project', name: null }, { kind: 'tag', name: null }],
    },
    customFields: {},
    views: {
      '__all_items__': {
        id: '__all_items__',
        name: 'All items',
        query: { source: activeQuery },
        renderer: 'list',
        sort: defaultSort.map((rule) => ({ ...rule })),
        sortSource: STANDARD_ATTENTION_VIEW_SORT_SOURCE,
        fields: [...defaultFields],
      },
      [todayId]: {
        id: todayId,
        name: 'Today',
        query: { source: `${activeQuery} && scheduleInPeriod("today", "event_open,event,active,due", true, 7, "", "") && activeRangeWhenSetOrOverdue == true` },
        renderer: 'list',
        sort: defaultSort.map((rule) => ({ ...rule })),
        sortSource: STANDARD_ATTENTION_VIEW_SORT_SOURCE,
        fields: [...defaultFields],
      },
      [weekId]: {
        id: weekId,
        name: 'This week',
        query: { source: `${activeQuery} && scheduleInPeriod("this_week", "event_open,event,active,due", true, 7, "", "") && activeRangeWhenSetOrOverdue == true` },
        renderer: 'list',
        sort: defaultSort.map((rule) => ({ ...rule })),
        sortSource: STANDARD_ATTENTION_VIEW_SORT_SOURCE,
        fields: [...defaultFields],
      },
    },
    viewOrder: [todayId, weekId, '__all_items__'],
    dashboards: {
      [dashboardId]: {
        id: dashboardId,
        name: 'Home',
        widgets: [
          { id: createId(), type: 'smart_list', title: 'Today', viewId: todayId, width: 2, order: 0 },
          { id: createId(), type: 'smart_list', title: 'This week', viewId: weekId, width: 2, order: 1 },
          { id: createId(), type: 'habit_summary', title: 'Habits', width: 1, order: 2 },
        ],
      },
    },
    automations: {},
    automationLog: [],
    migrationIssues: [],
    tombstones: {},
    calendarPreferences: {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      lastMode: 'month', weekStartsOn: 1, workingHours: { start: '08:00', end: '22:00' }, sleepSchedule: { wake: '08:00', sleep: '22:00' },
      weekends: true, snapMinutes: 15, defaultDurationMinutes: 30, timeFormat: '24h', language: 'en', appearance: { mode: 'system', lightAt: '07:00', darkAt: '20:00', tickSound: true, uiSound: true, overdueAgeIndicator: true, soundDefaultsVersion: 1 },
      dayView: {
        filter: { source: 'state == "open" || state == "done"' },
        scheduleSources: ['event_open', 'event', 'active', 'due'],
        fields: [...defaultFields, 'schedule.estimatedDuration', 'external.provider'],
        sort: [
          { expression: 'schedule.startAt', direction: 'asc', nulls: 'first' },
          { expression: 'schedule.dueAt', direction: 'asc', nulls: 'first' },
        ],
        sortSource: 'schedule.startAt asc nulls first\nschedule.dueAt asc nulls first',
      },
      diagnosticsEnabled: true,
      showExplanations: false,
      testClock: { enabled: false, secondsPerDay: 86_400, dayDurationValue: 24, dayDurationUnit: 'hours', startedAt: now.toISOString(), virtualAt: now.toISOString() },
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
    areas: [],
    projects: [],
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
