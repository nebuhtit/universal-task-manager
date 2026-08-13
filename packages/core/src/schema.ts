import { SCHEMA_VERSION } from './types.js';
import type { WorkspaceDocument } from './types.js';

export const workspaceJsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://universal-task-manager.dev/schema/workspace-1.0.0.json',
  title: 'Universal Task Manager workspace',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'workspaceId', 'name', 'createdAt', 'updatedAt', 'items', 'customFields', 'views', 'dashboards', 'automations', 'automationLog', 'tombstones'],
  properties: {
    schemaVersion: { const: SCHEMA_VERSION },
    workspaceId: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    items: { type: 'object', additionalProperties: { $ref: '#/$defs/item' } },
    customFields: { type: 'object' },
    views: { type: 'object' },
    dashboards: { type: 'object' },
    automations: { type: 'object' },
    automationLog: { type: 'array' },
    tombstones: { type: 'object', additionalProperties: { type: 'string', format: 'date-time' } },
  },
  $defs: {
    item: {
      type: 'object',
      required: ['id', 'schemaVersion', 'revision', 'role', 'preset', 'title', 'bodyMarkdown', 'state', 'createdAt', 'updatedAt', 'contexts', 'tags', 'reminders', 'relations', 'attachments', 'custom'],
      properties: {
        id: { type: 'string', minLength: 1 },
        schemaVersion: { const: SCHEMA_VERSION },
        revision: { type: 'integer', minimum: 1 },
        role: { enum: ['standalone', 'series_template', 'occurrence'] },
        preset: { enum: ['task', 'event', 'habit', 'blank'] },
        title: { type: 'string' },
        bodyMarkdown: { type: 'string' },
        state: { enum: ['open', 'done', 'cancelled', 'auto_closed', 'archived'] },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
        deletedAt: { type: 'string', format: 'date-time' },
        closure: { type: 'object' },
        schedule: { type: 'object' },
        recurrence: { type: 'object' },
        occurrence: { type: 'object' },
        progress: { type: 'object' },
        habit: { type: 'object' },
        priority: { type: 'integer', minimum: 0, maximum: 4 },
        contexts: { type: 'array', items: { type: 'string' } },
        tags: { type: 'array', items: { type: 'string' } },
        reminders: { type: 'array' },
        relations: { type: 'array' },
        attachments: { type: 'array' },
        custom: { type: 'object' },
      },
    },
  },
} as const;

export interface ValidationResult { valid: boolean; errors: string[] }

export function validateWorkspace(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false, errors: ['Workspace must be an object'] };
  const doc = value as Partial<WorkspaceDocument>;
  if (doc.schemaVersion !== SCHEMA_VERSION) errors.push(`Unsupported schemaVersion: ${String(doc.schemaVersion)}`);
  if (!doc.workspaceId || typeof doc.workspaceId !== 'string') errors.push('workspaceId is required');
  if (!doc.name || typeof doc.name !== 'string') errors.push('name is required');
  for (const field of ['items', 'customFields', 'views', 'dashboards', 'automations', 'tombstones'] as const) {
    if (!doc[field] || typeof doc[field] !== 'object' || Array.isArray(doc[field])) errors.push(`${field} must be an object`);
  }
  if (!Array.isArray(doc.automationLog)) errors.push('automationLog must be an array');
  if (doc.items && typeof doc.items === 'object') {
    for (const [key, item] of Object.entries(doc.items)) {
      if (!item || typeof item !== 'object') { errors.push(`items.${key} must be an object`); continue; }
      if (item.id !== key) errors.push(`items.${key}.id must match its map key`);
      if (!['standalone', 'series_template', 'occurrence'].includes(item.role)) errors.push(`items.${key}.role is invalid`);
      if (!['open', 'done', 'cancelled', 'auto_closed', 'archived'].includes(item.state)) errors.push(`items.${key}.state is invalid`);
      if (item.role === 'series_template' && (!item.recurrence || !item.schedule?.startAt)) errors.push(`items.${key} recurring template requires recurrence and schedule.startAt`);
    }
  }
  return { valid: errors.length === 0, errors };
}
