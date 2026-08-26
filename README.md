# Universal Task Manager

An English-only, installable, local-first PWA built around one universal item instead of separate task, event, and habit silos.

## What works

- Universal items with schedule, duration, Markdown, progress/habit data, reminders, links, relations, tags, contexts, priority, and custom/formula fields.
- RFC 5545 recurrence, materialized occurrence history, deterministic catch-up, and honest `auto_closed` state.
- Safe expression DSL for saved views, formulas, and automation conditions. It never calls `eval` and only exposes allowlisted functions.
- Internal `if → then` automation actions with idempotency keys, causation depth, loop protection, missed-run policies, and an execution log.
- Configurable dashboards with list, table, calendar, board, habit, and Markdown widgets.
- Password-locked local storage and encrypted `.utmb` backup/transfer files using Argon2id and XChaCha20-Poly1305. Legacy `.utm` files remain importable.
- Automerge history inside `.utmb` files for deterministic manual merging between devices.
- Canonical JSON, JSON Schema, iCalendar import/export, and a CLI/SDK.
- Versioned plaintext packages for items, View definitions/results, and bundles, with conflict preview before atomic import.
- A responsive Month/Week/Day/3-day/Agenda calendar with View filtering, virtual recurrence projection, drag/resize, multi-selection, keyboard move, and Undo.

## Run locally

Node.js 22+ and pnpm are required.

```bash
pnpm install
pnpm build
pnpm dev
```

Open the printed local URL. The app works offline after the production PWA has loaded once.

## Use on a phone

After the GitHub Pages deployment succeeds, open
`https://nebuhtit.github.io/universal-task-manager/` on your phone. Use **Share → Add to Home Screen** on iPhone or **Install app** in Chrome on Android. The phone gets its own encrypted local workspace; use Encrypted Backup & Transfer (`.utmb`) to move or merge data between devices.

### iPhone notifications

Open the installed Home Screen app, not an ordinary browser tab. In **Settings → Notifications**, use **Allow local notifications** to grant iOS permission. This only enables reminders while the app is available on the device.

To enable optional background delivery, tap **Enable background delivery** and enter the notification access code provided by the workspace owner. Without this step the app remains local-only. The free service checks due reminders approximately every 15 minutes, so delivery is not an exact alarm. GitHub Pages only serves the public app; it does not receive workspace data. With detailed lock-screen content enabled, the push service temporarily receives the task title, Start, Deadline, and reminder urgency needed for the push.

## Verification

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
```

The core test suite also covers portable JSON migration, calendar projection/materialization, mixed group moves and recurrence scopes alongside auto-renew, automation, encryption, merge, and iCalendar behavior.

## CLI

Build first, then provide the password through an environment variable. Plaintext is written only to stdout.

```bash
export UTM_CONTAINER_PASSWORD='your long password'
pnpm utm validate workspace.utmb
pnpm utm unlock workspace.utmb --format json
pnpm utm unlock workspace.utmb --format ics
pnpm utm merge device-a.utmb device-b.utmb > merged.utmb
pnpm utm from-json workspace.json > workspace.utmb
```

Redirecting JSON or ICS output to a file is an explicit creation of plaintext data. The PWA warns before every portable plaintext JSON download; complete workspace transfer remains encrypted as `.utmb` (legacy `.utm` imports are still supported).

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
