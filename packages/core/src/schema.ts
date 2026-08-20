import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { APP_ID, APP_NAME, APP_VERSION, SCHEMA_VERSION } from './types.js';
import type { PortablePackage, SavedView, UniversalItem, WorkspaceDocument } from './types.js';

const scalar = { type: ['string', 'number', 'boolean', 'null'] } as const;
const stringArray = { type: 'array', items: { type: 'string' } } as const;
const extensions = { type: 'object', additionalProperties: true } as const;

export const itemJsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://universal-task-manager.dev/schema/item-1.6.0.json',
  title: 'Universal Task Manager item',
  type: 'object',
  additionalProperties: false,
  required: [
    'id', 'schemaVersion', 'createdWithAppId', 'createdWithAppName', 'createdWithVersion', 'revision', 'role', 'preset',
    'title', 'bodyMarkdown', 'state', 'createdAt', 'updatedAt', 'contexts', 'tags', 'reminders', 'relations', 'attachments', 'custom',
  ],
  properties: {
    id: { type: 'string', minLength: 1 },
    schemaVersion: { const: SCHEMA_VERSION },
    createdWithAppId: { type: 'string', minLength: 1 },
    createdWithAppName: { type: 'string', minLength: 1 },
    createdWithVersion: { type: 'string', minLength: 1 },
    revision: { type: 'integer', minimum: 1 },
    role: { enum: ['standalone', 'series_template', 'occurrence'] },
    preset: { enum: ['task', 'event', 'habit', 'blank'] },
    title: { type: 'string' }, bodyMarkdown: { type: 'string' },
    state: { enum: ['open', 'done', 'cancelled', 'auto_closed', 'archived'] },
    createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
    deletedAt: { type: 'string', format: 'date-time' },
    closure: {
      type: 'object', additionalProperties: false, required: ['at', 'actor', 'reason'],
      properties: {
        at: { type: 'string', format: 'date-time' }, actor: { enum: ['user', 'system', 'automation', 'import'] },
        reason: { enum: ['manual', 'auto_renew', 'rule', 'cancelled', 'import'] }, automationId: { type: 'string' },
      },
    },
    schedule: {
      type: 'object', additionalProperties: false, required: ['timezone'],
      properties: {
        timezone: { type: 'string', minLength: 1 }, allDay: { type: 'boolean' },
        availableFrom: { type: 'string', format: 'date-time' }, startAt: { type: 'string', format: 'date-time' },
        endAt: { type: 'string', format: 'date-time' }, dueAt: { type: 'string', format: 'date-time' },
        estimatedDuration: { type: 'string' }, actualDuration: { type: 'string' },
      },
    },
    recurrence: {
      type: 'object', additionalProperties: false,
      required: ['rrule', 'rdates', 'exdates', 'timezone', 'closeAt', 'anchor', 'autoRenew'],
      properties: {
        rrule: { type: 'string', minLength: 1 }, rdates: stringArray, exdates: stringArray,
        timezone: { type: 'string', minLength: 1 }, activationOffset: { type: 'string' }, dueOffset: { type: 'string' },
        closeAt: { enum: ['next_activation', 'due', 'never'] }, anchor: { enum: ['schedule', 'completion'] }, autoRenew: { type: 'boolean' },
      },
    },
    occurrence: {
      type: 'object', additionalProperties: false, required: ['seriesId', 'recurrenceId', 'sequence', 'templateRevision'],
      properties: {
        seriesId: { type: 'string', minLength: 1 }, recurrenceId: { type: 'string', format: 'date-time' },
        sequence: { type: 'integer', minimum: 0 }, templateRevision: { type: 'integer', minimum: 1 },
      },
    },
    recurrenceOverride: {
      type: 'object', additionalProperties: false, required: ['kind', 'sourceSeriesId', 'recurrenceId'],
      properties: { kind: { enum: ['this_occurrence', 'future_split'] }, sourceSeriesId: { type: 'string' }, recurrenceId: { type: 'string', format: 'date-time' } },
    },
    progress: {
      type: 'object', additionalProperties: false, required: ['mode', 'current', 'target'],
      properties: { mode: { enum: ['boolean', 'percent', 'counter'] }, current: { type: 'number' }, target: { type: 'number' }, unit: { type: 'string' } },
    },
    habit: {
      type: 'object', additionalProperties: false, required: ['target', 'unit', 'streakMode', 'completedDates'],
      properties: { target: { type: 'number' }, unit: { type: 'string' }, streakMode: { enum: ['manual_only', 'any_closed'] }, completedDates: { type: 'array', uniqueItems: true, items: { type: 'string', format: 'date' } } },
    },
    priority: { type: 'integer', minimum: 0, maximum: 4 }, contexts: stringArray, tags: stringArray,
    reminders: {
      type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['id', 'mode', 'urgency', 'repeatUntilAcknowledged'],
        properties: {
          id: { type: 'string', minLength: 1 }, mode: { enum: ['absolute', 'relative'] }, at: { type: 'string', format: 'date-time' },
          relativeTo: { enum: ['available', 'start', 'due', 'end'] }, offset: { type: 'string' }, urgency: { enum: ['normal', 'urgent', 'critical'] },
          repeatEvery: { type: 'string' }, repeatUntilAcknowledged: { type: 'boolean' }, acknowledgedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
    relations: {
      type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['id', 'targetId', 'type'],
        properties: { id: { type: 'string' }, targetId: { type: 'string' }, type: { enum: ['parent', 'blocks', 'blocked_by', 'related', 'duplicate', 'custom'] }, label: { type: 'string' } },
      },
    },
    attachments: {
      type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['id', 'url'],
        properties: { id: { type: 'string' }, url: { type: 'string' }, title: { type: 'string' }, mimeType: { type: 'string' } },
      },
    },
    custom: { type: 'object', additionalProperties: { anyOf: [scalar, { type: 'array', items: scalar }] } },
    extensions,
  },
  allOf: [
    { if: { properties: { role: { const: 'series_template' } } }, then: { required: ['schedule', 'recurrence'] } },
    { if: { properties: { role: { const: 'occurrence' } } }, then: { required: ['occurrence'] } },
  ],
} as const;

