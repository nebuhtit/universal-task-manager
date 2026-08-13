# UTM format 1.0

## Canonical model

`WorkspaceDocument` is the canonical open model. Its schema is published at `packages/core/schema/workspace-1.0.0.json`; TypeScript interfaces are exported by `@utm/core`.

An item has a `role` (`standalone`, `series_template`, or `occurrence`) and a UI `preset` (`task`, `event`, `habit`, or `blank`). Presets never change the wire type. Occurrence IDs are deterministic from the series ID and recurrence anchor.

Every item stores an immutable `createdWithVersion` value. It records the app version that materialized that exact item or occurrence and is preserved by edits and merges. Workspaces created before version 0.2.0 are backfilled with `0.1.0` when first unlocked by a newer app.

`createdAt` is immutable creation metadata. `updatedAt` is system-managed and changes whenever the item changes; neither timestamp is directly editable in the item editor.

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

## Merge

Only identical `workspaceId` values may merge. Automerge combines concurrent histories; the result receives a new update timestamp. Tombstones preserve deletions. A failed decrypt, manifest check, schema check, workspace-ID check, or history load leaves local data unchanged.

## iCalendar

Exports use `VEVENT` for bounded scheduled items and `VTODO` otherwise. Stable identity uses `UID` plus `X-UTM-ID`; recurrence maps to `RRULE`, `RDATE`, and `EXDATE`. UTM-only semantics use `X-UTM-STATE`, `X-UTM-PRESET`, and `X-UTM-AUTORENEW`.

Custom fields, relations, habit configuration, automation rules, dashboards, and rich reminder behavior are not fully representable in RFC 5545. The SDK reports these losses as warnings.
