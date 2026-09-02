import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { ACTIVE_ITEM_VIEW_QUERY, APP_ID, APP_NAME, APP_VERSION, LEGACY_ACTIVE_ITEM_VIEW_QUERY, LEGACY_STANDARD_VIEW_SORT_SOURCE, SCHEMA_VERSION, STANDARD_ATTENTION_VIEW_SORT_SOURCE, standardAttentionViewSort } from './types.js';
import { normalizedOrganizationPriorityOrder } from './organization.js';
import { parseSortSource, serializeSortRules } from './dsl.js';
import type { PortablePackage, SavedView, UniversalItem, ViewSortRule, WorkspaceDocument } from './types.js';

const scalar = { type: ['string', 'number', 'boolean', 'null'] } as const;
const stringArray = { type: 'array', items: { type: 'string' } } as const;
const extensions = { type: 'object', additionalProperties: true } as const;
const scriptFieldSchema = {
  type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['id', 'key', 'label', 'source', 'resultKind'],
    properties: {
      id: { type: 'string', minLength: 1 }, key: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
      label: { type: 'string', minLength: 1 }, source: { type: 'string', minLength: 1 },
      resultKind: { enum: ['text', 'number', 'boolean', 'datetime', 'duration'] },
    },
  },
} as const;

export const itemJsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://universal-task-manager.dev/schema/item-1.22.0.json',
  title: 'Universal Task Manager item',
  type: 'object',
  additionalProperties: false,
  required: [
    'id', 'schemaVersion', 'createdWithAppId', 'createdWithAppName', 'createdWithVersion', 'revision', 'role', 'preset',
    'title', 'bodyMarkdown', 'state', 'createdAt', 'updatedAt', 'contexts', 'tags', 'areas', 'projects', 'reminders', 'relations', 'attachments', 'custom',
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
    title: { type: 'string' }, bodyMarkdown: { type: 'string' }, location: { type: 'string' },
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
    cycleHistory: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['recurrenceId', 'closedAt', 'state', 'actor', 'reason'],
        properties: {
          recurrenceId: { type: 'string', format: 'date-time' },
          availableFrom: { type: 'string', format: 'date-time' }, startAt: { type: 'string', format: 'date-time' },
          endAt: { type: 'string', format: 'date-time' }, dueAt: { type: 'string', format: 'date-time' },
          closedAt: { type: 'string', format: 'date-time' }, state: { enum: ['done', 'cancelled', 'auto_closed'] },
          actor: { enum: ['user', 'system', 'automation', 'import'] }, reason: { enum: ['manual', 'auto_renew', 'rule', 'cancelled', 'import'] },
        },
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
      properties: {
        target: { type: 'number' }, unit: { type: 'string' }, streakMode: { enum: ['manual_only', 'any_closed'] }, completedDates: { type: 'array', uniqueItems: true, items: { type: 'string', format: 'date' } },
        activeTimerStartedAt: { type: 'string', format: 'date-time' },
        timerSessions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'startedAt', 'endedAt', 'durationSeconds'], properties: { id: { type: 'string', minLength: 1 }, startedAt: { type: 'string', format: 'date-time' }, endedAt: { type: 'string', format: 'date-time' }, durationSeconds: { type: 'number', minimum: 0 } } } },
      },
    },
    priority: { type: 'integer', minimum: 0, maximum: 4 },
    list: { type: 'string', minLength: 1 }, areas: stringArray, projects: stringArray,
    area: { type: 'string', minLength: 1 }, project: { type: 'string', minLength: 1 },
    contexts: stringArray, tags: stringArray,
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
    external: {
      type: 'object', additionalProperties: false,
      required: ['provider', 'connectionId', 'calendarId', 'eventId', 'sourceUrl', 'readOnly', 'syncedAt'],
      properties: {
        provider: { const: 'google_calendar' }, connectionId: { type: 'string', minLength: 1 },
        calendarId: { type: 'string', minLength: 1 }, eventId: { type: 'string', minLength: 1 },
        sourceUrl: { type: 'string', format: 'uri' }, readOnly: { const: true }, transparency: { enum: ['opaque', 'transparent'] }, etag: { type: 'string' },
        syncedAt: { type: 'string', format: 'date-time' },
      },
    },
    custom: { type: 'object', additionalProperties: { anyOf: [scalar, { type: 'array', items: scalar }] } },
    scripts: scriptFieldSchema,
    extensions,
  },
  allOf: [
    { if: { properties: { role: { const: 'series_template' } } }, then: { required: ['schedule', 'recurrence'] } },
    { if: { properties: { role: { const: 'occurrence' } } }, then: { required: ['occurrence'] } },
  ],
} as const;

export const viewJsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://universal-task-manager.dev/schema/view-1.22.0.json',
  title: 'Universal Task Manager saved view', type: 'object', additionalProperties: false,
  required: ['id', 'name', 'query', 'renderer', 'sort', 'fields'],
  properties: {
    id: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 }, accent: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
    query: { type: 'object', additionalProperties: false, required: ['source'], properties: { source: { type: 'string' }, ast: { type: 'object', additionalProperties: true } } },
    renderer: { enum: ['list', 'table', 'calendar', 'board'] },
    sort: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['field', 'direction'], properties: { field: { type: 'string' }, direction: { enum: ['asc', 'desc'] }, nulls: { enum: ['first', 'last'] } } } },
    sortSource: { type: 'string' }, groupBy: { type: 'string' }, fields: stringArray,
    list: { type: 'string', minLength: 1 }, area: { type: 'string', minLength: 1 }, project: { type: 'string', minLength: 1 },
    creationDefaults: { type: 'object', additionalProperties: true },
    statistics: {
      type: 'object', additionalProperties: false, required: ['showTime', 'reservedItemIds'],
      properties: { showTime: { type: 'boolean' }, reservedItemIds: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true } },
    },
    scripts: scriptFieldSchema,
    extensions,
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

const listDefinitionSchema = {
  type: 'object', additionalProperties: false, required: ['name', 'kind', 'priority', 'createdAt', 'updatedAt'],
  properties: {
    name: { type: 'string', minLength: 1 }, kind: { enum: ['list', 'project', 'area', 'resource', 'archive'] },
    priority: { type: 'integer', minimum: 0, maximum: 4 },
    createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

const areaDefinitionSchema = {
  type: 'object', additionalProperties: false, required: ['name', 'createdAt', 'updatedAt'],
  properties: {
    name: { type: 'string', minLength: 1 }, accent: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, priority: { type: 'integer', minimum: 0, maximum: 4 },
    order: { type: 'number', minimum: 0 }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

const projectDefinitionSchema = {
  ...areaDefinitionSchema,
  required: [...areaDefinitionSchema.required, 'areas'],
  properties: { ...areaDefinitionSchema.properties, areas: stringArray, accent: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, area: { type: 'string', minLength: 1 } },
} as const;

const organizationPriorityEntrySchema = {
  type: 'object', additionalProperties: false, required: ['kind', 'name'],
  properties: { kind: { enum: ['area', 'project', 'tag'] }, name: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] }, area: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] } },
} as const;

