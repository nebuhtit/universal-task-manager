# Performance profile v1

## 3.5.6: recurring header preparation

Diagnostics 47 showed `agenda.header` up to 25,379 ms in iOS. That is worker
calculation duration, not proof that the main thread was blocked for that time.
Recurrence timezone conversion now shares up to 32 fixed-option Intl formatters.
Dates, timezone rules, DST conversion and recurrence iteration remain unchanged.
Header selection builds the stored-exception lookup once and materializes the
next eligible cycle once, instead of scanning all items for each series and
cloning the accepted cycle twice. No occurrence-result cache was added.

The local historical-series regression fixture contains 2,041 items, including
40 weekly series anchored in 2010 and 400 closed exceptions. Three isolated
selection runs before this change were 703/647/629 ms; afterward 430/423/413 ms
(median improvement about 35%). These desktop results are not iPhone timings.
Reproduce with:

```sh
UTM_PERF_BASELINE=1 pnpm exec vitest run apps/web/src/components/layout/headerAgendaModel.test.ts
```

The fixture always checks the resulting agenda and workspace immutability.
Core tests also exercise DST, interleaved timezones, eviction and invalid zones.
Compare fresh iOS `agenda.header`/`agenda.header-wait` profiles separately from
startup UI commit/frame delays before attributing an end-to-end speedup.

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

Persistence passes current values as JSON text rather than parsing an object on the UI thread and structured-cloning that object again. Parsing is included in `save.worker-filter`; `save.snapshot` now measures serialization only. Compare these stages together when comparing builds. Automerge serialization remains on the UI thread and history bytes are unchanged. Adjacent in-flight saves with identical document, key and storage-mode identities share the same durable-write promise. No completed-result cache is kept; failures retry normally and A → B → A remains three ordered writes. This deliberately does not deduplicate different document wrappers or move the Google durability boundary.

Save status is a controller-local signal consumed only by the banner and Settings release info via `useSyncExternalStore`. A saving/saved transition no longer updates App state. The unload warning reads the signal synchronously, including errors before any UI render; background/page-exit flush behavior is unchanged. Workspace edits and actual error toasts still update their existing consumers normally.

## List interaction baseline (local 3.5.5)

`tests/e2e/calendar-list-interaction.spec.ts` uses synthetic dated tasks and measures Calendar navigation to the first visible card. On local Chromium, 300 title-only cards took 939 ms desktop / 989 ms mobile emulation. This includes calendar evaluation and navigation, **not isolated React card render time**. The existing `long-lists.spec.ts` 1000-row All items fixture mounted 20 cards and opened in 117 / 208 ms respectively. These fixtures are not an A/B comparison or iPhone timings. Repeat on the same machine/build before drawing performance conclusions.

Calendar checks cover planning on/off, one-second hold, post-drop click suppression, three-second completion hold, touchmove cancellation after activation, unrestricted movement before activation, row height after scrolling, and editor focus return. Mobile touch events here are synthetic and do not prove Safari's native gesture arbitration. The All items test also checks search, keyboard access to offscreen chunks, focus retention and dark mode. Chunk windowing remains restricted to non-reorderable All items: applying it to drag lists requires an additional offscreen-target/scroll-anchor design, not simply wrapping the rows. Existing CSS content visibility remains enabled for long View lists.

A repeat on the final local build measured 449 / 390 ms for Calendar and 120 / 176 ms for All items; all eight browser checks passed. This spread is another reason not to attribute total navigation latency to card rendering or claim an iPhone speedup. Isolated card-render profiling and a safe reorderable-windowing design remain follow-up work.

Focused regression coverage: `headerAgendaWorker.test.ts` (slow results across ticks, latest-wins, time boundaries, rewind, failure/retry, selection equivalence), `persistenceWorkerLifecycle.test.ts` (worker reuse, unchanged history, failed-write boundary, stale errors), and `header-agenda.spec.ts` (seven-second delayed worker reply while controls remain usable and the previous header stays visible).

Follow-up verification on 2026-09-30: 48 focused unit tests, all three scale/history baseline tests, workspace typecheck/build, and six browser scenarios passed. Browser coverage used desktop Chromium and iPhone-viewport Chromium, not physical iOS. Header geometry/countdown and previous-result retention were checked with the actual production worker; the seven-second response delay was deliberately injected. The unchanged 100-item behavior hash remains `9c5800e7`; larger fixtures still compare membership/metrics against the independent reference. Native packaging is the device handoff, not device verification.

