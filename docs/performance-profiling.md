# Performance profile v1

## 3.5.3: Home evaluation and focus

Diagnostics 43: six saves succeeded (maximum 525 ms); 598 selections scanned
1,169,090 items. Home duplicate suppression alone ran 29 times. Nested timings
must not be added to evaluation totals.

Home evaluates only expanded Views and shares results with duplicate suppression.
Its cache uses immutable workspace, View, completion version and temporal boundary.
Collapsed entries are evicted, so reopening reads current data/time. Continuous
expressions retain a one-second clock. Save-status renders reuse cached results.
List cards have stable action adapters and memoization; workspace changes remain
a conservative invalidation because scripts and organization fields can depend on
other items. Fine-grained cross-workspace card invalidation is not claimed.

Title's day preview starts after a frame/task on focus. Fixed stages
`editor.preview` and `editor.suggestions` measure work without recording text.
This does not prove native keyboard latency is solved; compare a fresh iPhone export.

Release tests exposed stale titles in cached calendar projection rows. Changed
groups now refresh on content-only edits; unchanged series keep their projections.

Purpose: establish a measured baseline before changing scheduling, caching or persistence. Instrumentation observes existing work; it does not alter filters, recurrence, storage policy, Google transaction boundaries or UI layout.

## Collect a comparable run

1. Install the locally prepared iOS build, or load a freshly built web origin. Do not compare profiles from different `version`, `commit`, `dirty`, `builtAt` or `environment` values accidentally.
2. Keep troubleshooting diagnostics enabled. Perform a short sequence: Home → Calendar → List → Timeline → List; open one item, edit its title, Save. Repeat the same sequence once for warm caches. Run manual Google sync separately.
3. Export diagnostics from Settings immediately afterward. Export reads current memory, so there is no need to wait for the batch timer. The existing `utm-diagnostics.json` array contains entries with `operation: "Performance profile v1"`; each `details` is a JSON profile.
4. Compare the same device, data and sequence. Separate cold/warm runs and user work from Google sync. Desktop numbers and Chromium mobile emulation do not prove physical iPhone behavior.

## Read one action

`actions` retains the last 40 trusted pointer, click, input or keydown events. Specialized labels include `calendar-list`, `calendar-timeline`, `item-save`, `google-sync`. The numeric action ID is ephemeral; it is not an item or workspace identity. A single physical gesture may generate both pointer and click events; these are separate observations, not two business operations.

| Field | Meaning |
| --- | --- |
| `dispatchMs` | Event timestamp to the document capture listener. Unsupported/future timestamps give zero, not a guessed delay. |
| `handlingMs` | Capture listener to document bubbling, including synchronous React handlers. Absent if propagation was stopped before that listener. Does not claim asynchronous completion. |
| `firstCommitMs`, `lastCommitMs` | Capture to observed layout effects in App/Home/Calendar/editor. These are commit-boundary observations, not isolated React render CPU time. |
| `commitObservations` | Number of those observations, potentially several surfaces for one React commit. |
| `frameMs` | Capture to the first shared animation-frame callback and following task. A frame opportunity, not proof of GPU paint or network completion. Absent for interrupted/hidden observations. |
| `spans` | Up to 24 calculation/storage stages associated with this action. Main-clock entries have `offsetMs` relative to capture. Worker entries have their own measured duration, without an invented cross-thread offset. |
| `caches` | Up to 12 aggregated cache/reason combinations observed while this action was active. |

Async persistence carries the originating action ID through the latest-wins queue and serial writer. It is not attributed to the next click. Google sync preserves its origin across authorization. Once an action leaves the 40-entry ring, background timings remain in session aggregates. Background renders after the first frame are not fabricated as that action's UI commit.

Stages are nested and inclusive: do **not** add `calendar.evaluate` to its nested projection/sort times or `save.total` to preparation/write times. Waiting durations are wall-clock latency, not main-thread CPU blocking. User callbacks/OS painting that have no instrumented boundary are not reconstructed.

## Calculations and caches

`aggregates` contains count, total, maximum and p50/p95 for each fixed stage. Counts/totals cover this JS session; percentiles cover the latest 64 samples of that stage (`sampleCount`), not all-time percentiles. Fast observations are retained too; there is no 1.5-second threshold.

Measured layers: workspace indexing; view filtering/evaluation/sorting; Home deduplication; calendar mapping, recurrence group/range projection, daily signatures/evaluation, capacity, planning and Timeline preparation; item preparation and workspace commit.

Metrics are existing counts, not extra scans solely for logging: `scanned` inputs, `matched` outputs, `recalculated` inputs/outputs processed by the measured operation, `rows`, `days`, `bytes`, `calls`, `coalesced`, `failed`. They are not unique item counts across stages: the same object may be processed repeatedly. Each cache/reason has `hits`, `misses`, `objects`; objects accumulate reported work on misses, not the number of live cache entries.

Reasons are finite categories: initial empty cache, uncached snapshot/range, workspace timestamp/reference, view reference, completion state, time boundary, schedule/day signature, content-only mapping or other inputs. `unchanged` denotes reuse. These describe the actual branch taken, not an inferred property diff. No signature, query, item ID or date key is exported.

## Persistence

Follow-up gap measurements: `agenda.header` measures the header's synchronous recurrence calculation; `agenda.input` includes widget staging and signature preparation, with nested `agenda.project` for horizon projection. `reminders.prepare` measures local/native reminder preparation and `notices.filter` notice visibility. These preserve existing computation/cache behavior and export no content or signatures.