export const portablePackageJsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://universal-task-manager.dev/schema/portable-package-1.22.0.json',
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
    areaDefinitions: { type: 'object', additionalProperties: areaDefinitionSchema },
    projectDefinitions: { type: 'object', additionalProperties: projectDefinitionSchema },
    organizationPreferences: {
      type: 'object', additionalProperties: false,
      required: ['areaOrder', 'projectOrder', 'tagOrder', 'priorityOrder'],
      properties: {
        areaOrder: { type: 'array', items: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] } },
        projectOrder: { type: 'array', items: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] } },
        tagOrder: { type: 'array', items: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] } },
        tagAccents: { type: 'object', additionalProperties: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } },
        priorityOrder: { type: 'array', items: organizationPriorityEntrySchema },
      },
    },
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
  $id: 'https://universal-task-manager.dev/schema/workspace-1.22.0.json',
  title: 'Universal Task Manager workspace', type: 'object', additionalProperties: false,
  // `viewOrder` was added after the schema version had already shipped. Keep it
  // optional at the validation boundary so an otherwise valid older workspace
  // can still open and be exported; migration supplies the stable order on save.
  required: ['schemaVersion', 'workspaceId', 'name', 'createdAt', 'updatedAt', 'items', 'listDefinitions', 'areaDefinitions', 'projectDefinitions', 'organizationPreferences', 'customFields', 'views', 'dashboards', 'automations', 'automationLog', 'migrationIssues', 'tombstones', 'calendarPreferences', 'pushPreferences'],
  properties: {
    schemaVersion: { const: SCHEMA_VERSION }, workspaceId: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 },
    createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
    items: { type: 'object', additionalProperties: itemJsonSchema },
    listDefinitions: { type: 'object', additionalProperties: listDefinitionSchema },
    areaDefinitions: { type: 'object', additionalProperties: areaDefinitionSchema },
    projectDefinitions: { type: 'object', additionalProperties: projectDefinitionSchema },
    organizationPreferences: {
      type: 'object', additionalProperties: false,
      required: ['areaOrder', 'projectOrder', 'tagOrder', 'priorityOrder'],
      properties: {
        areaOrder: { type: 'array', items: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] } },
        projectOrder: { type: 'array', items: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] } },
        tagOrder: { type: 'array', items: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] } },
        tagAccents: { type: 'object', additionalProperties: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } },
        priorityOrder: { type: 'array', items: organizationPriorityEntrySchema },
      },
    },
    customFields: { type: 'object', additionalProperties: customFieldSchema },
    views: { type: 'object', additionalProperties: viewJsonSchema }, viewOrder: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true }, dashboards: { type: 'object' }, automations: { type: 'object' },
    automationLog: { type: 'array' },
    migrationIssues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'entityType', 'entityId', 'sourceVersion', 'code', 'disabledCapability', 'status', 'detectedAt'], properties: { id: { type: 'string', minLength: 1 }, entityType: { enum: ['workspace', 'item', 'view', 'automation'] }, entityId: { type: 'string', minLength: 1 }, sourceVersion: { type: 'string', minLength: 1 }, code: { type: 'string', minLength: 1 }, disabledCapability: { enum: ['recurrence', 'script', 'filter', 'automation', 'reminder', 'entity'] }, status: { enum: ['needs_repair', 'resolved'] }, detectedAt: { type: 'string', format: 'date-time' } } } },
    tombstones: { type: 'object', additionalProperties: { type: 'string', format: 'date-time' } },
    calendarPreferences: {
      type: 'object', additionalProperties: false,
      required: ['timezone', 'lastMode', 'weekStartsOn', 'workingHours', 'sleepSchedule', 'weekends', 'snapMinutes', 'defaultDurationMinutes', 'timeFormat', 'language', 'appearance', 'dayView', 'diagnosticsEnabled', 'showExplanations'],
      properties: {
        timezone: { type: 'string' }, lastMode: { enum: ['month', 'week', 'day', 'three_day', 'agenda'] }, weekStartsOn: { enum: [0, 1] },
        workingHours: { type: 'object', additionalProperties: false, required: ['start', 'end'], properties: { start: { type: 'string' }, end: { type: 'string' } } },
        sleepSchedule: { type: 'object', additionalProperties: false, required: ['wake', 'sleep'], properties: { wake: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }, sleep: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' } } },
        weekends: { type: 'boolean' }, snapMinutes: { type: 'integer', minimum: 1 }, defaultDurationMinutes: { type: 'integer', minimum: 1 },
        timeFormat: { const: '24h' }, language: { enum: ['en', 'ru', 'es', 'de', 'fr', 'ko'] },
        appearance: { type: 'object', additionalProperties: false, required: ['mode', 'lightAt', 'darkAt', 'tickSound', 'uiSound'], properties: { mode: { enum: ['system', 'light', 'dark', 'scheduled'] }, lightAt: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }, darkAt: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }, tickSound: { type: 'boolean' }, uiSound: { type: 'boolean' }, soundDefaultsVersion: { const: 1 } } },
        dayView: {
          type: 'object', additionalProperties: false, required: ['filter', 'scheduleSources', 'fields', 'sort'],
          properties: {
            filter: { type: 'object', additionalProperties: false, required: ['source'], properties: { source: { type: 'string' } } },
            scheduleSources: { type: 'array', minItems: 1, uniqueItems: true, items: { enum: ['event_open', 'event', 'active', 'due'] } },
            fields: stringArray,
            sort: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['expression', 'direction', 'nulls'], properties: { expression: { type: 'string' }, direction: { enum: ['asc', 'desc'] }, nulls: { enum: ['first', 'last'] } } } },
            sortSource: { type: 'string' },
          },
        },
        diagnosticsEnabled: { type: 'boolean' },
        showExplanations: { type: 'boolean' },
        testClock: { type: 'object', additionalProperties: false, required: ['enabled', 'secondsPerDay', 'startedAt', 'virtualAt'], properties: { enabled: { type: 'boolean' }, secondsPerDay: { type: 'number', exclusiveMinimum: 0 }, dayDurationValue: { type: 'number', exclusiveMinimum: 0 }, dayDurationUnit: { enum: ['seconds', 'minutes', 'hours'] }, startedAt: { type: 'string', format: 'date-time' }, virtualAt: { type: 'string', format: 'date-time' } } },
        backupPreferences: { type: 'object', additionalProperties: false, required: ['reminderDays'], properties: { reminderDays: { type: 'integer', minimum: 0 }, lastBackupAt: { type: 'string', format: 'date-time' }, locationLabel: { type: 'string' } } },
        googleCalendar: {
          type: 'object', additionalProperties: false, required: ['connectionId', 'calendars', 'syncTokens'],
          properties: {
            connectionId: { type: 'string', minLength: 1 }, accountEmail: { type: 'string' },
            calendars: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'name', 'selected'], properties: { id: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 }, primary: { type: 'boolean' }, selected: { type: 'boolean' } } } },
            syncTokens: { type: 'object', additionalProperties: { type: 'string', minLength: 1 } },
            syncWindow: { type: 'object', additionalProperties: false, required: ['timeMin', 'timeMax', 'refreshedAt'], properties: { timeMin: { type: 'string', format: 'date-time' }, timeMax: { type: 'string', format: 'date-time' }, refreshedAt: { type: 'string', format: 'date-time' } } },
            lastSyncedAt: { type: 'string', format: 'date-time' }, lastError: { type: 'string' },
          },
        },
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

/** Paths that can safely be copied into a brand-new item from a saved view. */
export const creationDefaultPaths = new Set([
  'title', 'bodyMarkdown', 'location', 'state', 'priority', 'tags', 'contexts', 'list', 'area', 'project',
  'schedule.availableFrom', 'schedule.startAt', 'schedule.endAt', 'schedule.dueAt', 'schedule.estimatedDuration', 'schedule.timezone', 'schedule.allDay',
  'recurrence.rrule', 'recurrence.rdates', 'recurrence.exdates', 'recurrence.timezone', 'recurrence.activationOffset', 'recurrence.dueOffset', 'recurrence.closeAt', 'recurrence.anchor', 'recurrence.autoRenew',
  'progress.mode', 'progress.current', 'progress.target', 'progress.unit',
  'habit.target', 'habit.unit', 'habit.streakMode', 'reminders', 'attachments',
]);

const isPlainObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isIsoLike = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const isDuration = (value: unknown) => typeof value === 'string' && /^-?P(?:\d+[YMWD])?(?:T(?:\d+[HMS])?)?$/.test(value);