export const viewJsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://universal-task-manager.dev/schema/view-1.6.0.json',
  title: 'Universal Task Manager saved view', type: 'object', additionalProperties: false,
  required: ['id', 'name', 'query', 'renderer', 'sort', 'fields'],
  properties: {
    id: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 },
    query: { type: 'object', additionalProperties: false, required: ['source'], properties: { source: { type: 'string' }, ast: { type: 'object', additionalProperties: true } } },
    renderer: { enum: ['list', 'table', 'calendar', 'board'] },
    sort: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['field', 'direction'], properties: { field: { type: 'string' }, direction: { enum: ['asc', 'desc'] }, nulls: { enum: ['first', 'last'] } } } },
    sortSource: { type: 'string' }, groupBy: { type: 'string' }, fields: stringArray, extensions,
  },
} as const;

const customFieldSchema = {
  type: 'object', additionalProperties: false, required: ['id', 'key', 'label', 'kind', 'required'],
  properties: {
    id: { type: 'string' }, key: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' }, label: { type: 'string' },
    kind: { enum: ['text', 'number', 'boolean', 'date', 'datetime', 'duration', 'enum', 'multi_enum', 'url', 'item_ref', 'formula'] },
    required: { type: 'boolean' }, options: stringArray, formula: { type: 'string' },
    formulaResult: { enum: ['text', 'number', 'boolean', 'date', 'datetime', 'duration', 'enum', 'url', 'item_ref'] },
  },
} as const;

