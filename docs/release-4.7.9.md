# Universal Task Manager 4.7.9

## WebDAV sync safety

- Serializes workspace writes with short-lived WebDAV exclusive locks so two devices cannot silently replace one another's snapshots.
- Verifies every completed write by downloading and validating the saved encrypted snapshot.
- Saves encrypted recovery copies of both branches before applying a remote merge; conflicting edits remain recoverable.
- Queues a single follow-up sync for edits made during an exchange and backs off after network/server errors.
- Adds detailed, credential-safe diagnostics and separate periodic log uploads. Diagnostics can be disabled; recovery snapshots remain part of sync safety.

WebDAV servers must support `LOCK` and `UNLOCK`. Keenetic Personal Cloud was checked with concurrent test clients; generated test files were removed.

## Verification

- 33 focused WebDAV sync and settings tests passed locally.
- Production web build passed locally.
- The full GitHub test suite passed 1,675 tests but currently fails the unrelated performance behavior hash assertion (`9c5800e7` expected, `ab394bf3` received) in `performanceBaseline.test.ts`.
