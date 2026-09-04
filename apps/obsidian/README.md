# Universal Task Manager for Obsidian

This plugin opens a fully local production build of Universal Task Manager in a dedicated Obsidian tab. It does not load GitHub Pages and does not require a network connection.

## Build

```bash
pnpm install
pnpm obsidian:build
```

Copy the contents of `apps/obsidian/dist` to:

```text
<test-vault>/.obsidian/plugins/universal-task-manager/
```

Restart Obsidian, enable **Universal Task Manager** under Community plugins, then run **Open Universal** from the command palette or use the ribbon icon.

Use a separate test vault while developing the plugin.

## Workspace storage

The encrypted workspace is stored through Obsidian's cross-platform Vault Adapter:

```text
.universal/workspace.utmb
.universal/workspace.previous.utmb
.universal/recovery/
```

Writes use a temporary file, read-back validation and previous-copy rotation. External changes stop the save and require an explicit conflict choice. The password never leaves Universal, and portable copies retain the existing Google Calendar exclusion.

## Reminders and mobile

The plugin schedules the nearest resolved reminder and shows a clickable Obsidian Notice while Obsidian is open. Obsidian Mobile cannot guarantee delivery after the app closes; the native Universal iOS shell owns that case.

Runtime file access uses only `app.vault.adapter`; there are no Node, Electron, telemetry or network dependencies. Physical iOS/Android and large-workspace verification is still required before a public release.
