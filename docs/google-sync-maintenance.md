# Google synchronization: maintenance map

Local candidate 3.4.3; automatic startup sync is temporarily disabled. Do not
restore it until manual synchronization is checked on the physical iPhone.

## Ownership

- `App.tsx`: explicit Sync action, authorization and visible progress. It must
  not hold a global interaction lock while waiting for Google.
- `workspaceSaveService.ts`: durable write queue, session/connection guards,
  per-item write exclusion and one explicit synchronization at a time.
- `googleCalendar.ts`: bounded HTTP requests, paginated download, incremental
  cursors. Repeated page tokens fail; partial downloads must not advance cursors.
- `googleSyncWorker.ts` / `googleSync.worker.ts`: sliced snapshot and isolated
  calculation with a 30-second worker timeout. No blocking fallback on devices
  without workers.
- `googleSyncPlan.ts`: detached import calculation and optimistic atomic patch.
  All calendar batches, removals and new cursors belong to the same plan.
- `googleItemSave.ts`, `googleCalendarEdit.ts`, `itemDeleteCommand.ts`: remote
  writes and recurrence scopes. Intent must reach durable storage before writes.
- `packages/core/src/google-calendar.ts`: verified identity reconciliation.

## Invariants

1. Never merge by title. Match persisted Google IDs/operation IDs and exact
   recurrence identity. Preserve UTM history and UTM-only properties.
2. Never advance sync cursors before applying all corresponding downloaded data.
3. Snapshot calculation cannot overwrite edits made while it was running. The
   coordinator checks document identity immediately before commit; the patch
   validates every changed value before applying anything. A conflict requires
   another explicit Sync, not silent overwrite or an automatic retry loop.
   Compare canonical JSON values: immutable Automerge maps and transaction
   drafts may enumerate identical keys differently after edits. Keep the
   history-bearing `lastError` regression in `googleSyncPlan.test.ts`.
4. Network/worker failure retains the queue and old cursors. No local-only delete
   success while Google acknowledgement is pending.
5. Do not replace the entire workspace with a worker snapshot. Apply only changed
   entries through the existing Automerge transaction/persistence queue.
6. A recorded import error requires a full calendar read on the next explicit
   sync; an unchanged delta alone cannot repair a missing local mirror. Clear
   the error only with the successful import, keeping events and cursors atomic.
7. The initial Google read is bounded to one year behind and one year ahead.
   Future recurrence rows inside UTM are projections of one series template;
   opening a row must not persist it. Materialize a cycle only in the same
   transaction that edits, completes, moves or deletes it.
8. A cancelled Google instance is a recurrence exception, not a deleted UTM
   item. Store its anchor in `exdates`; if its master is cancelled in the same
   response, store neither the instance nor an exception.
9. Activation may compact old cancellation garbage only when a deleted open
   occurrence exactly matches the cycle generated from its live series and has
   no completion, timer, override, progress or cycle history. Keep its tombstone
   and rebuild current Automerge state before verified persistence. Any mismatch
   is retained for review rather than guessed away.

## Focused verification

Run `pnpm test:google:focused`, `pnpm --filter @utm/web typecheck`, and
`git diff --check`. Use the Google mobile smoke test for a real browser worker;
unit coordinator tests mock only that boundary and are not worker coverage.
`pnpm ios:prepare` packages the web bundle; it is not an Xcode/device test.

## Diagnostics and remaining limits

The additional `utm:sync-trace:v1` ring holds at most 240 numeric checkpoints,
exported by the existing Diagnostics export. A random run ID groups attempts;
`boot` marks a new JS lifecycle, not a confirmed OS crash. Checkpoints include
patch validation/write progress (each 100 entries), Automerge commit completion,
React update enqueue/effect, synchronous serialization size, persistence worker,
encryption, IndexedDB and foreground heartbeat delays. No item IDs/content or
exception strings are accepted. Diagnostics disable/clear also applies to it.
The heartbeat cannot execute during a JS stall; it records the delay after
recovery. A terminated process leaves only its last durable checkpoint.