export const portablePackageJsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://universal-task-manager.dev/schema/portable-package-1.6.0.json',
  title: 'Universal Task Manager portable package', type: 'object', additionalProperties: false,
  required: ['format', 'formatVersion', 'kind', 'schemaVersion', 'exportedAt', 'source', 'customFields', 'items', 'views', 'dependencyItemIds'],
  properties: {
    format: { const: 'utm-portable' }, formatVersion: { const: 1 }, kind: { enum: ['items', 'views', 'view_bundle'] },
    schemaVersion: { type: 'string' }, exportedAt: { type: 'string', format: 'date-time' },
    source: {
      type: 'object', additionalProperties: false, required: ['appId', 'appName', 'appVersion', 'workspaceId'],
      properties: { appId: { type: 'string' }, appName: { type: 'string' }, appVersion: { type: 'string' }, workspaceId: { type: 'string' } },
    },
    customFields: { type: 'object', additionalProperties: customFieldSchema },
    items: { type: 'array', items: itemJsonSchema }, views: { type: 'array', items: viewJsonSchema },
    selection: { type: 'object', additionalProperties: true, required: ['type'], properties: { type: { enum: ['single_item', 'view_results', 'all_items', 'view_definition'] } } },
    dependencyItemIds: stringArray, extensions,
  },
  allOf: [
    { if: { properties: { kind: { const: 'items' } } }, then: { properties: { views: { maxItems: 0 } } } },
    { if: { properties: { kind: { const: 'views' } } }, then: { properties: { items: { maxItems: 0 } } } },
  ],
} as const;

export const workspaceJsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://universal-task-manager.dev/schema/workspace-1.7.0.json',
  title: 'Universal Task Manager workspace', type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'workspaceId', 'name', 'createdAt', 'updatedAt', 'items', 'customFields', 'views', 'dashboards', 'automations', 'automationLog', 'tombstones', 'calendarPreferences', 'pushPreferences'],
  properties: {
    schemaVersion: { const: SCHEMA_VERSION }, workspaceId: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 },
    createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
    items: { type: 'object', additionalProperties: itemJsonSchema }, customFields: { type: 'object', additionalProperties: customFieldSchema },
    views: { type: 'object', additionalProperties: viewJsonSchema }, dashboards: { type: 'object' }, automations: { type: 'object' },
    automationLog: { type: 'array' }, tombstones: { type: 'object', additionalProperties: { type: 'string', format: 'date-time' } },
    calendarPreferences: {
      type: 'object', additionalProperties: false,
      required: ['timezone', 'lastMode', 'weekStartsOn', 'workingHours', 'sleepSchedule', 'weekends', 'snapMinutes', 'defaultDurationMinutes', 'timeFormat', 'language', 'appearance', 'includeStates'],
      properties: {
        timezone: { type: 'string' }, lastMode: { enum: ['month', 'week', 'day', 'three_day', 'agenda'] }, weekStartsOn: { enum: [0, 1] },
        workingHours: { type: 'object', additionalProperties: false, required: ['start', 'end'], properties: { start: { type: 'string' }, end: { type: 'string' } } },
        sleepSchedule: { type: 'object', additionalProperties: false, required: ['wake', 'sleep'], properties: { wake: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }, sleep: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' } } },
        weekends: { type: 'boolean' }, snapMinutes: { type: 'integer', minimum: 1 }, defaultDurationMinutes: { type: 'integer', minimum: 1 },
        timeFormat: { const: '24h' }, language: { enum: ['en', 'ru', 'es', 'de', 'fr', 'ko'] }, selectedViewId: { type: 'string' },
        appearance: { type: 'object', additionalProperties: false, required: ['mode', 'lightAt', 'darkAt', 'tickSound'], properties: { mode: { enum: ['system', 'light', 'dark', 'scheduled'] }, lightAt: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }, darkAt: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }, tickSound: { type: 'boolean' } } },
        includeStates: { type: 'array', items: { enum: ['open', 'done', 'cancelled', 'auto_closed', 'archived'] } },
      },
    },
    pushPreferences: {
      type: 'object', additionalProperties: false, required: ['enabled', 'contentMode'],
      properties: {
        enabled: { type: 'boolean' }, serviceUrl: { type: 'string', format: 'uri' },
        deviceId: { type: 'string', minLength: 1 }, deviceSecret: { type: 'string', minLength: 16 },
        contentMode: { enum: ['generic', 'detailed'] }, lastSyncedAt: { type: 'string', format: 'date-time' }, lastError: { type: 'string' },
      },
    },
  },
} as const;

