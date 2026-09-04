# Obsidian plugin implementation

## Implemented locally

- Dedicated `Universal Task Manager` tab, command and ribbon action.
- Bundled relative-path web build without GitHub Pages, network access or PWA registration.
- Canonical encrypted `.universal/workspace.utmb`, loaded before the web workspace boots.
- Existing debounced persistence followed by a host save through `app.vault.adapter` only.
- Temporary write, exact read-back validation, previous-copy rotation and recovery copies.
- External-change detection with explicit choices and no silent overwrite. Merge preserves both files and routes through Universal Transfer, which verifies the password and uses Automerge.
- One nearest-reminder timer and clickable Obsidian Notice while Obsidian is running.
- Normal Obsidian `ItemView` restoration after a tab or application restart.

## Security boundary

- The host receives only the already encrypted, Google-safe recovery container; it never receives or stores the password or data key.
- The decrypted Automerge document exists only in embedded-app memory. Universal's lock flow zeroes its key.
- No telemetry was added. Plugin logs contain no item or calendar titles.
- Runtime uses no Node or Electron APIs. Build-time esbuild uses Node, but the artifact uses the mobile-compatible Vault Adapter.
- Note integration is not implemented, so the plugin never scans the vault.

## Verification required before public release

- Physical iOS and Android Obsidian: touch, safe area, keyboard and tab restoration.
- Obsidian Sync/iCloud conflicts on two devices.
- 10,000-item workspace responsiveness and interrupted-write recovery.
- Cold start and reminders while offline.
- Community Plugins packaging review.

Background reminders while Obsidian is closed are intentionally out of scope; the native iOS shell owns that capability.
