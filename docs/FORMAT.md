# UTM format 1.2

## Canonical model

`WorkspaceDocument` is the canonical open model. Versioned schemas from 1.0 through 1.2 are published in `packages/core/schema`; TypeScript interfaces and runtime Draft 2020-12 validation are exported by `@utm/core`. Imports migrate sequentially and preserve unknown item/View properties in namespaced `extensions`.

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