export interface ValidationResult { valid: boolean; errors: string[] }

function compileSchema(schema: object): ValidateFunction {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
}
const validators = {
  workspace: compileSchema(workspaceJsonSchema), item: compileSchema(itemJsonSchema),
  view: compileSchema(viewJsonSchema), portable: compileSchema(portablePackageJsonSchema),
};

function validationResult(validator: ValidateFunction, value: unknown): ValidationResult {
  const valid = validator(value);
  const errors = valid ? [] : (validator.errors ?? []).map((error: ErrorObject) => `${error.instancePath || '$'} ${error.message ?? 'is invalid'}`);
  return { valid: Boolean(valid), errors };
}

export const validateItem = (value: unknown): ValidationResult => validationResult(validators.item, value);
export const validateView = (value: unknown): ValidationResult => validationResult(validators.view, value);
export const validatePortablePackage = (value: unknown): ValidationResult => validationResult(validators.portable, value);

export function validateWorkspace(value: unknown): ValidationResult {
  const result = validationResult(validators.workspace, value);
  if (!result.valid || !value || typeof value !== 'object') return result;
  const doc = value as WorkspaceDocument;
  for (const [key, item] of Object.entries(doc.items)) {
    if (item.id !== key) result.errors.push(`items.${key}.id must match its map key`);
    if (item.role === 'series_template' && (!item.recurrence || !item.schedule?.startAt)) result.errors.push(`items.${key} recurring template requires recurrence and schedule.startAt`);
  }
  result.valid = result.errors.length === 0;
  return result;
}

const itemKeys = new Set(Object.keys(itemJsonSchema.properties));
const viewKeys = new Set(Object.keys(viewJsonSchema.properties));

function preserveUnknown(record: Record<string, unknown>, allowed: Set<string>, namespace: string): string[] {
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  if (!unknown.length) return [];
  const target = (record.extensions && typeof record.extensions === 'object' && !Array.isArray(record.extensions) ? record.extensions : {}) as Record<string, unknown>;
  target[namespace] = Object.fromEntries(unknown.map((key) => [key, record[key]]));
  record.extensions = target;
  unknown.forEach((key) => { delete record[key]; });
  return unknown;
}

export interface MigrationResult<T> { value: T; warnings: string[] }

export function migrateItem(value: unknown, namespace = 'import:unknown'): MigrationResult<UniversalItem> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Item must be a JSON object');
  const item = structuredClone(value) as Record<string, unknown>;
  const warnings = preserveUnknown(item, itemKeys, namespace).map((key) => `Moved unknown item field ${key} to extensions.${namespace}`);
  item.schemaVersion = SCHEMA_VERSION;
  item.createdWithAppId ??= APP_ID; item.createdWithAppName ??= APP_NAME; item.createdWithVersion ??= APP_VERSION;
  item.revision ??= 1; item.bodyMarkdown ??= ''; item.contexts ??= []; item.tags ??= []; item.reminders ??= []; item.relations ??= []; item.attachments ??= []; item.custom ??= {};
  if (item.preset === 'habit') {
    item.habit ??= { target: 1, unit: 'times', streakMode: 'manual_only', completedDates: [] };
  }
  // Older workspaces could enable habit tracking on any preset. Backfill the
  // history field before strict validation regardless of the item's preset.
  if (item.habit && typeof item.habit === 'object' && !Array.isArray(item.habit)) (item.habit as Record<string, unknown>).completedDates ??= [];
  const validation = validateItem(item);
  if (!validation.valid) throw new Error(validation.errors.join('; '));
  return { value: item as unknown as UniversalItem, warnings };
}

