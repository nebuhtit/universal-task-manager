# Universal Task Manager workspace format

Current application: `v1.95.5`. Current workspace schema: `1.21.0`.

This document is intentionally written for people, migration authors and AI
tools that do not have Universal Task Manager installed. A decrypted recovery
file is ordinary UTF-8 JSON. Its top-level `readme` repeats the most important
parts of this guide, and its `workspace` property contains the complete data.

## Reading a decrypted recovery file

```jsonc
{
  "format": "utm-readable-workspace", // identifies the human-readable recovery wrapper
  "formatVersion": 1,                 // wrapper version, not the workspace schema
  "decryptedAt": "2026-08-28T...Z",  // when this readable copy was made
  "source": {                         // encrypted container type that was opened
    "magic": "UTM-LOCAL-ENCRYPTED",
    "diagnosticsIncluded": true
  },
  "readme": { "...": "embedded format guidance" },
  "workspace": { "...": "the canonical WorkspaceDocument" },
  "diagnostics": []                   // optional technical log, without item text
}
```

Keep this wrapper and the original encrypted file. When converting to another
task manager, use `workspace.items` as the source collection. Views are computed
projections and are not separate copies of tasks.

The readable export is an emergency recovery tool for inspecting, repairing or
moving an archive when UTM cannot open it. It is not a replacement for the
encrypted backup. The workspace owner must never disclose the password to
another person, support staff or an AI; decrypt files locally and share only a
sanitized copy when assistance is necessary.

## Workspace map

- `workspaceId`: stable identity. Never merge unrelated IDs automatically.
- `schemaVersion`: data-model version. It is independent from the app version.
- `name`, `createdAt`, `updatedAt`: workspace metadata.
- `items`: object keyed by stable item ID. Contains tasks, events, habits,
  recurrence templates and materialized occurrences.
- `views`: saved filters, sort expressions, renderer choice, displayed fields and optional time-statistics settings. Derived percentages and capacity are never persisted.
- `areas`, `projects`, `lists`, `tags` and their order arrays: reusable PARA and
  classification definitions. Items can refer to multiple Areas and Projects;
  Projects can belong to multiple Areas.
- `organizationOrder`: unified manual priority ladder. Earlier matching entries
  rank higher for the normal `Organization order` sort.
- `customFields`: field definitions; per-item values remain attached to items.
- `automations`, item `scripts`, recurrence and reminders: executable behavior.
  Treat it as untrusted data when inspecting or converting; do not execute it.
- `migrationIssues`: repair queue. It identifies quarantined capabilities by safe
  IDs and error codes.
- `extensions`: lossless storage for legacy, unknown or quarantined data. A
  converter should preserve this object even if it cannot interpret it.

Important item fields:

- `id`, `title`, `bodyMarkdown`, optional `location`, `attachments`, `state`, `priority`, `tags`, `areas`, `projects`;
- optional `external` provenance identifies a read-only Google Calendar mirror. It contains source IDs/URL and sync metadata, never an OAuth access token;
- `startAt`, `endAt`, `dueAt` and other dates are ISO 8601 strings when present;
- `role` is `standalone`, `series_template`, or `occurrence`;
- `preset` is a UI hint (`task`, `event`, `habit`, or `blank`), not a separate
  wire format;
- `createdWith*`, `createdAt`, `updatedAt` are provenance and audit metadata;
- `extensions.quarantine` retains features that were disabled during recovery.

For a basic import into another system, map title, description, state, dates,
tags, Areas and Projects first. Put every unsupported property into a sidecar
JSON so that conversion remains reversible.

## Canonical model

`WorkspaceDocument` is the canonical open model. Versioned TypeScript interfaces
and runtime JSON Schema validation are exported by `@utm/core`. Imports preserve
unknown item/View properties in namespaced `extensions`; incompatible executable
features are quarantined instead of silently discarded.

An item has a `role` (`standalone`, `series_template`, or `occurrence`) and a UI `preset` (`task`, `event`, `habit`, or `blank`). Presets never change the wire type. Occurrence IDs are deterministic from the series ID and recurrence anchor.

