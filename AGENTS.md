# Universal Task Manager contributor rules

## Design system

- Read `docs/design-system.md` before changing UI.
- Use semantic tokens from `apps/web/src/styles/tokens.css`; do not add feature-local colors, spacing, radii, control sizes, focus rings, or dark-theme palettes when a token exists.
- Reuse primitives from `apps/web/src/components/ui/primitives.tsx` before creating a control.
- Keep Button, Input, Textarea, Select, Checkbox, and Disclosure native unless a concrete interaction requires more.
- Use `ResponsiveDialog` for modal desktop/mobile workflows. Do not add another backdrop, focus trap, Escape handler, portal, or separate mobile sheet implementation.
- Use Base UI only for complex Dialog, Popover, Menu, Tooltip, Switch, or Combobox interaction. Do not wrap simple native controls without a measured need.
- Keep feature styling with its feature. Remove legacy selectors only after confirming that no consumer remains.
- A visual migration must not change domain models, persistence, normalization, filtering, sorting, recurrence, reminders, or temporal behavior.

## Verification

- Small primitive changes: typecheck, related unit tests, build, and `git diff --check`.
- Migrated workflows: add targeted desktop/mobile tests for keyboard, focus, scrolling, light, and dark behavior.
- Treat mobile Chromium emulation as a smoke test, not proof of iPhone Safari/PWA behavior.
- Do not run full E2E after every local UI change; reserve it for substantial milestones and releases.