`save.worker-startup` is creation to receipt of the ready message (imports, startup and main-thread delivery combined, not worker CPU). `save.worker-delivery` measures final response posting to receipt using the same-device wall clock; negative or timeout-sized clock adjustments are ignored. Large delivery latency plus heartbeat lag indicates a busy/suspended main thread rather than slow worker computation. A ready marker does not change save ordering, timeout or worker lifetime.

| Stage | Meaning |
| --- | --- |
| `save.queue` | Last retained enqueue to start, including debounce/active write; counts superseded pending values in `coalesced`. |
| `save.serial-queue` | Waiting behind the shared serial writer. |
| `save.total`, `save.prepare` | End-to-end save and its preparation (inclusive, async). |
| `save.serialize`, `save.snapshot`, `save.transfer` | Main-thread serialization, snapshot and `postMessage` transfer/structured clone. |
| `save.worker-wait` | Request to delivered reply: scheduling, worker computation and delivery combined. |
| `save.worker-work`, `save.worker-filter`, `save.worker-encode` | Duration measured **inside** the worker. Comparing with worker wait distinguishes computation from delivery/scheduling delay. |
| `save.encrypt`, `save.write`, `save.mirror` | Preparation encryption, IndexedDB commit and optional mirror. Async duration does not imply a blocked UI thread. |

Google queue/download/snapshot/calculate/apply/persist stages and `google.worker-work` are separate from local persistence. Existing incident/startup traces remain separate. A worker timeout can leave partial stages with `failed: 1`; an interrupted export does not prove an OS crash.

## Batching, limits and privacy

- Counters and bounded recent samples live in memory. Input/render callbacks do not stringify profiles, touch workspace persistence or write the profile to storage.
- About every 10 seconds a single batch is scheduled (idle callback where available, with bounded timeout). Hide/pagehide and cleanup flush outstanding data. Only a dirty profile is written. The current and one previous run are retained under `utm:performance-profile:v1`.
- Existing high-volume sync progress/heartbeats are batched too; begin/end/failure boundaries stay durable for interruption diagnosis. These small recovery checkpoints are not per-input logging.
- Clearing diagnostics clears pending profile/trace buffers; disabling diagnostics stops new observations. Storage failure preserves bounded memory data for export/retry and does not fail a save.
- Only allowlisted stage/action/cache/reason names and finite numbers enter the profile. No event titles, input values/keys, selectors, coordinates, item/workspace/account IDs, URLs, error strings, passwords or tokens. Stored profiles are sanitized again before export.

## Developer checks

Header follow-up (diagnostics 42): `agenda.header` was 6.96–7.13 seconds on the main thread; widget staging was at most 20 ms. The unchanged selector now runs in `headerAgenda.worker.ts`. `agenda.header-input` measures detached input preparation, `agenda.header-wait` the asynchronous round trip, and `agenda.header` the worker's own duration. Seconds continue to update from the last accepted result. The runner permits one active request, coalesces later changes, ignores obsolete replies, and recalculates at a time boundary or clock rewind. Selection inputs exclude unrelated metadata and are never written to diagnostics.

Persistence now reuses its JSON-only worker; the old per-save termination was left over from the removed WASM-loading implementation. No snapshot is held globally in that worker. Failures still preserve the old durable record and pending latest state. Trace events distinguish worker load/startup, runtime, response decoding, transfer, and calculation failures, without error strings or URLs. Late errors from a replaced worker are ignored.

Focused regression coverage: `headerAgendaWorker.test.ts` (slow results across ticks, latest-wins, time boundaries, rewind, failure/retry, selection equivalence), `persistenceWorkerLifecycle.test.ts` (worker reuse, unchanged history, failed-write boundary, stale errors), and `header-agenda.spec.ts` (seven-second delayed worker reply while controls remain usable and the previous header stays visible).

Follow-up verification on 2026-09-30: 48 focused unit tests, all three scale/history baseline tests, workspace typecheck/build, and six browser scenarios passed. Browser coverage used desktop Chromium and iPhone-viewport Chromium, not physical iOS. Header geometry/countdown and previous-result retention were checked with the actual production worker; the seven-second response delay was deliberately injected. The unchanged 100-item behavior hash remains `9c5800e7`; larger fixtures still compare membership/metrics against the independent reference. Native packaging is the device handoff, not device verification.

Focused tests: `performanceProfile.test.ts`, `inputLatency.test.ts`, `syncTrace.test.ts`, `workspacePersistence.test.ts`, `workspaceSaveService.test.ts`, `googleSyncWorker.test.ts`. `tests/e2e/performance-profile.spec.ts` covers trusted browser events, Save/worker timings, List/Timeline labels and diagnostic privacy on desktop/mobile Chromium. Use a fresh `PLAYWRIGHT_PORT` to avoid inspecting an old build.

Local verification on 2026-09-30: 123 focused unit/integration tests and two production-build browser scenarios passed (desktop Chromium and iPhone-viewport Chromium, **not** physical Safari). Workspace typechecks, web/native packaging and the three scale/history behavior baselines passed. The dedicated cache suite still has a pre-existing failure in `reuses an unchanged series projection when an unrelated item changes`: a title-only edit reuses an old projected title. Reproduced with the exact `HEAD` cache implementation without profiling; neither its behavior nor its assertion was changed in this instrumentation step.

Keep behavior baselines unchanged: `pnpm performance:baseline`, `pnpm performance:history`. They check 100/1,000/10,000-item and history-bearing fixtures; they do not establish iPhone interaction latency. Do not silently change a failing behavior hash or a cache test to make instrumentation pass.
