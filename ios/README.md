# Universal Task Manager for iOS

This target is a small native shell around the production web application. The
web bundle is compiled locally and served only on the loopback interface, so it
does not depend on GitHub Pages or an internet connection.

## Requirements

- Xcode 16 or newer with an iOS 17 SDK
- Node.js and pnpm dependencies installed at the repository root
- an Apple Development team selected in Xcode for a physical device

## Open and run in Xcode

1. Install Xcode from the Mac App Store and open `UniversalTaskManager.xcodeproj`
   in this folder (double-click it in Finder or use **File → Open** in Xcode).
2. Select the blue project, then the app target. In **Signing & Capabilities**,
   enable automatic signing and choose your Team.
3. Simulator: choose an installed iPhone in the top device menu and press
   **Run** (`⌘R`). Allow notifications inside the app.
4. iPhone: connect and trust the device, enable Developer Mode if iOS asks,
   select the iPhone in Xcode and press **Run**. If the identifier is already
   taken, replace it with a unique Bundle Identifier.

A free Personal Team can install a test build on your own iPhone, but its
signing is temporary. Normal long-lived distribution requires the Apple
Developer Program.

The Xcode build phase runs `pnpm ios:prepare`, places the production web bundle
inside the application, and then starts it from a loopback-only HTTP server.
The default `WKWebsiteDataStore` keeps the existing IndexedDB workspace between
launches and application updates.

To inspect the packaged bundle without Xcode, run:

```sh
pnpm ios:prepare
```

`Generated/WebApp` is build output and is intentionally not committed.

## iCloud backup and recovery

When the target is signed with an Apple team that has enabled the iCloud
container `iCloud.dev.universal-task-manager`, every saved encrypted workspace
change is coalesced and copied to the app's private iCloud Drive container.
The current `automatic-current.utmb` and one `automatic-previous.utmb` are
kept. The backup is the existing encrypted local recovery format: it contains
no Google Calendar cache, OAuth tokens or Google event data.

Open **Encrypted Transfer** in the app to force a backup now or import a
`.utmb` from Files. Import still requires the backup password and either merges
the same workspace or explicitly offers replacement for a different one.

Before running on a device, select a Development Team in Xcode and enable
**iCloud / CloudDocuments** for `iCloud.dev.universal-task-manager` in the
Apple Developer portal. Without that entitlement iCloud backup reports an
error; the offline workspace and manual Files export continue to work.

## Native reminders

The shell schedules future resolved reminders with `UNUserNotificationCenter`,
so they work while the app is closed. It uses the web app's shared
absolute/relative calculation, respects `availableFrom`, and ignores
acknowledged, unresolved, deleted, and inactive reminders. The nearest 60 are
scheduled; every workspace change replaces the app-owned pending set.
Accelerated test-clock reminders remain in-app and never create real alarms.

Local reminders need no Push Notifications capability or server. Google OAuth
through `ASWebAuthenticationSession` remains a separate next stage.
