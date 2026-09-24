# Calendar references and manual order (2.9.9)

`calendarPreferences.planning` is optional. `enabled !== false` enables the feature;
disabling restores the previous calendar path and hides pin gestures/reset controls.
Stored orders and references are preserved while disabled.

## Deadline repair and parallel references (2.9.13)

Saved orders that put flexible work behind an anchor whose end (including travel
back) prevents meeting a future Due are repaired before placement. The selected
day's repaired order is persisted with a notice. Repairing one old conflict is
not blocked by another unchanged conflict; new illegal moves are still rejected.
Recurring tasks use concrete occurrence dates, not the template's historical dates.

`parallel[YYYY-MM-DD][concreteItemId]` stores an explicit ISO start for a day-local
reference. Unplaced tasks offer Parallel / Queue. Parallel may overlap visible
events, Work, sleep and hidden reserves, but cannot exceed a future Due or day end.
Queue removes only this override and uses the ordinary free-gap calculation.
Neither operation modifies items, estimates, reminders, history or Google queues.
The reference uses the current source estimate (the daily share for active ranges).
Statistics use an isolated interval projection and union overlapping occupancy;
the source is never replaced by this projection. Sleep compression reveals only
the reference interval, without changing the user's hide-sleep preference.

- `orders[YYYY-MM-DD]` stores source item/occurrence IDs in display order.
- `pins[identity]` contains only `itemId`, optional `seriesId`/`recurrenceId`, local
  `day`, and `mode` (`same_time` or `queue`). One reference per concrete identity.
- No pin becomes an item. Resolving virtual occurrences is read-only. Deleted,
  closed and expired references do not reserve capacity. Midnight, foreground,
  focus, unlock and page restoration use the shared workspace clock.
- Source editing/completion follows existing item/occurrence handlers. References
  never reschedule reminders or write to Google's queue. Stale preference entries
  are ignored, not automatically deleted from the document.

The pure `buildCalendarPlan` service is shared by Calendar List and Timeline.
Events with both Event opens and Event ends and same-time references are anchors; their occupied intervals,
travel, sleep and hidden reservations constrain full-duration free-gap placement.
Future deadlines constrain the end; date-only deadlines mean local day end.
Past deadlines allow rescheduling. A rejected move leaves the saved order intact.
Unplaced items remain visible with a reason and their original duration.
Active-range outlines participate in the same ordering using only their daily
duration share. Moving an anchor before a future Due cannot bypass the deadline
of the tasks pushed below it. Lack of capacity alone does not reject an order:
those tasks remain visible outside the schedule. Capacity is shown once in the
sticky calendar heading, not repeated in bold above Timeline.

Left-to-right swipe (or Alt+P while focused within a card) opens calendar pinning.
Right-to-left retains Quick Due. Vertical scrolling cancels a pending swipe.
Native drag handles support pointer capture and Arrow Up/Down. In List, anchors
can be reordered to place the surrounding queue before/after them, without moving
their Timeline intervals. Timeline handles are limited to flexible items (including
start-only items). Already-present Today/Tomorrow destinations are hidden in the
pin dialog. Reset asks twice, names the selected date, and removes only
that day's order. Calendar categories retain their membership.

Verification: `calendarPlanning.test.ts`, Calendar unit suite, and
`tests/e2e/calendar-planning.spec.ts` cover preferences roundtrip, source invariance,
recurrences, expiry, constraints, keyboard, gestures, reload, conflict-to-queue,
reset cancellation/confirmation and feature disablement on Chromium/WebKit.
Physical iPhone Safari/PWA testing remains a separate acceptance step.
# Compact calendar navigation

The date and capacity header stays pinned. Scrolling collapses navigation to the
selected day's week, including adjacent-month days, below that header. Period
controls and the full month return at the top. This is presentation state only;
navigation does not write items or calendar preferences. Pointer interactions
defer the collapse so that a pressed card is not displaced before its click.
