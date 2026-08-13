# Universal Task Manager

An English-only, installable, local-first PWA built around one universal item instead of separate task, event, and habit silos.

## What works

- Universal items with schedule, duration, Markdown, progress/habit data, reminders, links, relations, tags, contexts, priority, and custom/formula fields.
- RFC 5545 recurrence, materialized occurrence history, deterministic catch-up, and honest `auto_closed` state.
- Safe expression DSL for saved views, formulas, and automation conditions. It never calls `eval` and only exposes allowlisted functions.
- Internal `if → then` automation actions with idempotency keys, causation depth, loop protection, missed-run policies, and an execution log.
- Configurable dashboards with list, table, calendar, board, habit, and Markdown widgets.
- Password-locked local storage and encrypted `.utm` transfer files using Argon2id and XChaCha20-Poly1305.
- Automerge history inside `.utm` files for deterministic manual merging between devices.
- Canonical JSON, JSON Schema, iCalendar import/export, and a CLI/SDK.

## Run locally

Node.js 22+ and pnpm are required.

```bash
pnpm install
pnpm build
pnpm dev
```

Open the printed local URL. The app works offline after the production PWA has loaded once.

## Verification

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
```

The core test suite covers weekly auto-renew catch-up, end-of-month recurrence, exclusions, idempotency, formula cycles, automation loops, encrypted-container tampering, wrong passwords, CRDT merge, and iCalendar re-import.

## CLI

Build first, then provide the password through an environment variable. Plaintext is written only to stdout.

```bash
export UTM_CONTAINER_PASSWORD='your long password'
pnpm utm validate workspace.utm
pnpm utm unlock workspace.utm --format json
pnpm utm unlock workspace.utm --format ics
pnpm utm merge device-a.utm device-b.utm > merged.utm
pnpm utm from-json workspace.json > workspace.utm
```

Redirecting JSON or ICS output to a file is an explicit creation of plaintext data. The PWA itself exports only encrypted `.utm` containers.

## Repository

- `apps/web` — responsive React PWA and encrypted IndexedDB integration.
- `packages/core` — Apache-2.0 domain model, schema, recurrence, DSL, formulas, automations, and interoperability.
- `packages/sdk` — Apache-2.0 encryption, Automerge container, storage adapter, SDK, and CLI.

## Security boundaries

- The local data key is random. The password derives a wrapping key through Argon2id with a minimum of 19 MiB memory and two operations.
- Workspace blocks are authenticated with unique-nonce XChaCha20-Poly1305 and associated data.
- The password and unwrapped data key are memory-only. Locking zeroes the in-memory key; a full restart requires the password again.
- There is no recovery key or server. Losing the password means losing the workspace.
- Closed-app exact alarms, remote push, accounts, realtime sync, webhooks, arbitrary JavaScript, and binary attachments are intentionally outside this MVP.

Core and SDK packages are licensed under Apache-2.0. The web product shell is currently unlicensed/proprietary.
