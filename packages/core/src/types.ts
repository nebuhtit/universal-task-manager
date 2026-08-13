export const SCHEMA_VERSION = '1.0.0';
export const APP_ID = 'dev.universal-task-manager';
export const APP_NAME = 'Universal Task Manager';
export const APP_VERSION = '0.3.2';
export const APP_RELEASED_AT = '2026-08-13T11:24:00+03:00';
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
  progress?: Progress;
  habit?: Habit;
  priority?: 0 | 1 | 2 | 3 | 4;
  contexts: string[];
  tags: string[];
  reminders: Reminder[];
  relations: ItemRelation[];
  attachments: LinkAttachment[];
  custom: Record<string, CustomValue>;
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

export interface SavedView {
  id: string;
  name: string;
  query: QuerySpec;
  renderer: 'list' | 'table' | 'calendar' | 'board';
  sort: Array<{ field: string; direction: 'asc' | 'desc' }>;
  groupBy?: string;
  fields: string[];
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
  autoClosed: UniversalItem[];
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
      [inboxId]: {
        id: inboxId,
        name: 'Now',
        query: { source: 'state == "open" && role != "series_template"' },
        renderer: 'list',
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
    item.habit = { target: 1, unit: 'times', streakMode: 'manual_only' };
  }
  return item;
}
