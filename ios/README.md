# Universal Task Manager for iOS

This target is a small native shell around the production web application. The
web bundle is compiled locally and served only on the loopback interface, so it
does not depend on GitHub Pages or an internet connection.

## Requirements

- Xcode 27 or newer (Xcode 27.2 beta is compatible) with an iOS 27 SDK; the app deployment target remains iOS 17
- Node.js and pnpm dependencies installed at the repository root
- an Apple Development team selected in Xcode for a physical device

## Open and run in Xcode

1. Install Xcode from the Mac App Store and open `UniversalTaskManager.xcodeproj`
   in this folder (double-click it in Finder or use **File → Open** in Xcode).
2. Select the blue project, then the app target. In **Signing & Capabilities**,
   enable automatic signing and choose **Personal Team** (free Apple Account) to
   install on your own iPhone. No paid membership is needed for local testing.
3. Simulator: choose an installed iPhone in the top device menu and press
   **Run** (`⌘R`). Allow notifications inside the app.
4. iPhone: connect and trust the device, enable Developer Mode if iOS asks,
   select the iPhone in Xcode and press **Run**. If the identifier is already
   taken, replace it with a unique Bundle Identifier.

A free Personal Team can install a test build on your own iPhone, but its
provisioning expires after 7 days; rebuild and reinstall from Xcode when asked.
App Store, TestFlight, and long-lived distribution require the paid Apple
Developer Program.

The Xcode build phase runs `pnpm ios:prepare`, places the production web bundle
inside the application, and then starts it from a loopback-only HTTP server.
The default `WKWebsiteDataStore` keeps the existing IndexedDB workspace between
launches and application updates.

The native shell fills the screen; web safe-area insets protect the status bar
and home indicator. The app icon reuses the web mark; regenerate it with
`node scripts/generate-ios-icon.mjs` after changing `apps/web/public/icon.svg`.

On iOS 26 and later, item timers schedule a fixed system alarm with AlarmKit.
Allow the separate alarm permission when starting a timer. Pause/reset cancels
the alarm. Older iOS versions use a local notification with sound instead.
Physical-device acceptance: start a one-minute timer, lock the phone, check the
alarm, then repeat with pause/reset to confirm cancellation.

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

**Export encrypted .utmb** and the main backup button open the system Files save
picker in the native app. Choose On My iPhone, iCloud Drive or another file
provider; success is reported only after saving. This manual path does not
require the app's iCloud entitlement. Cancelling does not mark a backup saved.

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

Local reminders need no Push Notifications capability or server.

## Native Google Calendar setup

The app serves the bundled WebApp folder offline at a stable localhost origin;
it does not load the GitHub Pages website. Do not change that origin: existing
encrypted browser storage belongs to it.

Google's web OAuth client cannot authorize this native origin. In Google Cloud,
create an OAuth client of type **iOS**, with bundle ID
`dev.universal-task-manager.ios`. In both Xcode target build configurations set:

- `GOOGLE_IOS_CLIENT_ID`: the public client ID ending in `.apps.googleusercontent.com`.
- `GOOGLE_IOS_REVERSED_CLIENT_ID`: its reversed dot-separated components (Google's iOS URL scheme).

Rebuild and run. Native sign-in uses ASWebAuthenticationSession and authorization
code + PKCE. No client secret is embedded. Without this configuration the app
shows a setup error instead of launching the incompatible web sign-in flow.
Real-account consent and Calendar sync still require device testing after setup.

## Recovery and Password AutoFill

Native text exports (including diagnostics) use the system Files picker, keeping
the application screen intact. Unavailable automatic iCloud backup is throttled:
the same snapshot is not retried and changed snapshots wait at least five minutes
after a failure. Manual Files export is independent of the iCloud entitlement.

Password inputs expose current/new-password autofill hints. Automatic association
with credentials saved for the website additionally requires Apple's Associated
Domains entitlement and a matching apple-app-site-association file on a controlled
HTTPS domain. HTML hints alone do not associate localhost with GitHub Pages;
select an existing credential manually from Passwords when needed.
