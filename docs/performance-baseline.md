# Performance and behavior baseline

This baseline is the safety net for internal performance work. It creates the
same mixed workspace on every run with 100, 1,000 or 10,000 items and records
both behavior and elapsed time. Refactors must preserve the behavior hashes and
the explicit membership assertions; timing numbers are observations, not flaky
pass/fail limits.

## Reproduce

Run the full benchmark explicitly:

```sh
pnpm performance:baseline
```

The normal test suite always runs the strict 100-item behavior contract. The
extended sizes only run when `UTM_PERF_BASELINE=1`, which the command above sets.

The fixture clock is fixed at `2026-09-03T09:00:00.000Z` and its timezone is
UTC. The generator lives in
`apps/web/src/performance/performanceFixture.ts`; large generated JSON files are
not committed to the repository.

## Protected result

For every generated workspace the snapshot includes:

- membership and exact order of every fixture View;
- Calendar membership for each day of a fixed seven-day window;
- View statistics, completion percentages and free time;
- recurrence reconciliation output;
- absolute and relative reminder resolution;
- Unified priority rank for every item;
- canonical export and import counts.

The independent linear membership implementation is checked against the
current selector at 100 items in every test run and at all three sizes in the
extended run. The 10,000-item production path is guarded by the same explicit
membership comparison and locked behavior hashes.

Expected hashes:

| Items | Current implementation | Linear reference |
| ---: | :--- | :--- |
| 100 | `4ab5f120` | `51d0eea2` |
| 1,000 | `9493f8f4` | `d8c705d0` |
| 10,000 | `3f8bf015` | `05656545` |

Changing a hash requires reviewing the readable assertion failure and proving
that the product behavior was intentionally changed. Do not merely replace a
hash during an optimization.

## Recorded baseline

Recorded on app `1.96.5`, commit
`e202a74153e400250d09b49e57d6a1cfab9a0158`, macOS 26.7 arm64, Node 26.7.0 and
pnpm 11.19.0. Times are one representative local run and will vary by machine.

### Selection and domain behavior

| Items | Fixture | Current behavior | Views + statistics | Calendar week | Unified priority | Recurrence | Export + import | Linear reference |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 2.41 ms | 263.88 ms | 213.79 ms | 33.37 ms | 8.48 ms | 3.11 ms | 4.99 ms | 98.28 ms |
| 1,000 | 15.04 ms | 17,411.69 ms | 16,447.63 ms | 312.57 ms | 599.10 ms | 19.55 ms | 32.37 ms | 911.68 ms |
| 10,000 | 125.74 ms | skipped | skipped | skipped | skipped | included in reference | included in reference | 11,570.53 ms |

Reminder resolution was 0.05 ms at 100 and 0.41 ms at 1,000 items. It is kept
inside the behavior hash even though it is too small to dominate this run.

At 1,000 items the current behavior exceeds the deterministic 10-second safety
threshold. The runner therefore skips the full current selector at 10,000
items, but still generates the workspace, checks the linear reference hash and
measures Automerge operations. This is a guard against a hung CI job, not a
claim that 10,000-item behavior is acceptable.

### Item tick and Automerge lower bounds

| Items | Create document | Tick one ordinary item | Serialize after tick | Load serialized document | Bytes |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 138.49 ms | 10.54 ms | 4.47 ms | 43.44 ms | 25,713 |
| 1,000 | 438.94 ms | 7.31 ms | 15.60 ms | 174.69 ms | 203,985 |
| 10,000 | 4,131.06 ms | 43.02 ms | 163.71 ms | 1,831.36 ms | 2,017,567 |

The tick measurement changes state, closure, revision and timestamps through
the same Automerge commit helper used by the app. Serialization and load are
raw Automerge lower bounds: IndexedDB work, encryption, React rendering, sound
and animation are intentionally outside these figures. Browser-level latency
must be measured separately when an optimization reaches the UI.

## Interpretation

The first optimization target is View selection and statistics, not reminders
or raw serialization. Going from 100 to 1,000 items makes that stage roughly
77 times slower, which is strong evidence of repeated whole-workspace scans and
quadratic work. The linear reference is already about 19 times faster at 1,000
items while returning the same View and Calendar membership.

