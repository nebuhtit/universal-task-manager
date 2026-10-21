# Google Calendar relationship scenario audit — 2026-10-21

Original audit scope: local working tree based on `74c1809`. No production Google account was
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

## Local pending-move correction after release 4.7.4

Base: `d4b3e16`; this correction is uncommitted and is not part of the deployed
4.7.4 release. The earlier audit results above describe the pre-fix implementation.

Only the core cancellation merge is changed: ignore a cancelled source master
when its exact calendar/event/account identity matches a durable cross-calendar
`move` operation. Keep the operation and original external link until the
existing write/acknowledgement path completes the move. Transport, retries,
Google requests, recurrence merging and relation records are unchanged.

Regression coverage includes both batch orders, repeated full/delta responses,
blocked operations persisted through the normal coordinator and Automerge reload,
ordinary master deletion, edit operations, same-calendar intent, another account,
destination cancellation and cancellation of a stored cycle during a move.
All tests use synthetic data; live Google access is forbidden.

The three pending-move expected failures are now ordinary passing regressions.
The two remote-recurrence regressions remain explicitly marked `KNOWN BUG` /
`it.fails`; they are not fixed by this correction.

Verification: relationship suite 13 files / 186 checks (184 functional passes,
2 expected recurrence failures); baseline Google suite 8 files / 95 checks
(94 functional passes, 1 overlapping expected recurrence failure). Typecheck,
production build and `git diff --check` pass. Existing large-chunk build warnings
remain. No live Google request or site publication was performed for this fix.

## Local remote-recurrence correction

Also uncommitted on base `d4b3e16`, after the pending-move correction above.
An exactly linked series master now imports supported Google RRULE, RDATE,
EXDATE and timezone changes into its local recurrence. The existing adoption
parser is shared from core instead of creating another recurrence parser.
The candidate rule is validated before assignment; unsupported payloads retain
the previous local rule and do not abort the refresh. A later supported payload
can still update the rule.

UTM activation, close/renew policy, relationships, IDs and history are retained.
Dates contributed by the previous remote master are replaced, while local dates
and exclusions learned from cancelled instances are preserved. Pending local
Google-save operations still prevent remote overwrites. No transport requests,
queue/retry policy or recurrence reconciliation algorithm was changed.

Both remaining `KNOWN BUG` expected failures are now normal passing regressions,
including placement after a persisted coordinator reload. Relationship suite:
186 normal passes. Baseline Google suite: 102 normal passes. Shared adoption
parser/adoption suite: 4 normal passes. These suites overlap; counts should not
be summed as distinct tests. No live Google account was accessed.

Scope does not add support for multiple RRULEs, EXRULE or converting a remotely
non-recurring event into a different local role. Unsupported recurrence shapes
continue to keep their last supported local rule.
