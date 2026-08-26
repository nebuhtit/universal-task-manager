# Phase 3 design-system audit

## Scope and result

Phase 3 introduced semantic tokens, native-first UI primitives, shared layout and dialog patterns, and migrated the main application surfaces without changing the workspace schema or domain workflows. The migrated areas are AppShell, Items, Views, View editor, Item editor and Calendar.

The application version remains unchanged during this refactor. A release version is selected only after the audited `develop` commit is approved.

## Primitive adoption

- Feature code imports the shared UI layer from 40 locations.
- The common controls cover buttons, icon buttons, fields, text inputs, textareas, selects, checkboxes, surfaces, disclosures and responsive dialogs.
- Disclosures retain the existing persisted-open-state behavior through `PersistedDetails`.
- Calendar, Items and Views use feature-local CSS backed by semantic tokens rather than local color systems.

## Tokens and legacy boundary

- Migrated component, layout, Items, Views and Calendar styles contain no hard-coded hexadecimal or `rgb`/`rgba` colors.
- Legacy aliases (`--paper`, `--card`, `--ink`, `--line`, `--muted`) remain available while unmigrated screens still depend on them.
- Confirmed unused styles from the former dashboard, bottom navigation, old view renderer/query details and appearance grid were removed.
- `legacy.css` remains an explicit compatibility layer for unmigrated settings, authentication and specialized editor/domain controls. Its remaining literal values are not design-system examples and should be migrated only with the owning feature.
- Calendar retains a few feature-specific dimensions for FullCalendar hit targets, grid geometry and responsive breakpoints. Colors, focus and interactive states still come from tokens.

## Accessibility and interaction

- Shared controls retain native semantics and keyboard behavior.
- Icon-only actions require accessible names.
- Focus-visible, disabled and destructive states are defined centrally.
- Touch-oriented control sizing is provided by the shared control tokens.
- Responsive dialogs cover desktop and mobile presentation while preserving focus and close behavior.
- Reduced-motion mode disables the authentication ambient animation even though its legacy rule is loaded later.

## Verification coverage

- Unit coverage includes primitive semantics, keyboard behavior, disabled states, persisted disclosures and feature rendering contracts.
- Browser coverage includes desktop and mobile projects, light/dark UI contracts, dialogs, scrolling, item/view workflows and the archived Calendar route.
- The final full Playwright run completed with 46 passing and 6 intentionally skipped viewport/archive cases.
- Calendar was also exercised in a temporary enabled-route scenario without retaining that navigation change.
- Real iPhone Safari behavior cannot be fully proven by desktop automation. The mobile browser project covers viewport and touch-oriented layout contracts; installation-mode keyboard, native date controls and safe-area behavior remain release smoke-test items on a physical device.

## Bundle impact

Compared with the pre-Phase-3 commit `7308311`:

| Asset | Before | After | Difference |
| --- | ---: | ---: | ---: |
| CSS raw | 77.70 kB | 85.14 kB | +7.44 kB |
| CSS gzip | 15.47 kB | 16.33 kB | +0.86 kB |
| JS raw | 7,772.70 kB | 7,832.33 kB | +59.63 kB |
| JS gzip | 2,521.07 kB | 2,543.12 kB | +22.05 kB |

The increase is consistent with the accepted shared primitive/dialog foundation. The production build still reports a large single JavaScript bundle; splitting it is a separate performance task and is intentionally outside this behavior-preserving phase.

## Known risks and follow-up

1. Finish migrating authentication, settings and specialized editor controls before deleting `legacy.css` or the compatibility aliases.
2. Add bundle splitting as a separate measured performance change; do not combine it with UI migration.
3. Perform a short physical-iPhone release smoke test for installed-PWA keyboard movement, native date clearing, safe areas and modal scrolling.
4. Keep Calendar internals unchanged until Calendar Automations are resumed as their own feature phase.
