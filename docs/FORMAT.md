# Universal Task Manager workspace format

Current application: `v1.20.0`. Current workspace schema: `1.18.0`.

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
- `views`: saved filters, sort expressions, renderer choice and displayed fields.
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

- `id`, `title`, `bodyMarkdown`, `state`, `priority`, `tags`, `areas`, `projects`;
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