After each internal optimization:

1. run the ordinary tests so the 100-item hash and membership remain fixed;
2. run `pnpm performance:baseline` at the milestone;
3. compare stage timings on the same machine;
4. run typecheck and production build;
5. use a browser trace for rendering, interaction and persistence latency.

## Stage 2 result: fewer recalculations

Recorded on the same machine from the local working tree based on commit
`e202a74153e400250d09b49e57d6a1cfab9a0158`. The behavior hashes above did not
change at 100 or 1,000 items; the formerly skipped 10,000-item production path
now completes and has its own locked hash.

| Items | Full behavior before | Full behavior after | Views + statistics after | Calendar week after | Unified priority after |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 263.88 ms | 115.92 ms | 52.87 ms | 34.12 ms | 0.18 ms |
| 1,000 | 17,411.69 ms | 950.37 ms | 554.23 ms | 284.25 ms | 1.98 ms |
| 10,000 | skipped | 9,993.18 ms | 5,986.19 ms | 3,027.28 ms | 68.83 ms |

The 1,000-item deterministic behavior path is about 18.3 times faster. The
speedup comes from reusing compiled DSL plans, calculating organization and
relation indexes once per evaluation, precomputing virtual sort rows, and
sharing one View evaluation between statistics and rendering. UI clocks now
share one scheduler; a normal View is invalidated only when its local date or
a schedule/reminder boundary changes, while continuously changing scripts keep
their one-second precision.

## Stage 3 result: one workspace index per revision

App `1.97.0` adds one immutable derived index for each workspace object. It is
shared by Home Views, Calendar/View clocks, All items, field rendering and the
local reminder queue. The index contains visible/active items, parent and child
relations, Area/Project/Tag ranks, Unified priority ranks, recurrence groups,
resolved reminders, schedule/reminder boundaries and item/View script
definitions.

The latest extended run preserved all six behavior hashes. Building the index
itself remained linear:

| Items | Build workspace index | Read all cached Unified ranks |
| ---: | ---: | ---: |
| 100 | 0.54 ms | 0.02 ms |
| 1,000 | 10.09 ms | 0.28 ms |
| 10,000 | 105.92 ms | 3.37 ms |

These figures isolate the new index rather than claiming an end-to-end UI
speedup from a noisy single run. The important structural change is that every
later relation/reminder/rank lookup is constant-time and no View rebuilds those
maps. Legacy callers that mutate a workspace object in place get a guarded
shape check at the View boundary; normal Automerge revisions use the WeakMap
cache directly.

Formula results, item scripts and View scripts are now evaluated as one result
set per item object (therefore per immutable item revision), then shared by all
displayed fields. Static expressions survive clock updates. Expressions that
depend on the current time are cached only for their exact clock snapshot, so a
countdown still changes every second.

On this run the shared Home View + statistics stage fell from 52.87 to 29.86
ms at 100 items, from 554.23 to 352.53 ms at 1,000, and from 5,986.19 to
4,857.38 ms at 10,000. Calendar timing is not claimed as a Stage 3 gain: the
benchmark deliberately creates seven separate synthetic workspace objects, so
each day correctly receives a separate index. Reusing one calendar projection
is a later optimization with a different correctness boundary.

## Stage 4 result: one Calendar range evaluation

Calendar now projects recurrence once for the visible week or month and creates
one derived workspace for that complete range. Its user filter is compiled once
and evaluated once per projected item. Accepted items are distributed directly
to the dates matched by the selected `event_open`, `event`, `active` and `due`
sources. Each day accumulates its time metrics during that distribution; only
the resulting small day arrays are sorted.

The extended benchmark preserved all six behavior hashes and every explicit
Calendar membership/statistics comparison. On the same machine, representative
Calendar-week times changed as follows:

| Items | Stage 3 | Stage 4 | Speedup |
| ---: | ---: | ---: | ---: |
| 100 | 51.87 ms | 6.05 ms | 8.6x |
| 1,000 | 321.82 ms | 44.75 ms | 7.2x |
| 10,000 | 4,280.57 ms | 611.87 ms | 7.0x |

