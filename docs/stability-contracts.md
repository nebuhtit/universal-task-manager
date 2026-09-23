# Stability contracts

## Identity and time

- A root series owns recurrence rules. A materialized cycle owns an occurrence identity; editing it must not create another series.
- One logical cycle is identified by root series and recurrenceId, never by title.
- UTM identity, history and estimates survive Google detachment. Google occupancy is not the UTM estimate.
- Duration may exist without Event ends. Clearing Event ends must not clear Duration or silently recreate the end.
- An active range is start through Due. Daily allocation applies only inside that range.
- Remote deletion requires explicit confirmation. The local detachment and durable deletion intent are committed together, before networking.
- A lost response is not evidence that the remote operation failed. Retries reuse the persisted operation identity.

## Read-only audit

`inspectWorkspaceIntegrity(workspace)` reports semantic inconsistencies independently of schema validation. Its output contains issue codes and local item IDs, not titles, tokens or event contents. These are findings for review, not instructions to delete records.

No automatic repair is performed. A future repair must first create and verify an encrypted recovery backup, provide a before/after report, preserve history and references, and be tested for idempotency. Never merge by equal titles.

Run `pnpm audit:workspace path/to/backup.utmb` with `UTM_AUDIT_PASSWORD` supplied privately in the process environment. JSON snapshots need no password. The command only reads the file and prints a report; it never imports into IndexedDB. Exit code 2 means findings or invalid schema. Decrypted backup exports omit cached Google records, so a clean backup report does not prove the live Google cache is healthy.

## Transaction boundary

`saveItemInWorkspace` runs inside the existing Automerge commit. It preserves pending operations, records detachment, updates organization and applies recurrence/automation effects. Persistence must complete before external writes. UI passes an explicit save intent and handles display/confirmation; it does not own domain mutation rules.

`createWorkspaceSaveService` owns local item saves, Google queue draining, single-event and series writes, result application, series refresh and recurring-completion commands. App and the editor supply intent and display progress/errors; they do not coordinate those transactions. Google protocol adapters remain separate and testable. Each asynchronous workflow captures the unlocked session and connection identity and rejects late results from an obsolete session.

The queue records intent before sending a request. A retry reuses the creation ID or reads back an attempted edit instead of applying a series shift twice. A series operation remains pending until its refreshed projection is persisted. Per-item in-flight guards reject simultaneous saves.

Acknowledged deletions retain `utm:googleDeletionReceipts` (account, calendar, event ID and deletion timestamp). Incoming delayed snapshots cannot recreate that event after its pending operation has been removed. A stale editor draft cannot erase the receipts. These are synchronization metadata, not task history or instructions to delete other items; unrelated identities are unaffected. No migration or automatic repair of existing user records is performed.

## Release evidence

Required: unit/integration tests, typecheck, production build, diff check, mocked Google browser smoke tests on desktop/mobile. Browser emulation does not establish physical iPhone Safari/PWA behavior.

Fault matrix: failed durable write; offline before send; lost response after remote success; repeated Save; expired authorization; reload with a pending operation; repeat synchronization. Assert stable identity, preserved latest draft, no duplicate occupancy and no restored cleared field.

`pnpm test:google` starts its own dev server and mocked OAuth/API on an isolated browser context. It covers desktop Chromium and Playwright WebKit with an iPhone viewport (not a physical iPhone/PWA). The Pages workflow installs both engines and runs it before publishing. Set `PLAYWRIGHT_PORT` if the default port is occupied; never run a package build concurrently with this dev-server suite (dependency rebuilds can trigger HMR reloads).

`workspaceSaveService.test.ts` injects failure after remote success but before the acknowledgement reaches durable storage, discards the service/session/document, and restores only the previously saved Automerge bytes. It covers create, delete, occurrence edit and series edit, plus old-session replies, repeated Save and initial persistence failure. Assert one remote effect, one local identity, retained Duration and no restored Event ends/calendar tag. The deletion test also applies delayed incoming snapshots after acknowledgement and another reload.

These are deterministic simulated crashes, not physical process termination. OS suspension and real IndexedDB quota pressure still require device coverage. A rejected persistence callback proves no request is sent before persistence, not survival of every possible storage failure.

Performance changes require fresh 100/1,000/10,000-item measurements and a history-bearing workspace. Preserve behavior hashes; do not update them merely to accept a regression.
