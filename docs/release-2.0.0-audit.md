# 2.0.0 release audit — 2026-09-07

Prepared after publishing 1.99.16 (`f6888f0`).

## Correctness

- Calendar hidden-completed statistics now include `auto_closed`, as home views do. The ordinary task filter, day membership and explicit exclusions still apply.
- Items-only and calendar views no longer block Save because of an unused project filter. Imported result-type order is normalized for the native selector.
- Empty recurrence reconciliation returns the original Automerge document instead of adding timestamp-only history and triggering a full save.
- Timer audio attempts recovery from Safari's interrupted state as well as suspended state. A live alarm retries when returning to the page or interacting, and removes listeners/audio nodes when stopped.
- Note sits beside Title above its input; the timer disclosure has reduced vertical padding with the normal touch target retained. Timer behavior and history rules are unchanged.

## Performance verification

`node scripts/benchmark-calendar-date-keys.mjs` compares 5000 date conversions against the former uncached formatter and asserts identical output. Measured locally: 535 ms uncached, 29 ms cached. The cache is bounded to 32 explicit timezones; system-default formatting and invalid-zone fallback remain unchanged.

`pnpm performance:baseline` compares real result membership and metrics with a reference implementation at 100, 1000 and 10000 synthetic items. All sizes passed. One observed 10000-item run: combined evaluation 2887 ms, views/statistics 1424 ms, calendar week 361 ms, Automerge load 2212 ms. These are synthetic local measurements, not proof of faster entry for a user's historical encrypted workspace.

Fixture creation-version metadata is fixed so a release-number change does not invalidate export-byte checks. The small golden behavior snapshot remains; the extended check directly compares membership and metrics rather than stale historical serialization hashes.

## Limits

- Background sound on a locked iPhone remains controlled by Safari/iOS. Browser emulation and audio graph tests cannot confirm audible real-device playback.
- Real historical workspace unlock latency still needs a fresh diagnostic measurement.
- Existing large-bundle warnings remain; this release does not change bundling architecture.
