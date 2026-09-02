import { APP_NAME, APP_VERSION, SCHEMA_VERSION } from './types.js';

/**
 * Machine-readable orientation included in every decrypted recovery export.
 * It deliberately describes meaning instead of duplicating the JSON Schema so
 * people and general-purpose tools can understand the data without UTM.
 */
export const WORKSPACE_FORMAT_GUIDE = {
  title: `${APP_NAME} readable workspace`,
  applicationVersion: APP_VERSION,
  currentSchemaVersion: SCHEMA_VERSION,
  documentation: 'https://github.com/nebuhtit/universal-task-manager/blob/main/docs/FORMAT.md',
  principles: [
    'workspace is the complete local-first database snapshot; IDs are stable identifiers, not display names',
    'items contains tasks, events, habits, recurrence templates and materialized occurrences',
    'views are saved filters, sorting rules and display settings; removing a view does not remove items',
    'definitions stores reusable Areas, Projects, Lists and Tags; items reference their IDs or names through organization fields',
    'unknown or incompatible data is retained in extensions and migrationIssues instead of being silently discarded',
    'timestamps are ISO 8601 strings; null or an absent optional field means that value is not set',
  ],
  importantFields: {
    workspaceId: 'Stable identity of this workspace. Backups with different workspaceId values must not be merged automatically.',
    schemaVersion: 'Version of the workspace data model, independent from the application version.',
    items: 'Object keyed by item ID. title/bodyMarkdown are user text; state is lifecycle; role distinguishes standalone, series_template and occurrence.',
    views: 'Object keyed by view ID. query and sort are UTM DSL expressions; displayedFields controls visible columns.',
    areasProjectsTags: 'Items may contain multiple areas, projects and tags. Project definitions may belong to several Areas.',
    organizationOrder: 'Unified manual priority ladder. Earlier matching entries have a larger rank and sort first with organizationOrder desc.',
    attentionOrder: 'Virtual View sort: overdue open items, active ranges, nearest future Start or Due, undated items, then closed items.',
    durationOrder: 'Virtual numeric View sort based on estimatedDuration with Event opens to Event ends fallback; it is never stored on an item.',
    recurrence: 'RRULE-based repeating behavior. A quarantined recurrence is preserved in extensions but must not be executed.',
    extensions: 'Lossless storage for unknown, legacy or quarantined fields. Preserve it during conversion even if the target tool cannot use it.',
    migrationIssues: 'Repair queue containing safe entity IDs and disabled capabilities; it does not contain passwords or encryption keys.',
    external: 'Read-only calendar provenance. Google source IDs and URLs may be stored, but OAuth access tokens are never part of the workspace.',
    automationsAndScripts: 'Executable behavior. Treat as untrusted input and do not execute when merely importing or visualizing the JSON.',
  },
  safeConversionAdvice: [
    'Keep the original decrypted JSON unchanged as an archive before converting it.',
    'Map title, bodyMarkdown, state, dates, tags, areas and projects first; preserve every unsupported field in a sidecar JSON.',
    'Never execute scripts, automations, filter code or recurrence rules merely because they occur in this file.',
    'Do not infer deletion from a missing view result: views are computed projections, while items is the source collection.',
  ],
} as const;