Focused tests: `performanceProfile.test.ts`, `inputLatency.test.ts`, `syncTrace.test.ts`, `workspacePersistence.test.ts`, `workspaceSaveService.test.ts`, `googleSyncWorker.test.ts`. `tests/e2e/performance-profile.spec.ts` covers trusted browser events, Save/worker timings, List/Timeline labels and diagnostic privacy on desktop/mobile Chromium. Use a fresh `PLAYWRIGHT_PORT` to avoid inspecting an old build.

Local verification on 2026-09-30: 123 focused unit/integration tests and two production-build browser scenarios passed (desktop Chromium and iPhone-viewport Chromium, **not** physical Safari). Workspace typechecks, web/native packaging and the three scale/history behavior baselines passed. The dedicated cache suite still has a pre-existing failure in `reuses an unchanged series projection when an unrelated item changes`: a title-only edit reuses an old projected title. Reproduced with the exact `HEAD` cache implementation without profiling; neither its behavior nor its assertion was changed in this instrumentation step.

Keep behavior baselines unchanged: `pnpm performance:baseline`, `pnpm performance:history`. They check 100/1,000/10,000-item and history-bearing fixtures; they do not establish iPhone interaction latency. Do not silently change a failing behavior hash or a cache test to make instrumentation pass.
## Local 4.6.3 timer and startup checkpoints

- `timer.index`: builds active countdown deadlines on workspace changes, not every second. `matched` counts eligible timers. One wakeup targets the nearest deadline; focus/pageshow/visibility reconcile wall time after suspension. The editor still owns its pending journal while open.
- `timer.state`, `timer.completion`, `timer.reconcile`: queued save duration, failure count, and reconciled item count. Successful samples use the existing bounded in-memory profiler and batch flush; errors use the existing incident log. No item titles, IDs, or timer labels are exported in these metrics.
- Native automatic completion commits history and removal of the running timer together, without first persisting a stopped-only intermediate state. Manual stopwatch/stop-and-count behavior is unchanged. A rejected timer write remains rejected to dependent completion work; a later explicit action can retry.
- Startup `read` separates local storage retrieval from decrypt/load. `first-frame` is the two-animation-frame opportunity after the ready screen mounts, not proof of physical iPhone interactivity. `render completed` still includes the ten-second recovery stability guard; do not interpret that guard as rendering time.
- Initial native widget refresh yields to idle (bounded to 1.5 seconds, 250 ms fallback). Existing native contents remain; reminders, recovery checks and persistence are not deferred. Foreground/settings changes still request refresh immediately.
- `list.measure` measures bounding-box reads for mounted chunks, not total React rendering. Windowing behavior, drag, focus and completion pinning are unchanged. Run `tests/e2e/long-lists.spec.ts` in isolation for wall-time comparisons; competing builds distort results.

Device follow-up: start a one-minute timer on a saved item, lock for two minutes, reopen, then fully restart. Expect exactly one completion with one minute of actual time. Repeat with the editor open and closed. Browser wall-clock-jump tests do not establish iOS background execution or native alarm delivery.

# Private item/view change journal

Settings → Diagnostics → Record private item / view JSON enables an optional, separate encrypted local journal. The ordinary diagnostic export remains content-free. Export private JSON explicitly decrypts it; the resulting file contains personal content and must not be uploaded automatically.

The journal observes controller commits, recording UTC time, app version, operation, IDs and bounded before/after snapshots (including deletions). It records local changes, not durable-save acknowledgement or unsaved editor keystrokes. Limits: 32 operations, approximately 1 MB encoded storage, 10 entities per operation, bounded strings/objects, four queued writes. Bursts and oversized values can be omitted; snapshots expose truncation/omission indicators. The queue yields before encryption/storage and never blocks the persistence queue. Credentials identified by property names are redacted, but arbitrary text can still contain sensitive information. Disabling leaves old entries intact; Clear private journal removes them. This is diagnostic evidence, not a backup.

The native `utm-recovery=1` entry must initialize safe/read-only entry and suppress automatic Face ID. `tests/e2e/recovery-entry.spec.ts` checks this contract with a synthetic biometric bridge; physical iOS process termination still requires device verification.
