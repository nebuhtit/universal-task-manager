# Incremental calendar computation

The mounted calendar owns bounded, read-only caches. They are not persisted and
require immutable workspace snapshots (including Automerge documents). Virtual
occurrences remain projections, never workspace writes.

## Invalidation

- Normalization/Google projection is shared by the navigator and Timeline.
  Recurrence projection is cached per series and range; changing an unrelated
  item does not expand unchanged series again. Four ranges per group are kept.
- The projected workspace/index is reused while its source and projected items
  stay unchanged. Filters still evaluate against the current semantic time.
- Day sorting/statistics reuse their result when membership, item content,
  reserves, view settings and workspace-wide context match. Moving an item
  invalidates its old and new day. Global settings invalidate conservatively.
- Remaining capacity has a separate minute clock. Only today's result depends
  on the current time; other days reuse full-day capacity. Up to 62 days are kept.
- Timeline preparation is separate from minute-based provisional placement.
  Moving the current-time line or tentative tasks does not expand recurrence.
- Calendar membership updates at local/UTC midnight, schedule boundaries
  (including virtual occurrences and padded long spans), and after foreground
  clock refresh. Strict `< now` and inclusive `<= now` boundaries are distinct.
  Continuous expressions such as `minutesUntil(...)` or `now()` keep one-second
  evaluation. Displayed scripts in both List and Timeline are considered.

This is not a full dependency graph: distribution/filtering still scans the
candidate set after a meaningful change, and global changes deliberately favour
correctness over minimal invalidation. Cold-load cost remains a separate target.

## Reproducible checks

`pnpm exec vitest run apps/web/src/features/calendar/calendarCaching.test.ts`
checks cached/uncached equivalence, unchanged metric identity, one-day edits,
moves, Automerge snapshots, deletion, series changes, hidden completed items,
reserves, time zones, clock rewind, and temporal predicates.

`UTM_PERF_BASELINE=1 pnpm exec vitest run apps/web/src/performance/calendarCachingBaseline.test.ts`
compares synthetic 100/1000/10000-item workspaces and logs timings/counters.
No personal workspace or calendar connection is used. Timings are observational,
not CI thresholds.

Local sample on 2026-09-23 (milliseconds; one run, not a device benchmark):

| Items | Cold cached | Repeated evaluation | Uncached evaluation | One item edit |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 22.90 | 4.45 | 9.53 | 6.59 |
| 1000 | 113.86 | 25.65 | 55.95 | 55.14 |
| 10000 | 851.74 | 322.61 | 1028.70 | 676.14 |

All three workloads matched the uncached results. Repeated evaluation built no
new projected index and recalculated no day metrics. A one-item edit recalculated
one day out of seven. Ordinary clock ticks in the page skip this evaluation
entirely; the repeated-evaluation measurement intentionally calls it anyway.

`pnpm exec playwright test tests/e2e/timeline.spec.ts --workers=1` covers the
browser clock threshold and minute capacity updates without workspace writes,
alongside existing Timeline scenarios. Mobile WebKit simulation is not a physical
iPhone/PWA test.

Verification on 2026-09-23: 1111 unit tests passed (three opt-in performance
tests skipped in the normal run); the calendar benchmark above passed separately.
All eight existing Timeline browser scenarios passed. Both added clock scenarios
passed in desktop Chromium and mobile WebKit after correcting the test assumptions
about rounded-up minutes and capacity during an already occupied interval.
Repository typecheck, production builds and `git diff --check` passed. Existing
large-bundle warnings remain; this change does not address bundle loading size.