The remaining cost is proportional to projected occurrences plus actual
item-to-day memberships. It no longer multiplies every occurrence by all seven
or 28–31 visible dates, and month navigation no longer creates one workspace
copy and one workspace index per day.

## Stage 5 result: latest-wins durable persistence

Workspace edits remain optimistic: the immutable Automerge document is exposed
to React immediately. Rapid edits inside an 80 ms window now collapse into the
latest document, and edits received while one write is active collapse into one
following write. Durable writes stay strictly serial, so an older encryption
job cannot finish after and overwrite a newer revision. A failed write is kept
for retry and never rolls the visible workspace back to an unrelated older
document.

In supported browsers the queue sends Automerge changes to a persistent Web
Worker. The worker reconstructs the full CRDT history, serializes it and loads
the exact result for round-trip validation. When Google Calendar data has ever
been present, the privacy-safe export projection is serialized and validated
there too. The already loaded SDK then encrypts both verified byte streams and
authenticates them byte-for-byte before one IndexedDB transaction updates the
active block, export-safe block and verified recovery mirrors.

IndexedDB now reuses one connection until the browser requests a version
change. Explicit flush barriers run before lock, password changes, encrypted or
readable exports, merge/restore, `visibilitychange` to hidden, `pagehide` and
`beforeunload`. Browser shutdown cannot promise unlimited asynchronous time,
so the 80 ms normal write window and the earlier hidden/pagehide barriers are
the primary protection; lock and in-app critical operations refuse to proceed
when the latest write cannot be confirmed.

The `.utmb` container, encryption labels, two migration snapshots, verified
mirrors and Google Calendar exclusion rules are unchanged. The proposed
encrypted Automerge incremental journal is intentionally deferred: it changes
the recovery protocol and needs its own versioned format, crash-injection tests,
compaction rules and verified snapshot migration before it can replace the
current full-block safety boundary.

## Stage 6 result: smaller startup path

The web build now uses `@automerge/automerge/slim` and initializes one separate,
content-hashed Automerge WASM asset before the workspace shell renders. This
removes the embedded base64 WASM copy from the main JavaScript without changing
the CRDT document or encrypted persistence format.

Excel support is loaded only after an `.xlsx` import or export starts. The
Item Editor, View Editor/Home Views, Calendar, Settings and Diagnostics UI are
separate lazy chunks. The PWA precache still contains the app shell, Automerge
WASM and those essential lazy routes, so an already installed build can open
them offline. The optional Excel chunk is deliberately excluded from install-
time precaching; after an online Excel operation the browser may retain it in
its normal HTTP cache, but first-time Excel use is not promised offline.

Representative production output on the same local tree:

| Asset | Before Stage 6 | After Stage 6 | Change |
| --- | ---: | ---: | ---: |
| Startup JavaScript | 7,933.79 kB | 2,048.30 kB | -74.2% |
| Startup JavaScript gzip | 2,580.91 kB | 622.33 kB | -75.9% |
| Automerge WASM | embedded in startup JS | 3,858.16 kB separate | cacheable once |
| Excel JavaScript | embedded in startup JS | 429.19 kB on demand | absent at startup |

The remaining startup chunk is still larger than ideal because the lock shell,
workspace controller, core domain operations and encrypted storage SDK share
one entry graph. Splitting those blindly would risk delaying unlock and recovery;
the next reduction should be guided by a browser coverage/trace rather than a
manual vendor-chunk table.

## Stage 7 result: render-time localization bridge

The main navigation, notification shell, Saved View headings and item result
cards now translate interface-owned labels during React rendering through a
small memoized `t(key)` helper. Workspace-owned names and values are rendered
inside explicit `translate="no"` / `data-utm-user-data` boundaries. A View,
item, Area, Project or Tag called `Home`, `Calendar` or another dictionary key
therefore remains byte-for-byte user data instead of becoming interface copy.

The legacy DOM translator remains only for screens that have not yet migrated.
Its observer queues the smallest added or changed roots, removes overlapping
work, and processes the batch once on the next animation frame. It no longer
walks the complete document for every React mutation. Translation writes are
performed while the observer is disconnected, preventing observer feedback
loops. This is intentionally an incremental migration: remaining screens can
move to `t(key)` independently without changing the workspace or export format.