/** Validates portable creation defaults without allowing identity, history or relation topology to leak into new items. */
export function validateViewCreationDefaults(value: unknown): ValidationResult {
  if (value === undefined) return { valid: true, errors: [] };
  if (!isPlainObject(value)) return { valid: false, errors: ['/creationDefaults must be an object'] };
  const errors: string[] = [];
  for (const [path, entry] of Object.entries(value)) {
    const allowed = creationDefaultPaths.has(path) || /^custom\.[a-z][a-z0-9_]*$/.test(path);
    if (!allowed) { errors.push(`/creationDefaults/${path} is not an editable default`); continue; }
    if (path === 'state' && !['open', 'done', 'auto_closed', 'cancelled', 'archived'].includes(String(entry))) errors.push(`/creationDefaults/${path} has an invalid state`);
    if (path === 'priority' && (typeof entry !== 'number' || !Number.isInteger(entry) || entry < 0 || entry > 4)) errors.push(`/creationDefaults/${path} must be an integer from 0 to 4`);
    if (['tags', 'contexts', 'recurrence.rdates', 'recurrence.exdates', 'reminders', 'attachments'].includes(path) && !Array.isArray(entry)) errors.push(`/creationDefaults/${path} must be an array`);
    if (['schedule.allDay', 'recurrence.autoRenew'].includes(path) && typeof entry !== 'boolean') errors.push(`/creationDefaults/${path} must be true or false`);
    if (['schedule.availableFrom', 'schedule.startAt', 'schedule.endAt', 'schedule.dueAt'].includes(path) && !isIsoLike(entry)) errors.push(`/creationDefaults/${path} must be a date-time`);
    if (['schedule.estimatedDuration', 'recurrence.activationOffset', 'recurrence.dueOffset'].includes(path) && !isDuration(entry)) errors.push(`/creationDefaults/${path} must be an ISO duration`);
  }
  return { valid: errors.length === 0, errors };
}
export const validatePortablePackage = (value: unknown): ValidationResult => validationResult(validators.portable, value);

export function validateWorkspace(value: unknown): ValidationResult {
  const result = validationResult(validators.workspace, value);
  if (!result.valid || !value || typeof value !== 'object') return result;
  const doc = value as WorkspaceDocument;
  for (const [key, item] of Object.entries(doc.items)) {
    if (item.id !== key) result.errors.push(`items.${key}.id must match its map key`);
    if (item.role === 'series_template' && (!item.recurrence || (!item.schedule?.startAt && !item.schedule?.dueAt))) result.errors.push(`items.${key} recurring template requires recurrence and schedule.startAt or schedule.dueAt`);
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
  if (item.location !== undefined && typeof item.location !== 'string') delete item.location;
  if (item.external !== undefined) {
    const raw = item.external;
    const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined;
    const valid = record?.provider === 'google_calendar' && typeof record.connectionId === 'string' && Boolean(record.connectionId)
      && typeof record.calendarId === 'string' && Boolean(record.calendarId) && typeof record.eventId === 'string' && Boolean(record.eventId)
      && typeof record.sourceUrl === 'string' && /^https?:\/\//.test(record.sourceUrl) && record.readOnly === true
      && typeof record.syncedAt === 'string' && Number.isFinite(Date.parse(record.syncedAt));
    if (!valid) {
      const target = (item.extensions && typeof item.extensions === 'object' && !Array.isArray(item.extensions) ? item.extensions : {}) as Record<string, unknown>;
      target.quarantine = { ...((target.quarantine && typeof target.quarantine === 'object' && !Array.isArray(target.quarantine)) ? target.quarantine as Record<string, unknown> : {}), external: structuredClone(raw) };
      item.extensions = target;
      delete item.external;
      warnings.push('Disabled invalid external calendar provenance');
    }
  }
  const stringValues = (value: unknown) => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean) : [];
  item.areas = [...new Set([...stringValues(item.areas), ...(typeof item.area === 'string' && item.area.trim() ? [item.area.trim()] : [])])];
  item.projects = [...new Set([...stringValues(item.projects), ...(typeof item.project === 'string' && item.project.trim() ? [item.project.trim()] : [])])];
  if (typeof item.area === 'string' && item.area.trim()) warnings.push('Migrated legacy item Area to areas');
  if (typeof item.project === 'string' && item.project.trim()) warnings.push('Migrated legacy item Project to projects');
  delete item.area; delete item.project;
  if (!item.list && item.extensions && typeof item.extensions === 'object' && !Array.isArray(item.extensions)) {
    for (const legacy of Object.values(item.extensions as Record<string, unknown>)) {
      if (legacy && typeof legacy === 'object' && !Array.isArray(legacy) && typeof (legacy as Record<string, unknown>).list === 'string') {
        item.list = (legacy as Record<string, unknown>).list;
        warnings.push('Restored legacy item list membership from extensions');
        break;
      }
    }
  }
  if (item.preset === 'habit') {
    item.habit ??= { target: 1, unit: 'times', streakMode: 'manual_only', completedDates: [] };
  }
  // Older workspaces could enable habit tracking on any preset. Backfill the
  // history field before strict validation regardless of the item's preset.
  if (item.habit && typeof item.habit === 'object' && !Array.isArray(item.habit)) {
    const habit = item.habit as Record<string, unknown>;
    habit.completedDates ??= [];
    if (Array.isArray(habit.timerSessions)) habit.timerSessions = habit.timerSessions.filter((session): session is Record<string, unknown> => {
      if (!session || typeof session !== 'object' || Array.isArray(session)) return false;
      const value = session as Record<string, unknown>;
      return typeof value.id === 'string' && Boolean(value.id) && typeof value.startedAt === 'string' && Number.isFinite(Date.parse(value.startedAt)) && typeof value.endedAt === 'string' && Number.isFinite(Date.parse(value.endedAt)) && Number.isFinite(Number(value.durationSeconds)) && Number(value.durationSeconds) >= 0;
    }).map((session) => ({ id: session.id, startedAt: session.startedAt, endedAt: session.endedAt, durationSeconds: Number(session.durationSeconds) }));
    else delete habit.timerSessions;
    if (typeof habit.activeTimerStartedAt !== 'string' || !Number.isFinite(Date.parse(habit.activeTimerStartedAt))) delete habit.activeTimerStartedAt;
  }
  if (item.role === 'series_template' && item.recurrence && (!item.schedule || typeof item.schedule !== 'object' || Array.isArray(item.schedule) || !(item.schedule as Record<string, unknown>).startAt && !(item.schedule as Record<string, unknown>).dueAt)) {
    const target = (item.extensions && typeof item.extensions === 'object' && !Array.isArray(item.extensions) ? item.extensions : {}) as Record<string, unknown>;
    target.quarantine = { ...((target.quarantine && typeof target.quarantine === 'object' && !Array.isArray(target.quarantine)) ? target.quarantine as Record<string, unknown> : {}), recurrence: structuredClone(item.recurrence) };
    item.extensions = target;
    delete item.recurrence;
    item.role = 'standalone';
    warnings.push('Disabled legacy recurrence without start or deadline');
  }
  const validation = validateItem(item);
  if (!validation.valid) throw new Error(validation.errors.join('; '));
  return { value: item as unknown as UniversalItem, warnings };
}