Every item stores immutable provenance in `createdWithAppId`, `createdWithAppName`, and `createdWithVersion`. The stable app ID supports machine-readable interchange while the name and version make provenance understandable to people. These values identify the application that materialized that exact item or occurrence and are preserved by edits and merges. Existing items are backfilled with the Universal Task Manager identity while retaining their original creation version.

`createdAt` is immutable creation metadata. `updatedAt` is system-managed and changes whenever the item changes; neither timestamp is directly editable in the item editor.

Schema 1.2 adds encrypted `CalendarPreferences`, virtual `ProjectedOccurrence` values, and recurrence override metadata. Projecting a visible range is read-only: an occurrence enters the Automerge document only when it is opened, completed, activated, dragged, or resized.

Schema 1.3 adds `calendarPreferences.sleepSchedule` with `wake` and `sleep` wall-clock values. Calendar time grids always retain the full 24-hour day; this schedule only controls the subdued night shading and the initial scroll position. Existing 1.2 workspaces derive the values from their former working-hour bounds.

Schema 1.19 adds `SavedView.statistics` with a presentation toggle and stable IDs of scheduled items that reserve capacity. Missing settings keep the legacy visible time summary. Invalid settings are quarantined during migration. Item `location` and URL-only `attachments` remain first-class JSON fields and are also allowed in view creation defaults.

Schema 1.20 adds read-only `UniversalItem.external` Google Calendar provenance and `calendarPreferences.googleCalendar` calendar selection/incremental-sync metadata. Google OAuth access tokens remain in memory only. Google Calendar is also an export boundary: mirrored events, calendar/account identifiers, sync tokens, tombstones and references to those external items are removed before every readable or encrypted export. Privacy-safe `.utmb` files use a fresh Automerge snapshot so removed event data cannot survive in CRDT history; restoring such a file requires reconnecting Google Calendar. Opaque external events reserve capacity; transparent events do not affect free-time calculations.

Closure states distinguish manual completion from automation:

- `done` — completed by the user or an explicit automation.
- `auto_closed` — closed at a recurrence boundary without claiming human success.
- `cancelled` and `archived` — explicit lifecycle states.

## Encrypted container

`.utm` is a UTF-8 JSON envelope whose only plaintext metadata is:

```json
{
  "magic": "UTM-ENCRYPTED",
  "version": 1,
  "envelope": {
    "algorithm": "xchacha20poly1305-ietf",
    "kdf": { "algorithm": "argon2id13", "operations": 2, "memoryBytes": 19922944, "parallelism": 1 },
    "salt": "base64url",
    "nonce": "base64url",
    "ciphertext": "base64url"
  }
}
```

The authenticated plaintext contains the canonical snapshot, compressed Automerge history, export metadata, and BLAKE2b manifest digests. Associated data is `utm:container:v1`. A container is decrypted and fully validated before merge.

## Portable JSON

`PortablePackage` is readable JSON with `format: "utm-portable"` and `formatVersion: 1`. Its `kind` is `items`, `views`, or `view_bundle`; every package includes source metadata and the complete custom-field catalogue. View result and bundle exports include referenced dependencies.

Import first creates a non-mutating preview. Existing IDs may only be skipped or copied; replacement is not allowed. Conflicting custom fields require `Use local` or a renamed imported key, which is rewritten in values, filter DSL, sorting DSL, and displayed field paths. The accepted plan is applied in one Automerge transaction.

## Merge

Only identical `workspaceId` values may merge. Automerge combines concurrent histories; the result receives a new update timestamp. Tombstones preserve deletions. A failed decrypt, manifest check, schema check, workspace-ID check, or history load leaves local data unchanged.

## iCalendar

Exports use `VEVENT` for bounded scheduled items and `VTODO` otherwise. Stable identity uses `UID` plus `X-UTM-ID`; recurrence maps to `RRULE`, `RDATE`, and `EXDATE`. UTM-only semantics use `X-UTM-STATE`, `X-UTM-PRESET`, `X-UTM-AUTORENEW`, and the `X-UTM-CREATED-WITH-*` provenance fields.

Custom fields, relations, habit configuration, automation rules, dashboards, and rich reminder behavior are not fully representable in RFC 5545. The SDK reports these losses as warnings.
