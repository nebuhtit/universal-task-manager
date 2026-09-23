# 2.9.5

This release includes the save-coordinator and calendar-cache increments described
in `stability-baseline-2026-09-23.md` and `calendar-incremental-computation.md`.
No personal backup, calendar identifiers or user-data migration is included.

## Editor and Timeline

- Stored Quick entry source is visible immediately in Title. Existing source
  fields wrap and scroll within four lines; new capture retains its Enter flow.
- Reminder separators include spaces. Parser tests cover absolute and relative
  reminder lists, including line breaks, without dropping reminder entries.
- The mini day preview scrolls with suggestions rather than covering them.
- Holding an empty Timeline hour for 550 ms opens an unsaved one-hour draft with
  focused Title. Movement cancels the hold; item controls retain their gestures.
  Haptics are best-effort and have no effect on correctness.
- Event opens, Event ends and Due use the item time zone consistently, including
  their formatted labels. Merely opening a legacy Quick entry source does not
  force reparsing it on Save.

## Scope of evidence

Browser tests use synthetic encrypted workspaces; Google transport is mocked.
Mobile-profile WebKit is not physical iPhone Safari/PWA, and does not prove
keyboard or vibration behavior on a device. Real Google accounts are not changed
by the test suite. Existing large-bundle warnings remain.

Local verification: repository typecheck, 1,116 unit/integration tests (three
opt-in performance tests skipped), production builds, output-isolation check
and `git diff --check` passed. The 28 selected editor/Timeline browser scenarios
passed across Chromium and mobile-profile WebKit; the hold test was rerun after
targeting the hour label directly instead of cached screen coordinates. All six
Google browser scenarios passed in the final serial run. Earlier iterations
exposed reminder-list parsing, mixed-zone fields and stale plain-title test
assumptions, which were corrected before release.
