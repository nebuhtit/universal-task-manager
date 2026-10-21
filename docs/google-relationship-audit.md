# Google Calendar relationship scenario audit — 2026-10-21

Scope: local working tree based on `74c1809`. No production Google account was
accessed, no live calendar was modified, and no sync implementation was changed.
This is not proof of live Google transport behavior or iPhone Safari rendering.

Repeat with `pnpm test:google:relationships`.

## Coverage

- Existing series links, stored-occurrence links and missing generated-occurrence links.
- Repeated full and delta imports, including both source/destination batch orders.
- Confirmed calendar moves: source → destination → third → source, stable local ID.
- Remote title, date and time edits; Moscow timezone with explicit UTC offsets.
- Local edits to one occurrence: title, date, time and duration, followed by the
  master plus exception returned by Google.
- Local "this and future" edits: title, time, date, recurrence and reminders.
- Combined chain: future split → refresh → acknowledged calendar move → rename → refresh.
- An unrelated same-name Work remains independent.
- Cancelled single cycles and recurrence rules without a slot on the task's date:
  the relationship remains visible but no time slot should be invented.
- A recurrence-rule change scoped to only one occurrence is rejected atomically.
- Incoming relationship names and types are rendered; list selectors retain the
  task. Existing focused browser tests separately cover readable relation rows
  with explanations disabled. This audit does not run a live post-sync browser session.

Response replay uses the real `calculateGoogleSyncPlan` / `applyGoogleSyncPlan`.
Read selectors receive fresh snapshots as production immutable commits do.
Transport acknowledgements in the replay are explicit fixture boundaries;
`googleSeriesMove.test.ts` separately exercises the move transport with fake HTTP.
Two regressions below were additionally reproduced through
`createWorkspaceSaveService.synchronize()` and durable Automerge reload, with
live HTTP forbidden.

## Confirmed unresolved regressions

### 1. Unacknowledged / blocked calendar move can lose its durable intent

Initial state: a writable recurring master remains linked to the old calendar,
with a queued move to the destination. Its remote move may already have succeeded
but local acknowledgement was interrupted, or the queue is blocked.

Response: source master is cancelled; destination returns the same remote master ID.
Both batch orders reproduce the problem. Source cancellation calls
`detachGoogleCalendar`, clearing the pending operation and the old external link.
A destination mirror can remain separate from the original local series.

Task relation records remain, but the original block can stop following Google.
This is not a same-title matching issue. It also reproduces through the normal
coordinator after persistence/reload when a blocked queue is skipped during retry.

### 2. Remote recurrence-rule changes do not update the linked UTM rule

Initial state: UTM recurring series uses a daily rule. Google returns the same
master with a weekly rule. The remote event snapshot is refreshed, but the local
`recurrence.rrule` stays daily. A related task may therefore be placed on a day
that no longer exists in Google's recurrence.

The local task's relation is not deleted; the placement is based on stale recurrence.
Reproduced through normal synchronization and persisted reload.

## Test status convention

Five assertions covering these two bugs (three response-replay cases and two
coordinator/reload cases) are deliberately declared `it.fails`, named `KNOWN BUG`.
They are **not fixes and not successful functional scenarios**. They reproduce
the currently wrong behavior without leaving the default suite permanently red.
If a fix makes their desired assertions pass, Vitest reports an unexpected pass;
remove `.fails` only with the corresponding verified fix.

The user's scope explicitly excluded sync changes, so the audit leaves both
implementation paths unchanged. All other scenarios in the new matrix pass.

Final focused run: 13 files / 178 checks, comprising 173 successful checks and
5 expected failures documenting the two unresolved bugs. Web typecheck and
`git diff --check` passed. SHA-1 readbacks of the sync plan, worker, Google client,
workspace save coordinator and core Google merge implementation match the audit
start. The new response-replay matrix has 26 checks (23 successful / 3 expected
failures); the remaining 2 expected failures use the persisted coordinator harness.
