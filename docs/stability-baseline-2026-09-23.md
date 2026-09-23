# Stability work baseline, 2026-09-23

Measured locally on macOS/Node 26.7, working tree based on `accf148` (2.9.4).
Synthetic data only. These are observations, not UI latency guarantees or CI timing thresholds.

| Items | Views + statistics | Calendar week | Recurrence | Automerge save | Automerge load |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 12.17 ms | 9.37 ms | 3.70 ms | 4.87 ms | 52.65 ms |
| 1,000 | 95.23 ms | 44.39 ms | 16.89 ms | 16.49 ms | 195.46 ms |
| 10,000 | 1,497.88 ms | 692.93 ms | 709.92 ms | 164.89 ms | 1,808.86 ms |

`pnpm performance:baseline` passed the independent membership/metrics comparisons at all sizes. Current behavior hashes: `cc34d191`, `7043c43c`, `3879049f`; reference hashes: `b583e5ef`, `444f240e`, `02109b73`. Historical hashes also encode export size/version; the independent comparisons remain the semantic check at scale.

`pnpm performance:history`: 1,000 items and 2,000 actual Automerge edit transactions produced 214,932 bytes; save 17.94 ms, load 202.40 ms, one edit after reload 2.36 ms. Heads and item count survived save/load. This bounded fixture does not represent every possible long-lived document.

## Decision

Do not replace Automerge or change persistence guarantees based on these measurements. At 10,000 items, selection/statistics and recurrence deserve browser profiling before serialization architecture changes. No performance improvement is claimed for the command extraction.

Next measurements requiring separate evidence: physical iPhone Safari/PWA, interaction-to-paint for large calendars, cold start with large real-world history, IndexedDB pressure and OS suspension. Do not treat Chromium emulation as completion of that device matrix.

## Verification of this increment

- Unit/integration suite: 1,086 passed, two opt-in performance tests skipped in the normal run (measured separately above).
- Typecheck, production build, build-output isolation check and `git diff --check` passed.
- Google browser suite covers offline retry/quota, conflict/lost edit response with preserved journals, lost create response with stable identity, calendar move, confirmed detachment and reload with preserved duration. API/OAuth are mocked; no live account is touched.
- The browser detachment case permits an identical DELETE retry after reload before durable acknowledgement; the mock returns 410 on that retry and records only one remote deletion effect.
- Native disclosures are exercised with keyboard Space. Pointer/touch disclosure behavior and physical iPhone coverage are not established by these tests.

No version bump or deployment is included. This is a working-tree increment on 2.9.4, not a claim that the entire fault/device matrix or application-service extraction is complete.

## Follow-up: save coordinator

The next increment extracts Google queue dispatch, write results, series editing/refresh and recurrence-completion commands into `workspaceSaveService`. Session/connection guards reject late replies. Acknowledged deletion receipts prevent delayed Google snapshots from recreating detached events; editor saves retain those receipts.

Nine coordinator integration tests use real Automerge save/load and mocked Google transport. They simulate losing the local acknowledgement after successful create/delete/occurrence edit/series edit, discard volatile state, reload durable bytes and retry. They also cover simultaneous Save, failure before sending, old-session replies and calendar metadata refresh after writes. This does not establish physical iPhone process-kill behavior.

During verification, tests exposed and fixed a post-acknowledgement stale-sync duplicate, unsupported list `flatMap` on an Automerge transaction proxy, and proxy reuse when replacing calendar preferences. No user-data migration, version bump or deployment accompanies this increment.

Browser engine clarification: the existing iPhone 13 Playwright device preset uses WebKit. This is desktop WebKit with mobile emulation, not physical iPhone Safari/PWA. The dedicated Google suite now runs one worker and CI installs Chromium and WebKit.

Follow-up verification: 1,096 unit/integration tests passed (two opt-in performance tests skipped); all six Google E2E scenarios passed on desktop Chromium and mobile-profile WebKit. Typecheck, full production build and `git diff --check` passed. Existing large-bundle and Obsidian output-directory warnings remain. Earlier browser runs exposed one actual metadata-refresh regression (fixed with a coordinator test) and cold-load timeouts under parallel load; the final serial run passed without retries.
