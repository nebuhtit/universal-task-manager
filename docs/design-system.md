# UTM design system

This document is the canonical contract for the incremental Phase 3 UI migration. The goal is to make feature code describe meaning and interaction rather than inventing spacing, color, radius, control size, mobile behavior, or dark-theme fixes.

## Architecture

- `styles/tokens.css` owns the small semantic token set and temporary legacy aliases.
- `styles/base.css` owns browser normalization, global typography inheritance, focus visibility, and reduced motion.
- `styles/layout.css` owns only application-wide layout rules.
- `styles/legacy.css` temporarily contains existing feature and compatibility CSS. A migrated area must remove its unused legacy selectors in the same finished batch.
- `components/ui` owns generic reusable controls.
- `components/utm` may own domain-language components only after repeated UI and behavior justify them.
- Native HTML is preferred for simple controls. A headless primitive library may be adopted only after a measured compatibility and bundle spike.

## Tokens

Use the existing tokens rather than nearby one-off values.

- Spacing: `--space-0`, `--space-1`, `--space-2`, `--space-3`, `--space-4`, `--space-5`, `--space-6`, `--space-8`.
- Typography: caption, secondary, body, section, title; regular, medium, and semibold weights.
- Radius: small, medium, large, and pill.
- Controls: compact, default, and touch heights.
- Colors: background, surfaces, text, secondary text, borders, accent, destructive, warning, success, focus ring, and overlay.
- Elevation: surface and elevated shadows.
- Motion: fast/default durations and standard/enter easing.

Light and dark themes assign the semantic values. Feature selectors must not introduce a local dark-theme palette when a shared token can express the state.

The old `--ink`, `--paper`, `--card`, `--line`, `--muted`, and related variables are compatibility aliases, not the API for new components.

## Migration rules

1. Identify the smallest related file set before editing.
2. Reuse an existing primitive before creating another one.
3. Migrate one bounded UI area at a time without changing domain behavior.
4. Keep desktop and mobile on the same component contract with responsive presentation.
5. Test light, dark, narrow viewport, keyboard, focus, long values, and scrolling in each completed migration batch.
6. Delete superseded legacy selectors only after their consumers have migrated.
7. Use typecheck and relevant tests for local batches; reserve full E2E for substantial milestones and releases.

## Prohibited patterns

- Arbitrary feature-local colors, spacing, radii, typography, or control sizes when a token exists.
- New local dark-theme patches that should be solved by a shared token or primitive.
- Copied controls or dialogs for minor visual differences.
- A second mobile-only interface when responsive behavior is sufficient.
- A UI dependency without a compatibility, maintenance, license, and bundle assessment.
- Domain or persistence changes hidden inside a visual migration.
- Permanent coexistence of a new component and its superseded legacy selectors.

## High-risk areas

Do not use these as early migration pilots:

- Calendar and FullCalendar drag, resize, recurrence scope, and projection behavior.
- CodeEditor overlay, caret, syntax highlighting, and iOS dark-mode fallback.
- Lock, unlock, backup import, and workspace activation.
- Quick capture, Visual Viewport, mobile keyboard, and sticky editor actions.
- Dates and Duration synchronization and native iPhone date controls.
- Reminders, recurrence, Views DSL synchronization, persistence, and workspace lifecycle.

The first real migration pilot is the isolated All Items display-settings dialog after the generic primitives and interaction-layer decision are complete.