export function migrateView(value: unknown, namespace = 'import:unknown'): MigrationResult<SavedView> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('View must be a JSON object');
  const view = structuredClone(value) as Record<string, unknown>;
  const warnings = preserveUnknown(view, viewKeys, namespace).map((key) => `Moved unknown view field ${key} to extensions.${namespace}`);
  view.query ??= { source: '' }; view.sort ??= []; view.fields ??= [];
  if (view.scripts !== undefined) {
    const raw = structuredClone(view.scripts);
    const usedKeys = new Set<string>();
    const resultKinds = new Set(['text', 'number', 'boolean', 'datetime', 'duration']);
    const scripts = Array.isArray(view.scripts) ? view.scripts.flatMap((candidate) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
      const script = candidate as Record<string, unknown>;
      if (typeof script.id !== 'string' || !script.id || typeof script.key !== 'string' || !/^[a-z][a-z0-9_]*$/.test(script.key) || usedKeys.has(script.key)
        || typeof script.label !== 'string' || !script.label || typeof script.source !== 'string' || !script.source || typeof script.resultKind !== 'string' || !resultKinds.has(script.resultKind)) return [];
      usedKeys.add(script.key);
      return [{ id: script.id, key: script.key, label: script.label, source: script.source, resultKind: script.resultKind }];
    }) : [];
    const lossy = !Array.isArray(view.scripts) || scripts.length !== view.scripts.length || JSON.stringify(scripts) !== JSON.stringify(view.scripts);
    if (lossy) {
      const target = (view.extensions && typeof view.extensions === 'object' && !Array.isArray(view.extensions) ? view.extensions : {}) as Record<string, unknown>;
      target.quarantine = { ...((target.quarantine && typeof target.quarantine === 'object' && !Array.isArray(target.quarantine)) ? target.quarantine as Record<string, unknown> : {}), scriptsRaw: raw };
      view.extensions = target;
      warnings.push('Normalized view scripts and retained their raw value');
    }
    if (scripts.length) view.scripts = scripts;
    else delete view.scripts;
  }
  if (view.statistics !== undefined) {
    const raw = view.statistics;
    const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined;
    if (!record || typeof record.showTime !== 'boolean' || !Array.isArray(record.reservedItemIds)) {
      const target = (view.extensions && typeof view.extensions === 'object' && !Array.isArray(view.extensions) ? view.extensions : {}) as Record<string, unknown>;
      target.quarantine = { ...((target.quarantine && typeof target.quarantine === 'object' && !Array.isArray(target.quarantine)) ? target.quarantine as Record<string, unknown> : {}), statistics: structuredClone(raw) };
      view.extensions = target;
      delete view.statistics;
      warnings.push('Disabled invalid view statistics settings');
    } else {
      const reservedItemIds = [...new Set(record.reservedItemIds.filter((id): id is string => typeof id === 'string' && id.length > 0))];
      const lossy = reservedItemIds.length !== record.reservedItemIds.length || Object.keys(record).some((key) => key !== 'showTime' && key !== 'reservedItemIds');
      if (lossy) {
        const target = (view.extensions && typeof view.extensions === 'object' && !Array.isArray(view.extensions) ? view.extensions : {}) as Record<string, unknown>;
        target.quarantine = { ...((target.quarantine && typeof target.quarantine === 'object' && !Array.isArray(target.quarantine)) ? target.quarantine as Record<string, unknown> : {}), statisticsRaw: structuredClone(raw) };
        view.extensions = target;
        warnings.push('Normalized view statistics settings and retained their raw value');
      }
      view.statistics = {
        showTime: record.showTime,
        reservedItemIds,
      };
    }
  }
  if (!view.list && view.extensions && typeof view.extensions === 'object' && !Array.isArray(view.extensions)) {
    for (const legacy of Object.values(view.extensions as Record<string, unknown>)) {
      if (legacy && typeof legacy === 'object' && !Array.isArray(legacy) && typeof (legacy as Record<string, unknown>).list === 'string') {
        view.list = (legacy as Record<string, unknown>).list;
        warnings.push('Restored legacy view list selection from extensions');
        break;
      }
    }
  }
  const validation = validateView(view);
  if (!validation.valid) throw new Error(validation.errors.join('; '));
  const defaultsValidation = validateViewCreationDefaults(view.creationDefaults);
  if (!defaultsValidation.valid) throw new Error(defaultsValidation.errors.join('; '));
  return { value: view as unknown as SavedView, warnings };
}