export function migrateView(value: unknown, namespace = 'import:unknown'): MigrationResult<SavedView> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('View must be a JSON object');
  const view = structuredClone(value) as Record<string, unknown>;
  const warnings = preserveUnknown(view, viewKeys, namespace).map((key) => `Moved unknown view field ${key} to extensions.${namespace}`);
  view.query ??= { source: '' }; view.sort ??= []; view.fields ??= [];
  const validation = validateView(view);
  if (!validation.valid) throw new Error(validation.errors.join('; '));
  return { value: view as unknown as SavedView, warnings };
}

export function migrateWorkspace(value: unknown): MigrationResult<WorkspaceDocument> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Workspace must be a JSON object');
  const source = structuredClone(value) as Record<string, unknown>;
  const previous = String(source.schemaVersion ?? '1.0.0');
  if (!source.items || typeof source.items !== 'object' || Array.isArray(source.items)) throw new Error('items must be an object');
  if (!source.views || typeof source.views !== 'object' || Array.isArray(source.views)) throw new Error('views must be an object');
  const warnings: string[] = [];
  source.items = Object.fromEntries(Object.entries(source.items as Record<string, unknown>).map(([key, item]) => {
    const migrated = migrateItem(item, `schema:${previous}`); warnings.push(...migrated.warnings); return [key, migrated.value];
  }));
  source.views = Object.fromEntries(Object.entries(source.views as Record<string, unknown>).map(([key, view]) => {
    const migrated = migrateView(view, `schema:${previous}`); warnings.push(...migrated.warnings); return [key, migrated.value];
  }));
  source.schemaVersion = SCHEMA_VERSION;
  source.customFields ??= {}; source.dashboards ??= {}; source.automations ??= {}; source.automationLog ??= []; source.tombstones ??= {};
  source.pushPreferences ??= { enabled: false, contentMode: 'generic' };
  const pushPreferences = source.pushPreferences as Record<string, unknown>;
  pushPreferences.enabled = pushPreferences.enabled === true;
  pushPreferences.contentMode = pushPreferences.contentMode === 'detailed' ? 'detailed' : 'generic';
  source.calendarPreferences ??= {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    lastMode: 'month', weekStartsOn: 1, workingHours: { start: '08:00', end: '22:00' }, weekends: true,
    sleepSchedule: { wake: '08:00', sleep: '22:00' }, snapMinutes: 15, defaultDurationMinutes: 30, timeFormat: '24h', language: 'en', appearance: { mode: 'system', lightAt: '07:00', darkAt: '20:00', tickSound: false }, includeStates: ['open', 'done'],
  };
  const calendarPreferences = source.calendarPreferences as Record<string, unknown>;
  const legacyWorkingHours = calendarPreferences.workingHours as { start?: string; end?: string } | undefined;
  calendarPreferences.sleepSchedule ??= { wake: legacyWorkingHours?.start ?? '08:00', sleep: legacyWorkingHours?.end ?? '22:00' };
  if (!['en', 'ru', 'es', 'de', 'fr', 'ko'].includes(String(calendarPreferences.language))) calendarPreferences.language = 'en';
  calendarPreferences.appearance ??= { mode: 'system', lightAt: '07:00', darkAt: '20:00', tickSound: false };
  const appearance = calendarPreferences.appearance as Record<string, unknown>;
  if (!['system', 'light', 'dark', 'scheduled'].includes(String(appearance.mode))) appearance.mode = 'system';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(appearance.lightAt))) appearance.lightAt = '07:00';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(appearance.darkAt))) appearance.darkAt = '20:00';
  appearance.tickSound = appearance.tickSound === true;
  const validation = validateWorkspace(source);
  if (!validation.valid) throw new Error(validation.errors.join('; '));
  if (previous !== SCHEMA_VERSION) warnings.unshift(`Migrated workspace schema ${previous} to ${SCHEMA_VERSION}`);
  return { value: source as unknown as WorkspaceDocument, warnings };
}

export function isPortablePackage(value: unknown): value is PortablePackage {
  return validatePortablePackage(value).valid;
}
