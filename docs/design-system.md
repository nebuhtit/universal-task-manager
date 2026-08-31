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

## Base primitives

`Button`, `IconButton`, `Field`, `Input`, `Textarea`, `Select`, `Checkbox`, `Surface`, and `Disclosure` form the intentionally small base layer in `components/ui/primitives.tsx`.

- Interactive primitives render native HTML and preserve its keyboard and disabled semantics.
- `IconButton` requires an accessible `aria-label`.
- Primary mobile controls use the touch control height.
- `Disclosure` composes `PersistedDetails`; it does not create a second disclosure-state mechanism.
- Feature-specific styling and domain behavior do not belong in these primitives.

## Interaction layer decision

The limited Base UI spike accepts `@base-ui/react` 1.7 for complex interaction primitives only. It supports the current React 19 and Vite setup while keeping styling in plain CSS and semantic tokens.

- `ResponsiveDialog` is the first wrapper. It uses one Dialog contract with a centered desktop presentation and a narrow-screen bottom-sheet presentation; Drawer is not used because UTM does not currently require swipe gestures or snap points.
- Dialog portals render under `body`, outside the application root. Overlay stacking is owned by `--z-overlay`, not feature-local z-index values.
- Base UI owns modal focus trapping, Escape dismissal, outside interaction, and focus restoration. Touch opening focuses the popup rather than the first input by default, avoiding an unsolicited mobile keyboard.
- Popover is approved for anchored interactive content. Modal focus trapping requires an internal close control.
- Menu is approved for action menus where arrow-key navigation and roving focus replace hand-written behavior.
- Combobox is approved for large, filterable, closed sets such as tags or fields; native Select remains correct for small lists.
- Tooltip is supplementary desktop/keyboard help only. Essential instructions must remain inline or use Popover because tooltips are disabled on touch devices.
- Switch is appropriate for immediate on/off settings. Checkbox remains correct for form inclusion, multi-selection, and ordinary boolean fields.
- Native Button, Input, Textarea, Select, Checkbox, and Details remain the default. Base UI must not wrap them without a concrete interaction need.

The isolated bundle measurement, with React and React DOM externalized, was 101 bytes for a native dialog entry and 68,141 bytes minified / 23,273 bytes gzip for the used Base UI responsive dialog entry. This cost is accepted for shared complex overlays, not basic controls. The production application does not pay the JavaScript cost until a wrapper is imported by a feature.

The spike verified Chromium keyboard focus restoration, Escape dismissal, portal placement, touch opening without input focus, responsive sheet styling, and touch dismissal. Real-device iPhone Safari/PWA behavior remains a required targeted check for each migrated workflow; Chromium mobile emulation is not evidence of WebKit behavior.

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

- Calendar recurrence projection, per-day capacity metrics, and external synchronization behavior.
- CodeEditor overlay, caret, syntax highlighting, and iOS dark-mode fallback.
- Lock, unlock, backup import, and workspace activation.
- Quick capture, Visual Viewport, mobile keyboard, and sticky editor actions.
- Dates and Duration synchronization and native iPhone date controls.
- Reminders, recurrence, Views DSL synchronization, persistence, and workspace lifecycle.

The first real migration pilot is the isolated All Items display-settings dialog after the generic primitives and interaction-layer decision are complete.

## Phase 3 migration status

The bounded Phase 3 migrations now cover All Items display settings, the low-risk and date/duration ItemEditor sections, Views editor, AppShell, and Calendar presentation. Calendar reuses the normal View list renderer and semantic primitives; recurrence projection, filtering, per-day statistics, selection, and external sync remain domain-owned behavior.

`styles/legacy.css` still contains unmigrated application areas and the `open-calendar-button` bridge used by calendar-rendered saved views. Those selectors are not a design-system API and should be removed only with their remaining consumer.
