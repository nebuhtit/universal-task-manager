# All items list windowing

Release 2.9.7 limits mounting to nearby chunks for All items lists with at least
250 entries. Each chunk holds 20 cards. Measured chunk heights are retained;
focused/interacted chunks stay mounted for editor focus restoration. Search
still evaluates the full collection before rendering. Reorderable saved views
are unchanged. Browsers without IntersectionObserver use the full list.

Reproduce using `tests/e2e/long-lists.spec.ts`. Set `UTM_LIST_BASELINE=1` to disable
windowing for the same synthetic 1000-item workspace. No user data is used.
On the development machine, the initial mounted card count fell from 2000
(including a closed secondary collection) to 20, and DOM nodes from 24205 to
545. Timings vary with build/test load and are not a release performance SLA.

The browser check covers application search, scrolling to the final chunk,
editing, keyboard focus restoration, placeholder focus and dark appearance on
desktop Chromium and mobile WebKit. This is not a physical iPhone PWA check.
Native browser Find cannot search unmounted text; use the application's search.