Device export 8 (2026-09-28 10:10 Moscow) measured download 3095ms, snapshot
115ms, worker calculation 193ms, apply 11173ms, and total sync 68682ms. Thus the
worker calculation is not the bottleneck in this reproduction. Detailed traces
are needed to distinguish patch writes, Automerge finalization, render and save.

`Google sync stage: queue/download/snapshot/calculate/apply/persist` records
started/succeeded/failed, elapsed milliseconds, and no IDs, titles or tokens.
The last unmatched started record identifies the phase interrupted by a freeze.
Download timing does not prove CPU blocking. Persistence timing includes waiting.

Worker calculation is isolated, but final Automerge commit remains synchronous.
Large patches or a single huge item can still be slow; inspect `apply`/`snapshot`
timings before changing storage architecture. Legacy recovery lookups and outgoing
writes use existing request deadlines, not the worker deadline. Authentication
has its own native lifecycle. This is not proof that every device freeze is fixed.

On iPhone: launch and use navigation, run manual Sync and navigate during it,
export diagnostics afterwards. Check one-occurrence and future-scope edits,
calendar move without duplicate items, and scoped deletion on a test event.
Do not use real events for destructive test fixtures without explicit approval.
# Local save checkpoints (3.4.3 local recovery fix)

Every save now has an independent random trace ID, including backup timestamp
updates outside Google sync. `save-begin` must end with `save-end` or
`save-failed`; an unmatched run across `boot` indicates interruption, not its
cause. Check the last completed stage: serialize, snapshot, export-filter,
export-encode, storage-worker, encrypt, indexeddb, mirror. `heartbeat.lagMs`
measures UI scheduling delays; `save-timeout` identifies worker timeout.
Only whitelisted numeric sizes/counts/times are retained in the bounded ring.

Live persistence retains the original Automerge binary/history. The encrypted
export-safe block now contains `UTM-RECOVERY-JSON-1\n` plus filtered JSON; no
second WASM instance/CRDT reconstruction is needed on each save. The SDK local
decoder accepts both old Automerge blocks and this snapshot encoding. New
recovery snapshots require this or a later build; old backups remain readable.
Do not interpret the decrypted snapshot as Automerge bytes in external tools.
Encryption is authenticated and verified byte-for-byte before an atomic commit
of live block, recovery block, receipt and mirrors. Filtering policy is unchanged.
Use `playwright.recovery.config.ts` with an explicitly supplied private fixture
to exercise edit/save/reload and restore of the new recovery block. Captures
are disabled; this is desktop WebKit evidence, not physical iPhone evidence.
# Agenda responsiveness

`HeaderAgenda` sends a detached agenda-only projection to `agenda.worker.ts`.
The existing `agendaWidgetSnapshot` algorithm is unchanged. Its input key ignores
descriptions, organization, revisions, sync/backup metadata and time-tracking
durations. Relevant schedule, recurrence, completion, deletion, program, locale,
timezone and sleep-selection changes invalidate it. Foreground/enable and the
existing 30-minute refresh still refresh the widget. Superseded work terminates;
worker failures retain the previous native snapshot and never retry on the UI
thread. The synchronous in-app header status is not moved in this change.

Slow `Agenda worker calculation` records measure worker compute time. `UI input
dispatch` measures event timestamp to handler; `UI input to frame` measures handler
to a frame opportunity, not completion of asynchronous business operations.
Only trusted pointer/click events in the foreground are considered. No text,
coordinates, selectors, targets or keyboard values are read. Delays below 1500ms
are not logged and repeated slow records are throttled. Diagnostics opt-out applies.
`playwright.agenda.config.ts` tests a real worker in desktop WebKit using synthetic
recurrences and checks exact output equality with the old synchronous algorithm.
