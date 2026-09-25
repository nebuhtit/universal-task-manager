# Universal Task Manager

**One local-first system for tasks, events, habits, recurring work, and personal workflows.**

Universal Task Manager (UTM) is a local-first web/PWA and native iOS application built around one flexible `UniversalItem` model. Tasks, calendar events, habits, notes, templates and recurring work share the same properties, calendar and history. The iOS app bundles the web interface locally: it does not load the application from GitHub Pages and works offline.

[Open the web app](https://nebuhtit.github.io/universal-task-manager/) · [Install on a phone](#install-on-a-phone) · [Run locally](#run-locally) · [Security model](#security-and-privacy)

Current release: **v3.2.0** · workspace schema: **1.26.0**

> [!IMPORTANT]
> UTM is currently **beta software**. Your workspace is stored on your device, not in a hosted account. Create encrypted `.utmb` backups regularly. Clearing browser/PWA storage or removing an installed web app can erase its local workspace.

<details>
<summary><strong>Кратко по-русски</strong></summary>

UTM — локальный менеджер задач, событий, привычек и повторяющихся дел с единой моделью данных. Работает офлайн как веб-приложение/PWA и отдельное приложение iOS. Хранит workspace на устройстве и переносит данные через зашифрованный файл `.utmb`.

В приложении есть настраиваемые Views, таблицы и списки, календарь, active range, повторения, напоминания, шаблоны, subtasks, пользовательские поля, безопасные формулы, импорт/экспорт JSON, CSV, Excel и iCalendar, корзина и ручное слияние workspace между устройствами.

В календаре доступны List и Timeline, ручной порядок дня и временные ярлыки на сегодня/завтра без изменения исходных items. Статус учитывает дорогу до события. Live Text понимает короткие команды на русском и английском; точные даты и напоминания сохраняются в свойствах, даже когда скрыты из строки ввода.

В iOS: Face ID, системные будильники таймера, локальные уведомления, экспорт бэкапов через «Файлы» и виджет экрана блокировки с отсчётом. Завершённый таймер записывает длительность с отметкой `A✎`; после закрытого приложения — при следующем открытии и разблокировке. Виджет включается отдельно: отображаемые названия и время сохраняются в общем локальном хранилище вне шифрования workspace.

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
- Filter Views by any reminder, unacknowledged active reminders, a calculable next active reminder, or whether that next reminder falls before, inside, or after Today, Tomorrow, This week, Next week, Next N days, or a custom period.
- Optionally show active reminders, the active-reminder boolean, and the next calculable active reminder as separate View fields. Hiding these fields does not disable or delete reminders.
- Use local device notifications without connecting a background service.
- Optionally enable background Web Push for an installed iPhone PWA. Detailed content is opt-in; generic notifications can avoid sending item titles.

Background delivery is intentionally approximate. On the free service reminders are checked about every 15 minutes, so this is not a replacement for an exact alarm clock.

### Saved Views

Saved Views are reusable queries over the same item database — not separate copies of data.

- Build filters visually or edit the synchronized safe DSL representation.
- Filter on normal item properties, computed conditions, field presence, active range, reminders and reminder periods, schedule periods, templates, habits, subtasks, parents, tags, lists, custom fields, and system metadata.
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

### Areas, Projects, Tags, and Unified priority

- Manage Areas, Projects, and Tags from the PARA page, including names, colors, Home pins, and one mixed drag-and-drop priority ladder.
- Rank an item by its highest matching Area, Project, or Tag in **Unified priority**. No relationship type receives an implicit preference.
- Delete an Area, Project, or Tag only after reviewing exact impact counts and typing its name. Structured item links and defaults are cleaned atomically; Projects survive Area deletion and are detached from it.
- Remove scoped PARA Views and their dashboard widgets when their organization entity is deleted.
- Leave free-form View DSL and sort expressions untouched rather than guessing at executable user text; the confirmation warns when those expressions mention the deleted name.
- Create an encrypted backup before a large organization edit if the removed relationships may be needed later.

### All Items and trash

- Browse active, done, auto-closed, cancelled, and archived items in persisted collapsible sections.
- See reusable templates and recurring-series sources without generating duplicate ordinary items.
- Use built-in planning collections for overdue, unscheduled, and reminder-bearing items.
- Configure displayed item fields through the same field catalog used by Saved Views.
- Restore deleted items from Trash.
- Permanently delete one item or clear the entire Trash with explicit confirmation.

### Calendar

The calendar provides a responsive day List and Timeline over the same universal items.

- Week and Month navigation with a compact sticky selected week while scrolling.
- Swipe the day navigator left/right for the next/previous period. Today appears before the arrows only when another day is selected.
- Shared manual day order for List and Timeline, respecting future deadlines and fixed event intervals.
- Temporary Today/Tomorrow references point to originals, never duplicate items or rewrite their real dates. Queue and parallel placements account for calendar occupancy.
- The in-app status and iOS widget include departure time before events with travel duration.
- Duration-weighted completion and free-time statistics for every day.
- One persistent **Calendar Day View** controls additional visual filters, displayed fields, and sorting for every selected date.
- The selected day is a mandatory one-day boundary. Additional filters are joined with it using `AND` and cannot bypass it.
- Choose which schedule relationships count for the day: Event opens, Event opens → Event ends overlap, Event opens → Due overlap, and Due. Enabled relationships are combined with `OR`.
- Configure week start, timezone, and Google Calendar synchronization from the collapsed Calendar settings section.
- Show scheduled items, deadlines, and projected recurring occurrences.
- Mirror selected Google calendars into the encrypted workspace; source events open their properties in UTM with a separate Google Calendar link. Explicit editing affects only the selected event or occurrence, up to three hours after its end.
- Keep Google OAuth access tokens in memory only. Incremental sync tokens contain no account access credential and may be stored in the workspace.
- Treat mirrored Google events as a local cache: every JSON, CSV, Excel, iCalendar and encrypted `.utmb` export removes the events, connection metadata, sync tokens and dangling item references. Reconnect and sync after restoring a backup.
- User-authored actual-time journals are workspace data, not Google cache: backups retain them with a hashed calendar/event association and reattach them after reconnecting the same calendar. Google event drafts are excluded from exports.

### Actual time and completion journals

- **Edit item → Progress & completions** contains editable actual-time entries (date, hours/minutes/seconds, comment) and completion entries. Plan and actual time remain separate.
- Completion statistics show count, total recorded duration and average duration; unknown durations and revoked completions are excluded from the average.
- Finished native iOS countdowns record their target duration once with `A✎`. If the app was closed, recording happens after reopening and unlocking. Manual stops and stopwatches remain manually recorded.
- Completing or automatically closing a UTM item records its outcome. Reopening marks the previous completion revoked. Counter goals are recalculated from the completion journal.
- Series history includes cycle-labelled entries; new cycles start with zero actual time. Legacy actual duration becomes an undated imported entry, and closure history is retained.
- Enable **Actual time** in view statistics or PARA to display it separately. Expected duration still drives progress, remaining time and free time; actual totals use the same exclusions and deduplication.

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
- Calendar Day View, reminder filters, reminder display fields, and their inclusion/hiding explanations are localized in all six interface languages.
- Item titles and user content are never automatically translated.
- Optional accelerated test clock, for example one simulated day every 30 real seconds, for testing recurrence and active-range behavior.

Settings show the exact application version and short build commit at the top. The collapsed **Guide → Presets** section is generated from the same defaults used for a new workspace, so current starter Views, Calendar Day View behavior, and workspace defaults remain inspectable without duplicating a separate manual list.

## Security and privacy

UTM is local-first by default:

- The web app stores its encrypted workspace in IndexedDB on the current browser/PWA installation.
- The local data key is random.
- A password derives a wrapping key through Argon2id with a minimum of 19 MiB memory and two operations.
- Workspace blocks use authenticated XChaCha20-Poly1305 encryption with unique nonces and associated data.
- By default, the password and unwrapped data key stay in memory only. Locking the app clears the in-memory key; a full restart requires the password again.
- Native iOS can optionally unlock with Face ID using a Keychain-protected wrapping key. The password is not saved; keep it for backups and recovery.
- The optional iOS widget stores a minimal title/time snapshot outside the encrypted workspace so it can render while locked. Enabling this is explicit; disabling clears the shared snapshot.
- Password protection can be disabled for one browser profile only after the current password is verified. The workspace block remains encrypted, but the local unlock key is then stored in that profile, so anyone with profile access can open it.
- Changing the password rewraps the same random data key and updates current verified browser mirrors without rewriting workspace data. Previously downloaded backups and saved pre-migration versions retain their old passwords.
- A valid old `.utmb` backup can be opened with its old password, re-encrypted with a new password, and verified before a new file is downloaded. The original file is never overwritten, and damaged input is rejected.
- Encrypted `.utmb` files contain the complete workspace, including items, settings, Views, automations, logs, tombstones, and merge history.
- Automerge history inside `.utmb` supports deterministic manual merge between devices.
- GitHub Pages serves static application files. It does not receive the local workspace.
- There is no recovery key and no central account service. Losing both the password and every usable backup means losing the workspace.

Optional background notifications are the only feature that may contact a push service. The service receives a random device identity and only the notification information allowed by the selected content mode. It never receives the workspace password or database.

## Install on a phone

### iPhone or iPad

**Native iOS app:** open the [Xcode project and setup guide](ios/README.md). The app includes its own offline bundle, Face ID unlock, native notifications, AlarmKit countdown alarms on supported iOS, and an optional WidgetKit Lock Screen widget. Install/update your local build with Xcode; updating the website does not update an installed native build. Widget timelines cover a bounded upcoming range and are refreshed by reopening the app; iOS controls background refresh timing. Automatic iCloud backups depend on signing entitlements; manual Files export is available without them.

**PWA alternative:**

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
- Exact closed-app alarms are outside the PWA implementation; the native iOS app uses AlarmKit on supported iOS versions.
- Binary file attachments are not embedded in the workspace; attachments are links.
- Calendar and Automations remain beta areas.
- Google Calendar sync requires an OAuth web client ID and explicit reconnect after an access token expires. Closed-app background sync is not provided by the static PWA.
- Arbitrary JavaScript, webhooks, Apple Calendar, and other third-party account integrations remain out of scope.

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

Google Calendar connection needs a Google OAuth Web client configured with the local and deployed origins. Put its public client ID in an uncommitted `.env.local`:

```dotenv
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

For GitHub Pages, add the same value as the repository Actions secret `GOOGLE_CALENDAR_CLIENT_ID`. Reading requests `calendar.readonly`. Explicitly authorizing event creation requests `calendar.events` and `calendar.calendarlist.readonly`; access tokens remain in browser memory. Add these scopes to Google Auth Platform → Data Access. Saving a UTM item with Event opens and Event ends automatically creates its linked Google event in the chosen calendar (default from Settings). Start prefills End; clearing End before the first send keeps a normal task. Clearing Event ends on a linked item with Due asks for confirmation, keeps its independent estimated duration in UTM, and queues deletion of the Google event now or when write authorization is available. The same Save item action updates event fields and moves ordinary events between writable calendars. Calendar items use a calendar marker instead of completion controls. UTM and Google share one result identity: the task retains its estimate, status, tags, projects and journals; the calendar interval reserves time separately, without counting a second task. Legacy pairs are merged by their saved operation IDs, never by title. All Items lists linked tasks only under UTM with a Google badge. Disconnecting preserves the UTM task. Recurrence and guests are not copied. Existing Google events open their properties in UTM with a separate Google link. Editing uses an explicit-save, changed-fields-only PATCH and ETag conflict protection; the current end and write permission are checked again before saving. Only an individual occurrence is changed. Drafts survive network failures and uncertain writes are read back before retrying. Creation, updates, moves and deletion save their operation before sending, use stable event identity, and recover safely after an uncertain response. The connected account is checked before writing.

The first event download is bounded to one year behind and one year ahead, then Google sync tokens fetch changes incrementally; the moving two-year window is refreshed weekly. Per-request timeouts and an on-device sync log keep a stalled mobile connection diagnosable without recording event contents. Mirrored events and Google connection/creation metadata are excluded from every export, including encrypted recovery copies, so a restored workspace must reconnect and sync again.

Creation browser regression (mock Google only): start `VITE_GOOGLE_CLIENT_ID=test-client pnpm --filter @utm/web dev --host 127.0.0.1 --port 4189 --strictPort`, then run `pnpm exec playwright test --config playwright.google-create.config.ts`. The dedicated suite uses isolated browser workspaces and tests desktop and mobile layouts, explicit preview, permissions and recovery from a lost insert response.

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
