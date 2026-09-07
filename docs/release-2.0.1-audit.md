# 2.0.1 stability audit — 2026-09-08

- Fixed scheduled automation parsing: rrule compatible mode requires a DTSTART in the rule text and was throwing even for ordinary FREQ-only rules with an options-provided start date.
- Invalid scheduled rules are disabled with a repair explanation; the original rule text/actions remain available. Other valid rules continue. Workspace activation reports disabled schedules.
- run_each enumeration stops at 1000 dates instead of collecting an unbounded historical array. run_once asks for the last date; skip avoids enumeration entirely. Existing exclusive time boundaries are retained.
- A workspace without recurring/habit items skips worker creation and snapshot serialization.
- Timing out a shared recurrence worker rejects all of its pending requests immediately rather than leaving orphan requests until their individual timeouts.
- Pausing a timer reads the current timestamp rather than the last display refresh, preserving elapsed time between display ticks.

Verified normal/invalid/mixed schedules, dense secondly schedules, missed policies, no-recurrence worker bypass, and Automerge round-trip preservation of the broken rule and original document. Full unit suite: 360 passed, one optional performance test skipped. Typecheck, build and web/Obsidian isolation check passed.

This is targeted fault tolerance, not a promise to decrypt or recover arbitrarily corrupted encrypted bytes. Historical user workspace unlock latency was not measured in this release.
