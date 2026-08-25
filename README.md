# Universal Task Manager

**One local-first system for tasks, events, habits, recurring work, and personal workflows.**

Universal Task Manager (UTM) is an installable React PWA built around one flexible `UniversalItem` model. A task, calendar event, habit, reusable template, subtask, or recurring series is the same kind of item with different properties — not data locked inside separate applications or incompatible silos.

[Open the web app](https://nebuhtit.github.io/universal-task-manager/) · [Install on a phone](#install-on-a-phone) · [Run locally](#run-locally) · [Security model](#security-and-privacy)

> [!IMPORTANT]
> UTM is currently **beta software**. Your workspace is stored on your device, not in a hosted account. Create encrypted `.utmb` backups regularly. Clearing browser/PWA storage or removing an installed web app can erase its local workspace.

<details>
<summary><strong>Кратко по-русски</strong></summary>

UTM — локальный менеджер задач, событий, привычек и повторяющихся дел с единой моделью данных. Он устанавливается на iPhone, Android и desktop как PWA, работает офлайн, хранит workspace на устройстве и переносит данные через зашифрованный файл `.utmb`.

В приложении есть настраиваемые Views, таблицы и списки, календарь, active range, повторения, напоминания, шаблоны, subtasks, пользовательские поля, безопасные формулы, импорт/экспорт JSON, CSV, Excel и iCalendar, корзина и ручное слияние workspace между устройствами.

Это beta-версия без серверного аккаунта и автоматической облачной синхронизации. Не забывайте сохранять зашифрованные резервные копии.

</details>

## Why one universal item?

Most productivity tools decide in advance whether something is a task, event, habit, note, or record. UTM keeps one extensible item shape and lets its properties define its behavior.

The same item can have:

- a title and Markdown description;
- an active range, scheduled start/end, deadline, and duration;
- one-off or recurring reminders;
- recurrence anchored to the schedule or the previous completion;
- habit completion history or numeric progress;
- priority, tags, contexts, and task-list membership;
- subtasks and typed relations to other items;
- custom fields, formulas, and safe computed script fields;
- links, templates, state history, and recurrence cycle history.

Presets such as **Task**, **Event**, and **Habit** only prefill useful properties. They do not create incompatible item types.

## Feature overview

### Universal items and editing

- Create items quickly from the persistent **Add new task** field and continue editing immediately.
- Use Task, Event, Habit, or Blank as optional starting presets.
- Keep descriptions in Markdown with an in-app preview.
- Organize items with priority levels, tags, contexts, and a single optional list.
- Track state as active/open, done, cancelled, auto-closed, or archived.
- Record the actual completion or cancellation time instead of always using the current time.
- Create independent subtasks that remain normal items and retain parent/child relations.
- Link items as parent, blocking, blocked by, related, duplicate, or a custom relation.
- Save any configured item as a reusable template. Templates stay in the same universal database but are excluded from ordinary views unless explicitly requested.
- Apply a template only while creating a new item; identity, history, and the template marker are not copied.
- Add URL attachments with optional titles and MIME types.
- Inspect and edit the complete item JSON with protected identity and provenance fields.

### Dates, active ranges, and duration

- Keep **Available from**, **Event opens**, **Duration**, **Event ends**, and **Due / Active range ends** as distinct properties.
- Leave Due empty until it is needed; selecting an empty Due field can begin from Event opens.
- Keep Duration and Event ends synchronized for faster calendar planning.
- Use minute, hour, day, month, and year duration units together with common duration presets.
- Mark events as all-day and keep an explicit IANA timezone.
- Prevent Event ends or Due from being saved before Event opens.
- Filter items by whether the current time is inside or outside their active range.
- Display localized dates consistently across Views and the editor.

### Recurrence and auto-renew

- RFC 5545 recurrence with `RRULE`, `RDATE`, and `EXDATE`.
- Minutely, hourly, daily, weekly, monthly, and yearly recurrence.
- Repeat from the scheduled date or from the time the previous cycle was completed.
- Configure activation and due offsets for each cycle.
- Choose whether a cycle closes at its deadline, at the next activation, or never closes automatically.
- Use auto-renew without accumulating duplicate tasks: the live item is reused, its dates advance, and completed/auto-closed cycles are recorded in `cycleHistory`.
- Project future calendar occurrences without permanently duplicating every future item.
- Materialize and edit individual occurrences only when necessary.
- Keep occurrence identity and recurrence overrides explicit for deterministic catch-up and imports.

### Habits and progress

- Turn a universal item into a habit without creating a separate habit database.
- Store completed calendar dates on the item; missing expected dates are skips by definition.
- Complete or undo a habit directly from list and table Views.
- Track boolean progress, percentages, or counters with a target and optional unit.
- Keep habits compatible with the same dates, reminders, Views, tags, lists, and recurrence controls as every other item.

### Reminders and notifications

- Add multiple reminders to one item.
- Use an absolute date/time or an offset before/after Available, Start, Due, or End.
- Set normal, urgent, or critical urgency.
- Repeat a reminder at a selected interval until it is acknowledged.
- Detect and remove semantically duplicated reminders.
- Dismiss reminders without deleting the item.
- Use local device notifications without connecting a background service.
- Optionally enable background Web Push for an installed iPhone PWA. Detailed content is opt-in; generic notifications can avoid sending item titles.

Background delivery is intentionally approximate. On the free service reminders are checked about every 15 minutes, so this is not a replacement for an exact alarm clock.

### Saved Views

Saved Views are reusable queries over the same item database — not separate copies of data.

- Build filters visually or edit the synchronized safe DSL representation.
- Filter on normal item properties, computed conditions, field presence, active range, templates, habits, subtasks, parents, tags, lists, custom fields, and system metadata.
- Use type-aware controls: boolean values, numeric comparisons, dates, enum choices, searchable tags, and multi-value inputs.
- Sort by one or more safe expressions with ascending/descending direction and explicit null placement.
- Choose exactly which item fields appear and reorder the displayed columns.
- Include custom fields and computed script results in the displayed fields.
- Render results as a list, table, calendar strip, or board.
- Give each View an accent color used for its title and completed-item ticks.
- Scope a View to a task list.
- Pin validated **Defaults for new items** independently from the View filter.
- Create a new item from a View with its list and pinned properties already filled in.
- Export a View definition, its results, or a definition-and-results bundle.
- Keep older View JSON importable through schema migration and extension preservation.

The query and formula language is parsed by UTM's allowlisted DSL. It does not use JavaScript `eval`.

### All Items and trash

- Browse active, done, auto-closed, cancelled, and archived items in persisted collapsible sections.
- See reusable templates and recurring-series sources without generating duplicate ordinary items.
- Use built-in planning collections for overdue, unscheduled, and reminder-bearing items.
- Configure displayed item fields through the same field catalog used by Saved Views.
- Restore deleted items from Trash.
- Permanently delete one item or clear the entire Trash with explicit confirmation.

### Calendar

The calendar is a responsive interface over the same universal items and Saved Views.

- Month, Week, Day, 3-day, and Agenda modes.
- Full 24-hour timeline; sleep hours are shaded instead of hidden.
- Configurable wake/sleep time, week start, weekends, snap interval, default duration, and timezone.
- Filter by a Saved View and by item state.
- Show scheduled items, deadlines, and projected recurring occurrences.
- Keep unscheduled matching items available in a separate panel.
- Drag items to another time or day and resize their visible boundaries.
- Move several selected items together.
- Choose the appropriate recurrence scope when changing a repeating occurrence.
- Use keyboard movement and Undo for calendar operations.

Calendar and calendar-driven automations are currently marked **beta** and receive stricter regression testing before releases.

### Lists, templates, and creation defaults

- Any item can belong to one named list or no list.
- A View may select a list and expose **Add item to _list_**.
- Lists remain ordinary item properties, so they work with filters, sorting, export, and custom Views.
- Templates remain ordinary universal items marked as templates rather than a second database.
- View creation defaults can copy editable scalar, date, duration, tag, context, list, custom-field, recurrence, habit, and reminder values into a fresh item.
- IDs, timestamps, completion history, occurrence identity, and relation topology are deliberately excluded from copied defaults.

### Custom fields, formulas, and scripts

- Define workspace-level text, number, boolean, date, datetime, duration, enum, multi-enum, URL, item-reference, and formula fields.
- Use formulas evaluated by the same safe expression engine as Views and automations.
- Add item-local named script fields with text, number, boolean, datetime, or duration results.
- Read properties from the current item, allowlisted global values such as the current time, or a referenced workspace item.
- Detect formula/script dependency cycles and report errors instead of executing arbitrary code.
- Display computed results in Views and export the underlying definitions with the item.

Despite the UI label “Scripts”, these expressions are not arbitrary JavaScript and cannot access the network, browser APIs, or filesystem.

### Local automations (beta)

- Triggers: item created, item updated, status changed, occurrence activated, occurrence boundary, reminder due, and recurring time schedule.
- Conditions use the same safe DSL as Views.
- Actions: set a field, close or archive an item, create an item, add a relation, update progress, add a reminder, or create an in-app notification.
- Missed-run policies: run each, run once, or skip.
- Causation depth, cooldowns, idempotency keys, and loop protection.
- Local execution log with successful, skipped, failed, and loop-blocked outcomes.
- Offline catch-up when the workspace becomes active again.

Automations cannot execute arbitrary code or make network requests.

### Import, export, and interoperability

UTM distinguishes encrypted complete-workspace transfer from readable portability formats.

| Format | Import | Export | Intended use |
| --- | :---: | :---: | --- |
| Encrypted `.utmb` | Yes | Yes | Complete backup, transfer, and deterministic manual merge |
| Legacy encrypted `.utm` | Yes | — | Compatibility with older UTM backups |
| JSON | Yes | Yes | Canonical readable item/View packages and editable definitions |
| CSV | Yes | Yes | Simple item tables and exchange with other tools |
| Excel `.xlsx` | Yes | Yes | Items plus separate custom fields, values, reminders, relations, attachments, habit dates, and Views sheets |
| iCalendar `.ics` | Yes | Yes | Calendar interoperability through `VEVENT`/`VTODO` |

Additional portability behavior:

- Export one item, View results, a View definition, or all items.
- Choose calendar-compatible iCalendar or include a machine-readable UTM metadata block in Description.
- Re-import UTM metadata when present and fall back to standard calendar fields for external `.ics` files.
- Preview imports before changing the workspace.
- Resolve duplicate item/View IDs with Add, Skip, or Copy behavior.
- Detect custom-field conflicts and preserve unsupported future data in namespaced `extensions`.
- Protect spreadsheet cells against formula injection.
- Apply compatible older schema migrations while keeping unknown newer properties recoverable.
- Keep JSON as the canonical editable definition format; CSV and iCalendar represent item results rather than a full Saved View definition.

Readable JSON, CSV, Excel, and iCalendar files are plaintext. Use `.utmb` when the file must contain a complete private workspace.

### Appearance and accessibility

- Light, dark, system, and scheduled theme modes.
- Calm interface sounds and a separate completion sound, both configurable.
- Responsive desktop and iPhone/PWA layout using the same data and components.
- Native date/time controls on mobile.
- Reduced-motion support.
- Persisted open/closed state for major disclosure sections.
- Interface languages: English, Russian, Spanish, German, French, and Korean.
- Item titles and user content are never automatically translated.
- Optional accelerated test clock, for example one simulated day every 30 real seconds, for testing recurrence and active-range behavior.

## Security and privacy

UTM is local-first by default:

- The web app stores its encrypted workspace in IndexedDB on the current browser/PWA installation.
- The local data key is random.
- A password derives a wrapping key through Argon2id with a minimum of 19 MiB memory and two operations.
- Workspace blocks use authenticated XChaCha20-Poly1305 encryption with unique nonces and associated data.
- The password and unwrapped data key stay in memory only. Locking the app clears the in-memory key; a full restart requires the password again.
- Encrypted `.utmb` files contain the complete workspace, including items, settings, Views, automations, logs, tombstones, and merge history.
- Automerge history inside `.utmb` supports deterministic manual merge between devices.
- GitHub Pages serves static application files. It does not receive the local workspace.
- There is no recovery key and no central account service. Losing both the password and every usable backup means losing the workspace.

Optional background notifications are the only feature that may contact a push service. The service receives a random device identity and only the notification information allowed by the selected content mode. It never receives the workspace password or database.

## Install on a phone

### iPhone or iPad

1. Open [the web app](https://nebuhtit.github.io/universal-task-manager/) in Safari.
2. Tap **Share**.
3. Choose **Add to Home Screen**.
4. Open UTM from the new Home Screen icon.
5. Create an encrypted `.utmb` backup and store it in Files or a cloud-backed folder.

For notification permission, open **Settings → Notifications** inside the installed app. Background delivery is optional and requires the access code supplied by the workspace owner.

### Android

1. Open the web app in Chrome.
2. Open the browser menu.
3. Choose **Install app** or **Add to Home screen**.

Each browser or installed PWA has its own local workspace. Moving to another device requires an encrypted backup/transfer file or an explicit manual merge.

## Current limitations

- UTM is beta software and has not yet reached the visual/UX stability of a mature commercial task manager.
- There is no hosted account, password recovery, or automatic realtime cloud synchronization.
- Browsers and iOS do not allow the PWA to silently write arbitrary backup files into a user-selected cloud folder. UTM can remind you to export a backup, but the final save remains a user-confirmed system action.
- Deleting the PWA, clearing website data, or browser storage eviction may remove the local workspace.
- Background Web Push is approximate and depends on browser, OS, and service availability.
- Exact closed-app alarms are outside the current web platform implementation.
- Binary file attachments are not embedded in the workspace; attachments are links.
- Calendar and Automations remain beta areas.
- Google Calendar realtime sync, arbitrary JavaScript, webhooks, and third-party account integrations are out of scope for the current release.

## Run locally

Requirements:

- Node.js 22 or newer;
- pnpm 10.

```bash
pnpm install
pnpm build
pnpm dev
```

Open the URL printed by Vite. To test on a phone connected to the same network, use the LAN address shown by the development server.

The production PWA works offline after its application files have been loaded and cached successfully at least once.

## Verification

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Tests cover the core item schema, migrations, date/duration utilities, View selection, visual-filter translation, creation defaults, recurrence, auto-renew cycle history, calendar projection/materialization, reminders, portability, encryption, deterministic merge, workspace lifecycle, and critical desktop/mobile workflows.

For a small local change, run typecheck and the relevant unit tests first. Full E2E is reserved for substantial or risky workflow changes and release candidates.

## CLI and SDK

Build the monorepo first, then provide the container password through an environment variable. Plaintext is written only to stdout.

```bash
export UTM_CONTAINER_PASSWORD='your long password'

pnpm utm validate workspace.utmb
pnpm utm unlock workspace.utmb --format json
pnpm utm unlock workspace.utmb --format ics
pnpm utm merge device-a.utmb device-b.utmb > merged.utmb
pnpm utm from-json workspace.json > workspace.utmb
```

Redirecting JSON or ICS output to a file explicitly creates plaintext data.

## Repository structure

```text
apps/web       React 19 PWA, responsive UI, IndexedDB integration, service worker
packages/core  Universal item model, schema, recurrence, DSL, formulas, automation, interoperability
packages/sdk   Encryption, Automerge container, storage adapter, SDK, and CLI
tests/e2e      Playwright desktop and mobile workflow coverage
```

The `main` branch is the stable GitHub Pages source. Ongoing work is developed and tested on `develop`, then promoted to `main` after approval.

## Design and engineering principles

- One universal item shape instead of task/event/habit silos.
- Local-first and encrypted by default.
- Safe declarative expressions instead of `eval`.
- Progressive disclosure for advanced item properties.
- Reuse one live item for auto-renew recurrence instead of creating endless duplicates.
- Keep readable interchange formats separate from full encrypted transfer.
- Fix domain root causes rather than hiding stale state with refreshes or timeouts.
- Prefer small, tested refactoring steps over full rewrites.
- Keep desktop and mobile on the same component and data foundation.

## License

`packages/core` and `packages/sdk` are licensed under Apache-2.0. Their license files are included with the packages.

The web product shell in `apps/web` is currently unlicensed/proprietary. Unless a separate license explicitly grants permission, public source visibility does not grant permission to copy, redistribute, or modify that portion of the project.
