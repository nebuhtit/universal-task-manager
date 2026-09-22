# Startup recovery diagnostics

The startup journal records an attempt ID, app version/build, source (`local`,
`automatic`, `safe`, `backup`), stage, phase, elapsed milliseconds, binary byte
length and item count. It never records passwords, keys, task text, filenames,
workspace IDs, raw errors or document contents. The journal is local, bounded to
120 entries, and included in **Download log** and locked recovery exports.

Checkpoints are written before synchronous decryption/load/activation work, not
only after it completes. The last `started` checkpoint without a matching
completion narrows the suspect stage; it does not prove the root cause.

An unfinished attempt is remembered across reloads and browser restarts. Automatic
entry and automatic Face ID pause; the lock screen defaults to safe opening.
Closing a page during startup, or opening another tab during startup, may also
produce this notice. It is not a corruption diagnosis. A normal ready screen or
read-only recovery screen clears its marker after ten seconds; a successful
explicit lock also finishes the attempt. A tab never clears a different attempt's
durable marker.

## Compare without overwriting the old workspace

1. Keep the existing encrypted backup outside browser storage.
2. On the lock screen choose safe opening and enter the workspace password.
3. Download the log, then return to the opening selector.
4. Choose a `UTM-LOCAL-ENCRYPTED` recovery `.utmb` file and enter its password.
   If a workspace already exists this opens the file read-only, never imports it.
5. Download the log again. Compare `safe` and `backup` attempts on the same build.

Safe opening does not migrate, repair the primary from a mirror, create an export
snapshot, start recurrence/scripts/reminders/sync, or attach a normal editable
session. It shows up to 200 items using the existing recovery shell. Local
diagnostic keys are the only writes. The password is entered on-device, not sent
to the developer. The original encrypted file/storage remains unchanged.

## Limits

Decryption and Automerge loading are still required even in safe mode. A browser
process killed during those operations cannot report a JavaScript exception.
Storage quota/private-mode restrictions can prevent checkpoints from being
recorded. GitHub Pages does not receive this local journal automatically.
Tests with synthetic workspaces are not proof that a particular user's old
workspace opens successfully on their iPhone.

## Persistence protections (2.5.8)

- The UI distinguishes pending, confirmed and failed saves. Failed item saves
  keep the editor open; retry is explicit. Backgrounding attempts a flush, but
  mobile process termination cannot be made to await JavaScript. A persistent
  content-free pending marker warns on next entry if a write was unconfirmed.
- An exclusive Web Lock permits one editable session per origin. Other tabs
  offer read-only recovery. Close older app-version tabs before updating; those
  versions do not participate in this lock protocol. Browsers without Web Locks
  fail closed for editing instead of allowing unprotected concurrent writes.
- Primary/export blocks, rollback checkpoints and verified mirrors are updated
  atomically. Synchronous request-enqueue failures explicitly abort the entire
  IndexedDB transaction. Writes request strict durability.
- Migration and same-schema normalization must finish their verified checkpoint
  write before an editable session is exposed. Restoration checks the incoming
  document before writing; local and portable replacements preserve a rollback
  snapshot in the same transaction.
- Worker startup failure and timeout use the verified main-thread fallback.
  Temporary verification documents are explicitly freed.
- Export reads metadata, privacy-safe block and saved-state receipt in one read
  transaction. `savedState` describes the source revision (`sourceHeads`,
  `sourceUpdatedAt`, `sourceItemCount`, `savedAt`), not filesystem confirmation.
  Existing Google privacy exclusions still apply, so source count need not equal
  exported count. A browser download/share request cannot prove that the user
  finished saving the file to Files.

Automated browser fault tests cover quota at a later transaction write, retry,
closure during serialization, worker construction failure, concurrent tabs,
failed/successful migrations and corrupt/failed/successful backup replacement.