export function migrateWorkspace(value: unknown): MigrationResult<WorkspaceDocument> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Workspace must be a JSON object');
  const source = structuredClone(value) as Record<string, unknown>;
  const previous = String(source.schemaVersion ?? '1.0.0');
  if (!source.items || typeof source.items !== 'object' || Array.isArray(source.items)) throw new Error('items must be an object');
  if (!source.views || typeof source.views !== 'object' || Array.isArray(source.views)) throw new Error('views must be an object');
  const warnings: string[] = [];
  const now = new Date().toISOString();
  const migrationIssues = Array.isArray(source.migrationIssues) ? source.migrationIssues.filter((issue) => issue && typeof issue === 'object' && !Array.isArray(issue)) as Array<Record<string, unknown>> : [];
  source.items = Object.fromEntries(Object.entries(source.items as Record<string, unknown>).map(([key, item]) => {
    const raw = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : undefined;
    const missingRecurrenceAnchor = raw?.role === 'series_template' && Boolean(raw.recurrence) && (!raw.schedule || typeof raw.schedule !== 'object' || Array.isArray(raw.schedule) || !(raw.schedule as Record<string, unknown>).startAt && !(raw.schedule as Record<string, unknown>).dueAt);
    try {
      const migrated = migrateItem(item, `schema:${previous}`); warnings.push(...migrated.warnings);
      if (missingRecurrenceAnchor && !migrationIssues.some((issue) => issue.entityId === key && issue.code === 'recurrence_missing_anchor' && issue.status !== 'resolved')) migrationIssues.push({ id: `migration:${previous}:${key}:recurrence_missing_anchor`, entityType: 'item', entityId: key, sourceVersion: previous, code: 'recurrence_missing_anchor', disabledCapability: 'recurrence', status: 'needs_repair', detectedAt: now });
      return [key, migrated.value];
    } catch (reason) {
      if (raw) {
        const salvage = structuredClone(raw);
        const disabled: Array<{ key: 'scripts' | 'reminders' | 'recurrence'; capability: 'script' | 'reminder' | 'recurrence' }> = [];
        for (const candidate of [{ key: 'scripts', capability: 'script' }, { key: 'reminders', capability: 'reminder' }, { key: 'recurrence', capability: 'recurrence' }] as const) if (Object.prototype.hasOwnProperty.call(salvage, candidate.key)) { disabled.push(candidate); delete salvage[candidate.key]; }
        if (disabled.some((entry) => entry.key === 'recurrence') && salvage.role === 'series_template') salvage.role = 'standalone';
        const target = (salvage.extensions && typeof salvage.extensions === 'object' && !Array.isArray(salvage.extensions) ? salvage.extensions : {}) as Record<string, unknown>;
        target.quarantine = { ...((target.quarantine && typeof target.quarantine === 'object' && !Array.isArray(target.quarantine)) ? target.quarantine as Record<string, unknown> : {}), ...Object.fromEntries(disabled.map((entry) => [entry.key, structuredClone(raw[entry.key])])) };
        salvage.extensions = target;
        try {
          const migrated = migrateItem(salvage, `schema:${previous}`); warnings.push(...migrated.warnings);
          disabled.forEach((entry) => migrationIssues.push({ id: `migration:${previous}:${key}:invalid_${entry.key}`, entityType: 'item', entityId: key, sourceVersion: previous, code: `invalid_${entry.key}`, disabledCapability: entry.capability, status: 'needs_repair', detectedAt: now }));
          warnings.push(`Disabled incompatible capabilities on item ${key}`);
          return [key, migrated.value];
        } catch { /* Fall back to a minimal readable item below. */ }
      }
      const timestamp = typeof raw?.createdAt === 'string' && Number.isFinite(Date.parse(raw.createdAt)) ? raw.createdAt : now;
      const safe: UniversalItem = { id: typeof raw?.id === 'string' && raw.id ? raw.id : key, schemaVersion: SCHEMA_VERSION, createdWithAppId: APP_ID, createdWithAppName: APP_NAME, createdWithVersion: APP_VERSION, revision: Math.max(1, Math.floor(Number(raw?.revision) || 1)), role: 'standalone', preset: ['task', 'event', 'habit', 'blank'].includes(String(raw?.preset)) ? raw!.preset as UniversalItem['preset'] : 'task', title: typeof raw?.title === 'string' ? raw.title : 'Recovered item', bodyMarkdown: typeof raw?.bodyMarkdown === 'string' ? raw.bodyMarkdown : '', state: ['open', 'done', 'cancelled', 'auto_closed', 'archived'].includes(String(raw?.state)) ? raw!.state as UniversalItem['state'] : 'open', createdAt: timestamp, updatedAt: typeof raw?.updatedAt === 'string' && Number.isFinite(Date.parse(raw.updatedAt)) ? raw.updatedAt : timestamp, contexts: [], tags: [], areas: [], projects: [], reminders: [], relations: [], attachments: [], custom: {}, extensions: { quarantine: { raw: structuredClone(item), migrationError: reason instanceof Error ? reason.message : String(reason) } } };
      migrationIssues.push({ id: `migration:${previous}:${key}:invalid_item`, entityType: 'item', entityId: key, sourceVersion: previous, code: 'invalid_item', disabledCapability: 'entity', status: 'needs_repair', detectedAt: now });
      warnings.push(`Quarantined invalid item ${key}`);
      return [key, safe];
    }
  }));
  const legacyTodayQuery = `${LEGACY_ACTIVE_ITEM_VIEW_QUERY} && dueTodayOrOverdue == true`;
  const legacyWeekQuery = `${LEGACY_ACTIVE_ITEM_VIEW_QUERY} && dueThisWeekOrOverdue == true`;
  const legacyCurrentTodayQuery = `${LEGACY_ACTIVE_ITEM_VIEW_QUERY} && (eventToday == true || dueTodayOrOverdue == true)`;
  const legacyCurrentWeekQuery = `${LEGACY_ACTIVE_ITEM_VIEW_QUERY} && (eventThisWeek == true || dueThisWeekOrOverdue == true)`;
  const legacyTomorrowQuery = `${LEGACY_ACTIVE_ITEM_VIEW_QUERY} && scheduleInPeriod("tomorrow", "event_open,active,due", false, 7, "", "")`;
  const todayQuery = `${ACTIVE_ITEM_VIEW_QUERY} && (eventToday == true || dueTodayOrOverdue == true)`;
  const weekQuery = `${ACTIVE_ITEM_VIEW_QUERY} && (eventThisWeek == true || dueThisWeekOrOverdue == true)`;
  const tomorrowQuery = `${ACTIVE_ITEM_VIEW_QUERY} && scheduleInPeriod("tomorrow", "event_open,active,due", false, 7, "", "")`;
  const starterFields = ['title', 'bodyMarkdown', 'schedule.startAt', 'schedule.dueAt', 'tags', 'area', 'project'];
  const legacyStarterFields = [
    ['title', 'schedule.dueAt', 'bodyMarkdown', 'list', 'tags'],
    ['title', 'schedule.startAt', 'schedule.endAt', 'bodyMarkdown', 'list', 'tags'],
  ];
  const hasLegacyStarterFields = (fields: string[]) => legacyStarterFields.some((legacy) => JSON.stringify(fields) === JSON.stringify(legacy));
  source.views = Object.fromEntries(Object.entries(source.views as Record<string, unknown>).map(([key, view]) => {
    try {
      const migrated = migrateView(view, `schema:${previous}`); warnings.push(...migrated.warnings);
      if (migrated.value.name === 'Today + overdue' && migrated.value.query.source === legacyTodayQuery) {
        migrated.value.name = 'Today'; migrated.value.query.source = todayQuery;
        migrated.value.fields = [...starterFields];
        migrated.value.sort = [{ field: 'schedule.startAt', direction: 'asc', nulls: 'last' }, { field: 'schedule.endAt', direction: 'asc', nulls: 'last' }];
      }
      if (migrated.value.name === 'This week + overdue' && migrated.value.query.source === legacyWeekQuery) {
        migrated.value.name = 'This week'; migrated.value.query.source = weekQuery;
        migrated.value.fields = [...starterFields];
        migrated.value.sort = [{ field: 'schedule.startAt', direction: 'asc', nulls: 'last' }, { field: 'schedule.endAt', direction: 'asc', nulls: 'last' }];
      }
      const source = migrated.value.query.source;
      if (key === '__all_items__' && source === LEGACY_ACTIVE_ITEM_VIEW_QUERY) migrated.value.query.source = ACTIVE_ITEM_VIEW_QUERY;
      else if (migrated.value.name === 'Today' && source === legacyCurrentTodayQuery) migrated.value.query.source = todayQuery;
      else if (migrated.value.name === 'Tomorrow' && source === legacyTomorrowQuery) migrated.value.query.source = tomorrowQuery;
      else if (migrated.value.name === 'This week' && source === legacyCurrentWeekQuery) migrated.value.query.source = weekQuery;
      else if (migrated.value.extensions?.['utm:para-view'] === true && (source === LEGACY_ACTIVE_ITEM_VIEW_QUERY || source.startsWith(`${LEGACY_ACTIVE_ITEM_VIEW_QUERY} && `))) {
        migrated.value.query.source = `${ACTIVE_ITEM_VIEW_QUERY}${source.slice(LEGACY_ACTIVE_ITEM_VIEW_QUERY.length)}`;
      }
      const manualOrder = migrated.value.extensions?.['utm:manualOrder'];
      if (migrated.value.renderer !== 'calendar' && !(Array.isArray(manualOrder) && manualOrder.length)) {
        try {
          const canonicalSort = migrated.value.sortSource
            ? serializeSortRules(parseSortSource(migrated.value.sortSource))
            : serializeSortRules(migrated.value.sort.map((rule) => ({ expression: rule.field, direction: rule.direction, nulls: rule.nulls ?? 'last' })));
          const legacyDefaults = new Set([LEGACY_STANDARD_VIEW_SORT_SOURCE]);
          if (legacyDefaults.has(canonicalSort)) {
            migrated.value.sort = standardAttentionViewSort();
            migrated.value.sortSource = STANDARD_ATTENTION_VIEW_SORT_SOURCE;
          }
        } catch { /* Keep a custom damaged sort available for manual repair. */ }
      }
      return [key, migrated.value];
    }
    catch (reason) {
      const raw = view && typeof view === 'object' && !Array.isArray(view) ? view as Record<string, unknown> : {};
      migrationIssues.push({ id: `migration:${previous}:${key}:invalid_view`, entityType: 'view', entityId: key, sourceVersion: previous, code: 'invalid_view', disabledCapability: 'filter', status: 'needs_repair', detectedAt: now });
      warnings.push(`Quarantined invalid view ${key}`);
      return [key, { id: typeof raw.id === 'string' && raw.id ? raw.id : key, name: typeof raw.name === 'string' && raw.name ? raw.name : 'Recovered view', query: { source: 'false' }, renderer: 'list', sort: [], fields: ['title'], extensions: { quarantine: { raw: structuredClone(view), migrationError: reason instanceof Error ? reason.message : String(reason) } } } satisfies SavedView];
    }
  }));
  source.schemaVersion = SCHEMA_VERSION;
  const migratedItems = source.items as Record<string, UniversalItem>;
  const migratedViews = source.views as Record<string, SavedView>;
  if (migratedViews.__all_items__ && hasLegacyStarterFields(migratedViews.__all_items__.fields)) migratedViews.__all_items__.fields = [...starterFields];
  Object.values(migratedViews).forEach((view) => {
    if ((view.query.source === todayQuery || view.query.source === weekQuery) && hasLegacyStarterFields(view.fields)) view.fields = [...starterFields];
  });
  const requestedViewOrder = Array.isArray(source.viewOrder) ? source.viewOrder.filter((id): id is string => typeof id === 'string' && Boolean(migratedViews[id])) : [];
  const todayStarterId = Object.entries(migratedViews).find(([, view]) => view.name === 'Today' && view.query.source === todayQuery)?.[0];
  const weekStarterId = Object.entries(migratedViews).find(([, view]) => view.name === 'This week' && view.query.source === weekQuery)?.[0];
  const starterIds = [todayStarterId, weekStarterId, migratedViews.__all_items__ ? '__all_items__' : undefined].filter((id): id is string => Boolean(id));
  source.viewOrder = [...new Set([...starterIds, ...requestedViewOrder.filter((id) => !starterIds.includes(id)), ...Object.keys(migratedViews)])];
  const rawListDefinitions = source.listDefinitions && typeof source.listDefinitions === 'object' && !Array.isArray(source.listDefinitions)
    ? source.listDefinitions as Record<string, unknown>
    : {};
  const rawAreaDefinitions = source.areaDefinitions && typeof source.areaDefinitions === 'object' && !Array.isArray(source.areaDefinitions)
    ? source.areaDefinitions as Record<string, unknown>
    : {};
  const rawProjectDefinitions = source.projectDefinitions && typeof source.projectDefinitions === 'object' && !Array.isArray(source.projectDefinitions)
    ? source.projectDefinitions as Record<string, unknown>
    : {};
  const legacyKind = (name: string | undefined) => {
    const raw = name && rawListDefinitions[name];
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? String((raw as Record<string, unknown>).kind ?? '') : '';
  };
  // 1.10 and earlier stored PARA meaning inside the plain list field. Split it
  // once during migration so Area, Project and list can coexist afterwards.
  Object.values(migratedItems).forEach((item) => {
    if (!item.list) return;
    const kind = legacyKind(item.list);
    if (kind === 'area') { if (!item.areas.includes(item.list)) item.areas.push(item.list); delete item.list; }
    else if (kind === 'project') { if (!item.projects.includes(item.list)) item.projects.push(item.list); delete item.list; }
  });
  Object.values(migratedViews).forEach((view) => {
    if (!view.list) return;
    const kind = legacyKind(view.list);
    if (kind === 'area' && !view.area) { view.area = view.list; delete view.list; }
    else if (kind === 'project' && !view.project) { view.project = view.list; delete view.list; }
  });
  const listNames = new Set(Object.values(migratedItems).map((item) => item.list?.trim()).filter((name): name is string => Boolean(name)));
  source.listDefinitions = Object.fromEntries([...new Set([...Object.keys(rawListDefinitions), ...listNames])].filter((name) => !['area', 'project'].includes(legacyKind(name))).map((name) => {
    const raw = rawListDefinitions[name] && typeof rawListDefinitions[name] === 'object' && !Array.isArray(rawListDefinitions[name])
      ? rawListDefinitions[name] as Record<string, unknown>
      : {};
    const itemDates = Object.values(migratedItems).filter((item) => item.list === name).map((item) => item.createdAt).filter((date) => Number.isFinite(Date.parse(date))).sort();
    const createdAt = typeof raw.createdAt === 'string' && Number.isFinite(Date.parse(raw.createdAt)) ? raw.createdAt : itemDates[0] ?? now;
    const updatedAt = typeof raw.updatedAt === 'string' && Number.isFinite(Date.parse(raw.updatedAt)) ? raw.updatedAt : createdAt;
    const kind = ['list', 'resource', 'archive'].includes(String(raw.kind)) ? raw.kind : 'list';
    const priority = Math.max(0, Math.min(4, Math.floor(Number(raw.priority) || 0)));
    return [name, { name, kind, priority, createdAt, updatedAt }];
  }));
  const areaNames = new Set([
    ...Object.keys(rawAreaDefinitions),
    ...Object.values(rawProjectDefinitions).flatMap((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const raw = value as Record<string, unknown>;
      return [...(Array.isArray(raw.areas) ? raw.areas.filter((area): area is string => typeof area === 'string') : []), ...(typeof raw.area === 'string' ? [raw.area] : [])];
    }).map((name) => name.trim()).filter(Boolean),
    ...Object.entries(rawListDefinitions).filter(([, raw]) => raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as Record<string, unknown>).kind === 'area').map(([name]) => name),
    ...Object.values(migratedItems).flatMap((item) => item.areas),
    ...Object.values(migratedViews).map((view) => view.area).filter((name): name is string => Boolean(name?.trim())),
  ]);
  const projectNames = new Set([
    ...Object.keys(rawProjectDefinitions),
    ...Object.entries(rawListDefinitions).filter(([, raw]) => raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as Record<string, unknown>).kind === 'project').map(([name]) => name),
    ...Object.values(migratedItems).flatMap((item) => item.projects),
    ...Object.values(migratedViews).map((view) => view.project).filter((name): name is string => Boolean(name?.trim())),
  ]);
  const organizationDefinition = (name: string, raw: Record<string, unknown>, itemDates: string[]) => {
    const createdAt = typeof raw.createdAt === 'string' && Number.isFinite(Date.parse(raw.createdAt)) ? raw.createdAt : itemDates[0] ?? now;
    return {
      name,
      createdAt,
      updatedAt: typeof raw.updatedAt === 'string' && Number.isFinite(Date.parse(raw.updatedAt)) ? raw.updatedAt : createdAt,
    };
  };
  source.areaDefinitions = Object.fromEntries([...areaNames].map((name, index) => {
    const direct = rawAreaDefinitions[name]; const legacy = rawListDefinitions[name];
    const raw = direct && typeof direct === 'object' && !Array.isArray(direct) ? direct as Record<string, unknown> : legacy && typeof legacy === 'object' && !Array.isArray(legacy) ? legacy as Record<string, unknown> : {};
    const dates = Object.values(migratedItems).filter((item) => item.areas.includes(name)).map((item) => item.createdAt).filter((date) => Number.isFinite(Date.parse(date))).sort();
    const definition = organizationDefinition(name, raw, dates);
    return [name, { ...definition, ...(typeof raw.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.accent) ? { accent: raw.accent } : {}) }];
  }));
  source.projectDefinitions = Object.fromEntries([...projectNames].map((name, index) => {
    const direct = rawProjectDefinitions[name]; const legacy = rawListDefinitions[name];
    const raw = direct && typeof direct === 'object' && !Array.isArray(direct) ? direct as Record<string, unknown> : legacy && typeof legacy === 'object' && !Array.isArray(legacy) ? legacy as Record<string, unknown> : {};
    const dates = Object.values(migratedItems).filter((item) => item.projects.includes(name)).map((item) => item.createdAt).filter((date) => Number.isFinite(Date.parse(date))).sort();
    const definition = organizationDefinition(name, raw, dates);
    const areas = [...new Set([
      ...(Array.isArray(raw.areas) ? raw.areas.filter((area): area is string => typeof area === 'string') : []),
      ...(typeof raw.area === 'string' ? [raw.area] : []),
    ].map((area) => area.trim()).filter(Boolean))];
    return [name, { ...definition, areas, ...(typeof raw.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.accent) ? { accent: raw.accent } : {}) }];
  }));
  const rawOrganizationPreferences = source.organizationPreferences && typeof source.organizationPreferences === 'object' && !Array.isArray(source.organizationPreferences)
    ? source.organizationPreferences as Record<string, unknown>
    : {};
  const organizationPriority = (value: unknown) => Math.max(0, Math.min(4, Math.floor(Number(value) || 0)));
  const rawTagPriorities = rawOrganizationPreferences.tagPriorities && typeof rawOrganizationPreferences.tagPriorities === 'object' && !Array.isArray(rawOrganizationPreferences.tagPriorities)
    ? rawOrganizationPreferences.tagPriorities as Record<string, unknown>
    : {};
  const orderedLegacy = (names: string[], rawDefinitions: Record<string, unknown>, unassignedPriority: unknown) => [...names, null]
    .sort((left, right) => {
      const rawFor = (name: string | null) => name === null ? {} : rawDefinitions[name] && typeof rawDefinitions[name] === 'object' && !Array.isArray(rawDefinitions[name]) ? rawDefinitions[name] as Record<string, unknown> : {};
      const leftRaw = rawFor(left); const rightRaw = rawFor(right);
      const priority = (name: string | null, raw: Record<string, unknown>) => name === null ? organizationPriority(unassignedPriority) : organizationPriority(raw.priority);
      const order = (name: string | null, raw: Record<string, unknown>) => name === null ? Number.MAX_SAFE_INTEGER : Number.isFinite(Number(raw.order)) ? Number(raw.order) : Number.MAX_SAFE_INTEGER;
      const created = (name: string | null, raw: Record<string, unknown>) => name === null ? 0 : Date.parse(typeof raw.createdAt === 'string' ? raw.createdAt : '') || 0;
      return priority(right, rightRaw) - priority(left, leftRaw) || order(left, leftRaw) - order(right, rightRaw) || created(right, rightRaw) - created(left, leftRaw) || String(left ?? '').localeCompare(String(right ?? ''), undefined, { numeric: true, sensitivity: 'base' });
    });
  const normalizeOrder = (value: unknown, names: string[], legacy: Array<string | null>) => {
    const known = new Set(names); const result: Array<string | null> = [];
    for (const entry of Array.isArray(value) ? value : legacy) {
      if (entry === null) { if (!result.includes(null)) result.push(null); }
      else if (typeof entry === 'string' && known.has(entry) && !result.includes(entry)) result.push(entry);
    }
    names.forEach((name) => { if (!result.includes(name)) result.push(name); });
    if (!result.includes(null)) result.push(null);
    return result;
  };
  const tags = [...new Set([...Object.keys(rawTagPriorities), ...Object.values(migratedItems).flatMap((item) => item.tags)].map((tag) => tag.trim()).filter(Boolean))];
  const legacyTags: Array<string | null> = [...tags.sort((left, right) => organizationPriority(rawTagPriorities[right]) - organizationPriority(rawTagPriorities[left]) || left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })), null];
  const legacyDefinitions = (names: string[], direct: Record<string, unknown>) => Object.fromEntries(names.map((name) => {
    const raw = direct[name] && typeof direct[name] === 'object' && !Array.isArray(direct[name]) ? direct[name] : rawListDefinitions[name];
    return [name, raw];
  }));
  const areaOrder = normalizeOrder(rawOrganizationPreferences.areaOrder, [...areaNames], orderedLegacy([...areaNames], legacyDefinitions([...areaNames], rawAreaDefinitions), rawOrganizationPreferences.unassignedAreaPriority));
  const projectOrder = normalizeOrder(rawOrganizationPreferences.projectOrder, [...projectNames], orderedLegacy([...projectNames], legacyDefinitions([...projectNames], rawProjectDefinitions), rawOrganizationPreferences.unassignedProjectPriority));
  const tagOrder = normalizeOrder(rawOrganizationPreferences.tagOrder, tags, legacyTags);
  const rawTagAccents = rawOrganizationPreferences.tagAccents && typeof rawOrganizationPreferences.tagAccents === 'object' && !Array.isArray(rawOrganizationPreferences.tagAccents)
    ? rawOrganizationPreferences.tagAccents as Record<string, unknown>
    : {};
  const tagAccents = Object.fromEntries(Object.entries(rawTagAccents)
    .filter(([tag, accent]) => tag.trim() && typeof accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(accent)));
  const priorityOrder: Array<{ kind: 'area' | 'project' | 'tag'; name: string | null; area?: string | null }> = [];
  for (const entry of Array.isArray(rawOrganizationPreferences.priorityOrder) ? rawOrganizationPreferences.priorityOrder : []) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const raw = entry as Record<string, unknown>;
    if (!['area', 'project', 'tag'].includes(String(raw.kind)) || raw.name !== null && typeof raw.name !== 'string') continue;
    priorityOrder.push({
      kind: raw.kind as 'area' | 'project' | 'tag',
      name: typeof raw.name === 'string' ? raw.name.trim() || null : null,
      ...(raw.kind === 'project' && raw.name !== null && Object.prototype.hasOwnProperty.call(raw, 'area') ? { area: typeof raw.area === 'string' ? raw.area.trim() || null : null } : {}),
    });
  }
  source.organizationPreferences = { areaOrder, projectOrder, tagOrder, tagAccents, priorityOrder: priorityOrder.length ? priorityOrder : [
    ...areaOrder.map((name) => ({ kind: 'area' as const, name })),
    ...projectOrder.map((name) => ({ kind: 'project' as const, name })),
    ...tagOrder.map((name) => ({ kind: 'tag' as const, name })),
  ] };
  (source.organizationPreferences as { priorityOrder: typeof priorityOrder }).priorityOrder = normalizedOrganizationPriorityOrder(
    (source.organizationPreferences as { priorityOrder: typeof priorityOrder }).priorityOrder,
    source as unknown as WorkspaceDocument,
  );
  source.customFields ??= {}; source.dashboards ??= {}; source.automations ??= {}; source.automationLog ??= []; source.migrationIssues = migrationIssues; source.tombstones ??= {};
  Object.values(source.dashboards as Record<string, unknown>).forEach((dashboard) => {
    if (!dashboard || typeof dashboard !== 'object' || Array.isArray(dashboard)) return;
    const widgets = (dashboard as Record<string, unknown>).widgets;
    if (!Array.isArray(widgets)) return;
    widgets.forEach((widget) => {
      if (!widget || typeof widget !== 'object' || Array.isArray(widget)) return;
      const candidate = widget as Record<string, unknown>;
      if (candidate.viewId === todayStarterId && candidate.title === 'Today + overdue') candidate.title = 'Today';
      if (candidate.viewId === weekStarterId && candidate.title === 'This week + overdue') candidate.title = 'This week';
    });
  });
  source.pushPreferences ??= { enabled: false, contentMode: 'generic' };
  const pushPreferences = source.pushPreferences as Record<string, unknown>;
  pushPreferences.enabled = pushPreferences.enabled === true;
  pushPreferences.contentMode = pushPreferences.contentMode === 'detailed' ? 'detailed' : 'generic';
  source.calendarPreferences ??= {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    lastMode: 'month', weekStartsOn: 1, workingHours: { start: '08:00', end: '22:00' }, weekends: true,
    sleepSchedule: { wake: '08:00', sleep: '22:00' }, snapMinutes: 15, defaultDurationMinutes: 30, timeFormat: '24h', language: 'en', appearance: { mode: 'system', lightAt: '07:00', darkAt: '20:00', tickSound: true, uiSound: true, soundDefaultsVersion: 1 }, diagnosticsEnabled: true, showExplanations: false,
  };
  const calendarPreferences = source.calendarPreferences as Record<string, unknown>;
  // Preferences are persisted locally and evolve faster than the workspace
  // schema. Drop obsolete UI-only keys during migration instead of rejecting a
  // whole encrypted workspace at unlock time.
  const allowedCalendarPreferenceKeys = new Set([
    'timezone', 'lastMode', 'weekStartsOn', 'workingHours', 'weekends',
    'sleepSchedule', 'snapMinutes', 'defaultDurationMinutes', 'timeFormat',
    'dayView', 'selectedViewId', 'includeStates', 'language', 'appearance', 'testClock',
    'backupPreferences', 'diagnosticsEnabled', 'showExplanations', 'googleCalendar',
  ]);
  Object.keys(calendarPreferences).forEach((key) => {
    if (!allowedCalendarPreferenceKeys.has(key)) delete calendarPreferences[key];
  });
  if (!calendarPreferences.dayView || typeof calendarPreferences.dayView !== 'object' || Array.isArray(calendarPreferences.dayView)) {
    const selectedView = typeof calendarPreferences.selectedViewId === 'string' ? migratedViews[calendarPreferences.selectedViewId] : undefined;
    const legacyStates = Array.isArray(calendarPreferences.includeStates)
      ? calendarPreferences.includeStates.filter((state): state is string => ['open', 'done', 'cancelled', 'auto_closed', 'archived'].includes(String(state)))
      : ['open', 'done'];
    const stateFilter = legacyStates.length
      ? legacyStates.map((state) => `state == ${JSON.stringify(state)}`).join(' || ')
      : 'false';
    const fallbackSort: ViewSortRule[] = [
      { expression: 'schedule.startAt', direction: 'asc', nulls: 'first' },
      { expression: 'schedule.dueAt', direction: 'asc', nulls: 'first' },
    ];
    let migratedSort = fallbackSort;
    if (selectedView) {
      try {
        migratedSort = selectedView.sortSource
          ? parseSortSource(selectedView.sortSource)
          : selectedView.sort.map((rule) => ({ expression: rule.field, direction: rule.direction, nulls: rule.nulls ?? 'last' }));
      } catch {
        // A damaged legacy sort must not prevent the encrypted workspace from
        // opening. Calendar falls back to chronological order while the
        // original Saved View remains available for manual repair.
        migratedSort = fallbackSort;
      }
    }
    calendarPreferences.dayView = {
      filter: { source: selectedView?.query.source || stateFilter },
      scheduleSources: ['event_open', 'event', 'active', 'due'],
      fields: selectedView?.fields?.length ? [...selectedView.fields] : [...starterFields, 'schedule.estimatedDuration', 'external.provider'],
      sort: migratedSort,
      sortSource: serializeSortRules(migratedSort),
    };
  }
  delete calendarPreferences.selectedViewId;
  delete calendarPreferences.includeStates;
  const legacyWorkingHours = calendarPreferences.workingHours as { start?: string; end?: string } | undefined;
  calendarPreferences.sleepSchedule ??= { wake: legacyWorkingHours?.start ?? '08:00', sleep: legacyWorkingHours?.end ?? '22:00' };
  if (!['en', 'ru', 'es', 'de', 'fr', 'ko'].includes(String(calendarPreferences.language))) calendarPreferences.language = 'en';
  calendarPreferences.diagnosticsEnabled = calendarPreferences.diagnosticsEnabled !== false;
  calendarPreferences.showExplanations = calendarPreferences.showExplanations === true;
  if (calendarPreferences.googleCalendar !== undefined) {
    const raw = calendarPreferences.googleCalendar;
    const google = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined;
    if (!google || typeof google.connectionId !== 'string' || !google.connectionId) delete calendarPreferences.googleCalendar;
    else {
      const calendars = Array.isArray(google.calendars) ? google.calendars.flatMap((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
        const value = entry as Record<string, unknown>;
        if (typeof value.id !== 'string' || !value.id || typeof value.name !== 'string' || !value.name) return [];
        return [{ id: value.id, name: value.name, selected: value.selected !== false, ...(value.primary === true ? { primary: true } : {}) }];
      }) : [];
      const tokens = google.syncTokens && typeof google.syncTokens === 'object' && !Array.isArray(google.syncTokens)
        ? Object.fromEntries(Object.entries(google.syncTokens as Record<string, unknown>).filter((entry): entry is [string, string] => Boolean(entry[0]) && typeof entry[1] === 'string' && Boolean(entry[1]))) : {};
      calendarPreferences.googleCalendar = {
        connectionId: google.connectionId,
        ...(typeof google.accountEmail === 'string' ? { accountEmail: google.accountEmail } : {}),
        calendars, syncTokens: tokens,
        ...(google.syncWindow && typeof google.syncWindow === 'object' && !Array.isArray(google.syncWindow)
          && ['timeMin', 'timeMax', 'refreshedAt'].every((key) => typeof (google.syncWindow as Record<string, unknown>)[key] === 'string' && Number.isFinite(Date.parse((google.syncWindow as Record<string, string>)[key]!)))
          ? { syncWindow: {
            timeMin: (google.syncWindow as Record<string, string>).timeMin!,
            timeMax: (google.syncWindow as Record<string, string>).timeMax!,
            refreshedAt: (google.syncWindow as Record<string, string>).refreshedAt!,
          } } : {}),
        ...(typeof google.lastSyncedAt === 'string' && Number.isFinite(Date.parse(google.lastSyncedAt)) ? { lastSyncedAt: google.lastSyncedAt } : {}),
        ...(typeof google.lastError === 'string' ? { lastError: google.lastError } : {}),
      };
    }
  }
  calendarPreferences.appearance ??= { mode: 'system', lightAt: '07:00', darkAt: '20:00', tickSound: true, uiSound: true, soundDefaultsVersion: 1 };
  const appearance = calendarPreferences.appearance as Record<string, unknown>;
  Object.keys(appearance).forEach((key) => {
    if (!['mode', 'lightAt', 'darkAt', 'tickSound', 'uiSound', 'soundDefaultsVersion'].includes(key)) delete appearance[key];
  });
  if (!['system', 'light', 'dark', 'scheduled'].includes(String(appearance.mode))) appearance.mode = 'system';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(appearance.lightAt))) appearance.lightAt = '07:00';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(appearance.darkAt))) appearance.darkAt = '20:00';
  // Previous releases had both switches off by default. Upgrade that default once,
  // while allowing a person to turn either sound off afterwards.
  if (appearance.soundDefaultsVersion !== 1) {
    appearance.tickSound = true;
    appearance.uiSound = true;
    appearance.soundDefaultsVersion = 1;
  } else {
    appearance.tickSound = appearance.tickSound === true;
    appearance.uiSound = appearance.uiSound === true;
  }
  calendarPreferences.testClock ??= { enabled: false, secondsPerDay: 86_400, dayDurationValue: 24, dayDurationUnit: 'hours', startedAt: now, virtualAt: now };
  const testClock = calendarPreferences.testClock as Record<string, unknown>;
  Object.keys(testClock).forEach((key) => {
    if (!['enabled', 'secondsPerDay', 'dayDurationValue', 'dayDurationUnit', 'startedAt', 'virtualAt'].includes(key)) delete testClock[key];
  });
  testClock.enabled = testClock.enabled === true;
  testClock.secondsPerDay = Math.max(1, Number(testClock.secondsPerDay) || 86_400);
  const units = ['seconds', 'minutes', 'hours'];
  if (!units.includes(String(testClock.dayDurationUnit))) delete testClock.dayDurationUnit;
  if (!(Number(testClock.dayDurationValue) > 0)) delete testClock.dayDurationValue;
  if (Number.isNaN(new Date(String(testClock.startedAt)).getTime())) testClock.startedAt = now;
  if (Number.isNaN(new Date(String(testClock.virtualAt)).getTime())) testClock.virtualAt = now;
  calendarPreferences.backupPreferences ??= { reminderDays: 7 };
  const backupPreferences = calendarPreferences.backupPreferences as Record<string, unknown>;
  Object.keys(backupPreferences).forEach((key) => {
    if (!['reminderDays', 'lastBackupAt', 'locationLabel'].includes(key)) delete backupPreferences[key];
  });
  backupPreferences.reminderDays = Math.max(0, Math.floor(Number(backupPreferences.reminderDays) || 0));
  if (backupPreferences.lastBackupAt && Number.isNaN(new Date(String(backupPreferences.lastBackupAt)).getTime())) delete backupPreferences.lastBackupAt;
  if (backupPreferences.locationLabel !== undefined && typeof backupPreferences.locationLabel !== 'string') delete backupPreferences.locationLabel;
  const validation = validateWorkspace(source);
  if (!validation.valid) throw new Error(validation.errors.join('; '));
  if (previous !== SCHEMA_VERSION) warnings.unshift(`Migrated workspace schema ${previous} to ${SCHEMA_VERSION}`);
  return { value: source as unknown as WorkspaceDocument, warnings };
}

export function isPortablePackage(value: unknown): value is PortablePackage {
  return validatePortablePackage(value).valid;
}
