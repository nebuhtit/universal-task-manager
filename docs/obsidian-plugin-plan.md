# Obsidian plugin plan

## Goal

Provide an Obsidian-native shell around the Universal workspace without duplicating domain logic or weakening encryption. The plugin should work offline and keep workspace data in the user's vault or an explicitly selected local location.

## Proposed phases

1. **Read-only prototype** — register a `Universal` view, load the bundled web app in an Obsidian item view, and expose vault paths only through an explicit import/export action.
2. **Workspace bridge** — add commands to open/import an encrypted `.utmb` file and export a verified backup. Never write Google Calendar events or OAuth tokens into vault files.
3. **Vault integration** — optionally mirror selected plain-text notes as one-way references, with stable item IDs and conflict warnings. The encrypted workspace remains the source of truth.
4. **Notifications and sync** — use Obsidian's lifecycle and workspace events, with debounced persistence and no background network sync by default.

## Technical decisions

- Reuse `packages/core` and `packages/sdk` through a small adapter rather than reimplementing filtering, recurrence, reminders, and sorting.
- Keep the web UI bundled locally; no dependency on GitHub Pages at runtime.
- Store plugin settings (workspace path, UI preferences) separately from workspace content.
- Treat vault sync as an explicit user action; never silently overwrite a workspace or expose Google Calendar data in Markdown, JSON, or plugin settings.
- Add a capability check for Obsidian mobile and degrade to file import/export when native filesystem access is unavailable.

## First implementation slice

- scaffold `manifest.json` and `main.ts`;
- add a `UniversalView` ItemView with a local asset loader;
- add commands: `Open Universal workspace`, `Export encrypted backup`, and `Close workspace`;
- add unit tests for path handling and export exclusion rules;
- verify desktop and mobile Obsidian packaging before adding vault mirroring.

## Open decisions

- whether the canonical workspace lives inside the vault or in Application Support;
- whether vault mirroring should be opt-in per item or disabled entirely in v1;
- whether native Obsidian notices should replace the web notification center.
